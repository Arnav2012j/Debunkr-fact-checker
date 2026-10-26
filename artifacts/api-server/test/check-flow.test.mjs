// Run after the API build:
// node --test artifacts/api-server/test/check-flow.test.mjs
// All external requests are replaced with mocks; no real keys/providers are used.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { transform } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const appUrl = pathToFileURL(join(root, "artifacts/api-server/dist/app.mjs")).href;
const nativeFetch = globalThis.fetch;
const nativeTimeout = AbortSignal.timeout.bind(AbortSignal);
const systemTemp = tmpdir();
let fixtureId = 0;
const primaryModel = "dots-studio/dots-3-note-preview:free";
const fallbackModel = "google/gemma-4-26b-a4b-it:free";
const evidence = {
  title: "Mock astronomy evidence — test fixture",
  url: "https://evidence.test/solar-system",
  content: "Test fixture evidence supports the mock orbital claim.",
};
const model = {
  overall_verdict: "TRUE",
  summary: "The supplied mock evidence supports the claim.",
  calm_reply: "The mock claim is supported. See the supplied test evidence.",
  claims: [{
    text: "Mock orbital claim.",
    verdict: "TRUE",
    explanation: "The supplied mock evidence supports this claim.",
    explanation_simple: "The mock evidence supports it.",
    explanation_elder: "The mock evidence supports it.",
    evidence_strength: 90,
    red_flags: [], tactics: [], tactic_explanations: [], why_it_spreads: "",
    // Unknown source indices and model-supplied URLs must never become citations.
    source_refs: [{ index: 1, stance: "supports" }, { index: 99, stance: "supports" }],
    sources: [{ title: "Fabricated model URL — must be ignored", url: "https://invented.test" }],
  }],
};

function waitForAbort(signal) {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

function stalledBody(signal) {
  return new Response(new ReadableStream({
    start(controller) {
      if (signal.aborted) controller.error(signal.reason);
      else signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
    },
  }), { headers: { "content-type": "application/json" } });
}

async function withApp(t, options, run) {
  const temp = await mkdtemp(join(systemTemp, "debunkr-check-test-"));
  const cwd = process.cwd();
  const previous = Object.fromEntries(
    ["TMPDIR", "VERCEL", "NODE_ENV", "OPENROUTER_API_KEY", "TAVILY_API_KEY"].map(key => [key, process.env[key]]),
  );
  const calls = { search: 0, models: [], bodies: [], timeouts: [] };
  let server;
  try {
    // Process-local placeholders only; do not change workspace/deployment secrets.
    if (options.missingKey) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = "mock-openrouter-key";
    process.env.TAVILY_API_KEY = "mock-tavily-key";
    process.env.NODE_ENV = "production";
    process.env.VERCEL = options.replit ? "" : "1";
    process.env.TMPDIR = options.unavailableStorage ? "/sys" : temp;
    process.chdir(options.readOnlyCwd ? "/sys" : temp);
    const cache = join(temp, ".debunkr-cache");
    if (options.writeFailure) {
      await mkdir(join(cache, "checks.json.tmp"), { recursive: true });
    }
    if (options.corruptCache) {
      await mkdir(cache, { recursive: true });
      await writeFile(join(cache, "checks.json"), "{broken JSON");
    }
    if (options.preloadedCache) {
      await mkdir(cache, { recursive: true });
      await writeFile(join(cache, "checks.json"), options.preloadedCache);
    }
    if (options.fastTimers) {
      t.mock.method(AbortSignal, "timeout", (ms) => {
        calls.timeouts.push(ms);
        return nativeTimeout(Math.max(1, Math.ceil(ms / 100)));
      });
    }
    t.mock.method(globalThis, "fetch", async (input, init) => {
      const url = String(input);
      if (url === "https://api.tavily.com/search") {
        calls.search++;
        if (options.searchHangs) return waitForAbort(init.signal);
        if (options.searchBodyHangs) return stalledBody(init.signal);
        if (options.searchFails) return Response.json({ error: "Mock unavailable" }, { status: 503 });
        return Response.json({ results: [evidence] });
      }
      if (url === "https://openrouter.ai/api/v1/chat/completions") {
        const body = JSON.parse(init.body);
        calls.models.push(body.model);
        calls.bodies.push(body);
        assert.equal(init.headers.Authorization, "Bearer mock-openrouter-key");
        if (options.llmHangs) return waitForAbort(init.signal);
        if (options.llmBodyHangs) return stalledBody(init.signal);
        if (options.providerStatus) {
          return Response.json({ error: { message: "Mock provider failure" } }, { status: options.providerStatus });
        }
        if (options.embeddedError) {
          const error = { code: 503, message: "Mock unavailable inside HTTP 200" };
          return Response.json(options.embeddedError === "choice" ? { choices: [{ error }] } : { error });
        }
        if (options.invalidEnvelope) return new Response("not JSON", { headers: { "content-type": "application/json" } });
        if (options.primaryFails && calls.models.length === 1) {
          return Response.json({ error: "Mock overloaded" }, { status: 503 });
        }
        const output = structuredClone(model);
        if (options.unsupportedVerdict) output.claims[0].source_refs = [];
        if (options.conflictingRefs) output.claims[0].source_refs = [
          { index: 1, stance: "supports" }, { index: 1, stance: "disputes" },
        ];
        return Response.json({ choices: [{
          finish_reason: options.truncated ? "length" : "stop",
          message: {
            content: options.emptyCompletion ? "" : options.refused ? null : options.invalidJSON ? "not JSON" : JSON.stringify(output),
            ...(options.refused ? { refusal: "Mock refusal" } : {}),
          },
        }] });
      }
      throw new Error("Unexpected external request blocked by test");
    });
    // Unique ESM instances isolate each fixture's cache and rate-limit state.
    const { default: app } = await import(`${appUrl}?test=${++fixtureId}`);
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolveListening, reject) => {
      server.once("listening", resolveListening);
      server.once("error", reject);
    });
    const post = async (claim = "Mock orbital claim.", language = "English", extra = {}) => {
      const response = await nativeFetch(`http://127.0.0.1:${server.address().port}/api/check`, {
        method: "POST",
        headers: { "content-type": "application/json", Origin: "https://frontend.test" },
        body: JSON.stringify({ claim, language, ...extra }),
      });
      return { status: response.status, headers: response.headers, body: await response.json() };
    };
    await run({ post, calls, cache });
  } finally {
    if (server) await new Promise(resolveClosed => server.close(resolveClosed));
    t.mock.restoreAll();
    process.chdir(cwd);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(temp, { recursive: true, force: true });
  }
}

