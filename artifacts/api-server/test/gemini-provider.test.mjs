// Retained provider regression tests. Every external request is mocked.
import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../src/lib/geminiFactCheck.ts", import.meta.url));
const compiled = await build({
  entryPoints: [entry], bundle: true, platform: "node", format: "esm", write: false,
});
const encoded = Buffer.from(compiled.outputFiles[0].text).toString("base64");
let instance = 0;
const evidence = { title: "Mock evidence", url: "https://evidence.test/retained", content: "Mock supporting evidence." };
const output = {
  overall_verdict: "TRUE", summary: "Mock supported claim.", calm_reply: "Mock reply. Review the evidence.",
  claims: [{
    text: "Mock claim.", verdict: "TRUE", explanation: "Mock evidence supports it.",
    explanation_simple: "Mock supported.", explanation_elder: "Mock supported.",
    evidence_strength: 90, red_flags: [], tactics: [], tactic_explanations: [],
    why_it_spreads: "", source_refs: [{ index: 1, stance: "supports" }],
  }],
};

async function fixture(t, mode, run) {
  const previous = { gemini: process.env.GEMINI_API_KEY, tavily: process.env.TAVILY_API_KEY };
  process.env.GEMINI_API_KEY = "mock-retained-gemini-key";
  process.env.TAVILY_API_KEY = "mock-retained-search-key";
  t.after(() => {
    for (const [key, value] of [["GEMINI_API_KEY", previous.gemini], ["TAVILY_API_KEY", previous.tavily]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    t.mock.restoreAll();
  });
  const calls = { search: 0, models: [], bodies: [] };
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (String(url) === "https://api.tavily.com/search") {
      calls.search++;
      return Response.json({ results: [evidence] });
    }
    assert(String(url).startsWith("https://generativelanguage.googleapis.com/v1beta/models/"),
      "Retained Gemini must never route to OpenRouter or another external endpoint");
    calls.models.push(String(url).split("/models/")[1].split(":")[0]);
    calls.bodies.push(JSON.parse(init.body));
    assert.equal(init.headers["x-goog-api-key"], "mock-retained-gemini-key");
    if (mode === "auth") return Response.json({ error: "Mock unauthorized" }, { status: 401 });
    if (mode === "busy" && calls.models.length === 1) return Response.json({ error: "Mock busy" }, { status: 503 });
    if (mode === "thinking" && calls.models.length === 1) {
      return new Response("Unsupported thinking configuration", { status: 400 });
    }
    if (mode === "malformed") return Response.json({ candidates: [{ content: { parts: [{ text: "not JSON" }] } }] });
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(output) }] } }] });
  });
  const module = await import(`data:text/javascript;base64,${encoded}#${++instance}`);
  await run(module, calls);
}

test("retained Gemini keeps request settings, image data and grounded schema", async t => {
  await fixture(t, "success", async ({ checkWithGemini }, calls) => {
    const result = await checkWithGemini({
      claim: "Mock claim.", language: "English", imageBase64: "iVBORw0KGgo=", imageMime: "image/png",
    });
    assert.equal(result.overall_verdict, "TRUE");
    assert.equal(result.claims[0].sources[0].url, evidence.url);
    assert.deepEqual(calls.models, ["gemini-3.1-flash-lite"]);
    assert.deepEqual(calls.bodies[0].generationConfig, {
      temperature: 0.1, maxOutputTokens: 2500, thinkingConfig: { thinkingLevel: "low" },
    });
    assert.equal(calls.bodies[0].contents[0].parts[0].text.includes(evidence.content), true);
    assert.deepEqual(calls.bodies[0].contents[0].parts[1].inline_data,
      { mime_type: "image/png", data: "iVBORw0KGgo=" });
  });
});
test("retained Gemini overload uses its original fallback with one search", async t => {
  await fixture(t, "busy", async ({ checkWithGemini }, calls) => {
    await checkWithGemini({ claim: "Mock claim.", language: "English" });
    assert.equal(calls.search, 1);
    assert.deepEqual(calls.models, ["gemini-3.1-flash-lite", "gemini-3.8-flash"]);
    assert.deepEqual(calls.bodies[0].contents, calls.bodies[1].contents);
  });
});
test("retained Gemini removes rejected thinking for the next model, without repeating the first", async t => {
  await fixture(t, "thinking", async ({ checkWithGemini }, calls) => {
    await checkWithGemini({ claim: "Mock claim.", language: "English" });
    assert.equal(calls.models.length, 2);
    assert.equal("thinkingConfig" in calls.bodies[1].generationConfig, false);
  });
});
test("retained Gemini authentication failure does not fall back", async t => {
  await fixture(t, "auth", async ({ checkWithGemini }, calls) => {
    await assert.rejects(checkWithGemini({ claim: "Mock claim.", language: "English" }), e => e.status === 401);
    assert.equal(calls.models.length, 1);
  });
});
test("retained Gemini malformed output never becomes a verdict", async t => {
  await fixture(t, "malformed", async ({ checkWithGemini }, calls) => {
    await assert.rejects(checkWithGemini({ claim: "Mock claim.", language: "English" }),
      e => e.name === "UnreadableLLMResponseError" && e.responseText.includes("valid JSON object"));
    assert.equal(calls.models.length, 1);
  });
});
test("retained Gemini respects an already-expired overall deadline", async t => {
  await fixture(t, "success", async ({ checkWithGemini }, calls) => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(checkWithGemini({ claim: "Mock claim.", language: "English" }, undefined, controller.signal),
      e => e.name === "CheckTimeoutError");
    assert.equal(calls.search, 0);
    assert.equal(calls.models.length, 0);
  });
});