function assertSupported(result) {
  assert.equal(result.status, 200);
  assert.equal(result.body.overall_verdict, "TRUE");
  const claim = result.body.claims[0];
  assert.deepEqual(claim.evidence_breakdown, { supporting: 1, disputing: 0, neutral: 0 });
  assert.equal(claim.sources.length, 1);
  assert.equal(claim.sources[0].url, evidence.url);
  assert.equal(claim.sources[0].title, evidence.title);
  assert.equal(claim.sources[0].publisher, "evidence.test");
}

test("mocked API flow (external provider calls are always blocked)", async t => {
  await t.test("Vercel uses writable temp storage despite a read-only working directory", async t => {
    await withApp(t, { readOnlyCwd: true }, async ({ post, calls, cache }) => {
      const result = await post();
      assertSupported(result);
      assert.equal(result.headers.get("x-debunkr-model"), primaryModel);
      assert.match(result.headers.get("access-control-expose-headers"), /X-Debunkr-Cache/i);
      assert.equal(JSON.parse(await readFile(join(cache, "checks.json"), "utf8")).version, 1);
      const cached = await post("  MOCK   ORBITAL CLAIM. ");
      assertSupported(cached);
      assert.equal(cached.headers.get("x-debunkr-cache"), "HIT");
      assert.deepEqual(calls.models, [primaryModel]);
      assert.equal(calls.search, 1);
      await post("Mock orbital claim.", "French");
      assert.equal(calls.search, 2, "language remains part of the cache key");
      assert.equal(calls.bodies[0].messages[0].content[0].text.includes(evidence.content), true);
      assert.deepEqual(calls.bodies[0].provider, { require_parameters: true, max_price: { prompt: 0, completion: 0 } });
      assert.equal(calls.bodies[0].max_tokens, 2500);
      assert.deepEqual(calls.bodies[0].response_format, { type: "json_object" });
      assert.deepEqual(calls.bodies[0].reasoning, { enabled: false });
    });
  });
  await t.test("Replit keeps its working-directory cache", async t => {
    await withApp(t, { replit: true }, async ({ post, cache }) => {
      assertSupported(await post());
      assert.equal(JSON.parse(await readFile(join(cache, "checks.json"), "utf8")).version, 1);
    });
  });
  await t.test("cache write failure preserves a successful result and memory cache", async t => {
    await withApp(t, { writeFailure: true }, async ({ post, calls }) => {
      assertSupported(await post());
      const cached = await post();
      assertSupported(cached);
      assert.equal(cached.headers.get("x-debunkr-cache"), "HIT");
      assert.equal(calls.search, 1);
      assert.equal(calls.models.length, 1);
    });
  });
  await t.test("unavailable and corrupt cache storage do not prevent evidence-based results", async t => {
    for (const options of [{ unavailableStorage: true }, { corruptCache: true }]) {
      await withApp(t, options, async ({ post }) => assertSupported(await post()));
    }
  });
  await t.test("fallback uses the same search evidence without repeating search", async t => {
    await withApp(t, { primaryFails: true }, async ({ post, calls }) => {
      assertSupported(await post());
      assert.equal(calls.search, 1);
      assert.deepEqual(calls.models, [primaryModel, fallbackModel]);
      assert.deepEqual(calls.bodies[0].messages, calls.bodies[1].messages);
    });
  });
  await t.test("search outage retains the source-free UNCLEAR fallback and is not cached", async t => {
    await withApp(t, { searchFails: true }, async ({ post, calls }) => {
      for (let i = 0; i < 2; i++) {
        const result = await post();
        assert.equal(result.status, 200);
        assert.equal(result.body.overall_verdict, "UNCLEAR");
        assert.deepEqual(result.body.claims[0].sources, []);
      }
      assert.equal(calls.search, 2);
      assert.equal(calls.models.length, 0);
    });
  });
  await t.test("unsupported model verdict is still downgraded and not cached", async t => {
    await withApp(t, { unsupportedVerdict: true }, async ({ post, calls }) => {
      for (let i = 0; i < 2; i++) {
        const result = await post();
        assert.equal(result.body.overall_verdict, "UNCLEAR");
        assert.deepEqual(result.body.claims[0].sources, []);
      }
      assert.equal(calls.search, 2);
    });
  });
  await t.test("OpenRouter results can be reloaded from the JSON cache after a cold start", async t => {
    let savedCache;
    await withApp(t, {}, async ({ post, cache }) => {
      assertSupported(await post());
      savedCache = await readFile(join(cache, "checks.json"), "utf8");
    });
    await withApp(t, { preloadedCache: savedCache }, async ({ post, calls }) => {
      const result = await post();
      assertSupported(result);
      assert.equal(result.headers.get("x-debunkr-cache"), "HIT");
      assert.equal(result.headers.get("x-debunkr-model"), primaryModel);
      assert.equal(calls.search, 0);
      assert.equal(calls.models.length, 0);
    });
  });
  await t.test("missing OpenRouter key fails clearly before calling Tavily", async t => {
    await withApp(t, { missingKey: true }, async ({ post, calls }) => {
      const result = await post();
      assert.equal(result.status, 503);
      assert.equal(result.body.code, "KEY_MISSING");
      assert.equal("overall_verdict" in result.body, false);
      assert.equal(calls.search, 0);
      assert.equal(calls.models.length, 0);
    });
  });
  for (const status of [400, 401, 402, 403, 404, 429, 503]) {
    await t.test(`OpenRouter HTTP ${status} returns an error, never a verdict or cached success`, async t => {
      await withApp(t, { providerStatus: status }, async ({ post, calls }) => {
        const expectedStatus = status === 429 ? 429 : [401, 403].includes(status) ? 401 : 502;
        for (let i = 0; i < 2; i++) {
          const result = await post();
          assert.equal(result.status, expectedStatus);
          assert.equal("overall_verdict" in result.body, false);
          assert.equal(result.headers.get("x-debunkr-cache"), null);
        }
        assert.equal(calls.search, 2);
        const expectedModels = [404, 429, 503].includes(status)
          ? [primaryModel, fallbackModel, primaryModel, fallbackModel]
          : [primaryModel, primaryModel];
        assert.deepEqual(calls.models, expectedModels);
      });
    });
  }
  for (const embeddedError of ["top", "choice"]) {
    await t.test(`HTTP 200 with a ${embeddedError}-level provider error is not treated as success`, async t => {
      await withApp(t, { embeddedError }, async ({ post, calls }) => {
        const result = await post();
        assert.equal(result.status, 502);
        assert.equal(result.body.code, "GEMINI_ERROR"); // Legacy wire code; provider is OpenRouter.
        assert.equal("overall_verdict" in result.body, false);
        assert.deepEqual(calls.models, [primaryModel, fallbackModel]);
      });
    });
  }
  for (const invalid of ["invalidJSON", "truncated", "refused", "invalidEnvelope", "emptyCompletion"]) {
    await t.test(`${invalid} completion produces no verdict and is not cached`, async t => {
      await withApp(t, { [invalid]: true }, async ({ post, calls }) => {
        for (let i = 0; i < 2; i++) {
          const result = await post();
          assert.equal(result.status, 502);
          assert.equal(result.body.code, "UNREADABLE_RESPONSE");
          assert.equal("overall_verdict" in result.body, false);
        }
        assert.equal(calls.search, 2);
      });
    });
  }
  await t.test("conflicting source stances still prevent an unsupported TRUE verdict", async t => {
    await withApp(t, { conflictingRefs: true }, async ({ post }) => {
      const result = await post();
      assert.equal(result.body.overall_verdict, "UNCLEAR");
      assert.equal(result.body.claims[0].sources[0].url, evidence.url);
      assert.equal(result.body.claims[0].evidence_breakdown.neutral, 1);
    });
  });
  await t.test("image plus claim is transported as an image URL data part, never an invented source", async t => {
    await withApp(t, {}, async ({ post, calls }) => {
      assertSupported(await post("Mock orbital claim.", "English", {
        imageBase64: "iVBORw0KGgo=", imageMime: "image/png",
      }));
      assert.deepEqual(calls.bodies[0].messages[0].content[1], {
        type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" },
      });
    });
  });
  for (const kind of ["searchHangs", "searchBodyHangs", "llmHangs", "llmBodyHangs"]) {
    await t.test(`${kind} returns an explicit timeout, with no verdict`, async t => {
      await withApp(t, { [kind]: true, fastTimers: true }, async ({ post, calls }) => {
        const start = performance.now();
        const result = await post();
        assert.equal(result.status, 504);
        assert.equal(result.body.code, "CHECK_TIMEOUT");
        assert.match(result.body.error, /took too long/);
        assert.equal("overall_verdict" in result.body, false);
        assert(calls.timeouts.includes(20_000));
        assert(calls.timeouts.includes(5_000));
        assert(performance.now() - start < 1000, "scaled overall deadline must bound all attempts");
        if (kind.startsWith("search")) assert.equal(calls.models.length, 0);
        else {
          assert.deepEqual(calls.models, [primaryModel, fallbackModel]);
          assert.equal(calls.timeouts.filter(ms => ms === 12_000).length, 2);
        }
      });
    });
  }
});

async function importTypescript(source) {
  const { code } = await transform(source, { loader: "ts", format: "esm", target: "es2022" });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

test("frontend API routing and timeout handling (mocked fetch)", async t => {
  const client = await importTypescript(await readFile(join(root, "lib/api-client-react/src/custom-fetch.ts"), "utf8"));
  await t.test("configured backend and unset same-origin routing", async t => {
    const destinations = [];
    t.mock.method(globalThis, "fetch", async input => {
      destinations.push(input);
      return Response.json({ ok: true });
    });
    client.setBaseUrl("https://denbunkr-api.vercel.app/");
    await client.customFetch("/api/check", { method: "POST", body: "{}", responseType: "json" });
    client.setBaseUrl(null);
    await client.customFetch("/api/check", { method: "POST", body: "{}", responseType: "json" });
    assert.deepEqual(destinations, ["https://denbunkr-api.vercel.app/api/check", "/api/check"]);
    const startup = await readFile(join(root, "artifacts/debunkr/src/main.tsx"), "utf8");
    assert.match(startup, /setBaseUrl\(import\.meta\.env\.VITE_API_BASE_URL\?\.trim\(\) \|\| null\)/);
    assert(startup.indexOf("setBaseUrl(import.meta") < startup.indexOf("createRoot(document"));
  });
  await t.test("browser aborts at 22 seconds and preserves TimeoutError", async t => {
    let signal;
    t.mock.timers.enable({ apis: ["setTimeout"] });
    t.mock.method(globalThis, "fetch", async (_input, init) => {
      signal = init.signal;
      return waitForAbort(signal);
    });
    const pending = client.customFetch("/api/check", { method: "POST", body: "{}" });
    const rejected = assert.rejects(pending, { name: "TimeoutError" });
    t.mock.timers.tick(21_999);
    assert.equal(signal.aborted, false);
    t.mock.timers.tick(1);
    await rejected;
  });
  await t.test("browser and server timeouts map to translated actionable text", async () => {
    const source = await readFile(join(root, "artifacts/debunkr/src/App.tsx"), "utf8");
    const codes = source.match(/^const API_CODES = .*;$/m)[0];
    const fn = source.slice(source.indexOf("function toUiError("), source.indexOf("\nfunction Router("))
      .replace("function toUiError", "export function toUiError");
    const ui = await importTypescript(`${codes}\n${fn}`);
    for (const error of [
      new DOMException("Mock timeout", "TimeoutError"),
      { status: 504 },
      { data: { code: "CHECK_TIMEOUT" } },
    ]) assert.deepEqual(ui.toUiError(error), { key: "err.CHECK_TIMEOUT" });
    const translations = await readFile(join(root, "artifacts/debunkr/src/settings/translations.ts"), "utf8");
    assert.equal(translations.match(/["']err\.CHECK_TIMEOUT["']/g).length, 4);
  });
});
