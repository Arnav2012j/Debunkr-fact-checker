import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CheckClaimResponse } from "@workspace/api-zod";
import type { FactCheckInput } from "./geminiFactCheck";
import { OPENROUTER_MODELS } from "./openRouter";

type Result = ReturnType<typeof CheckClaimResponse.parse>;
export interface StoredCheck {
  result: Result;
  model: string;
}
export interface CacheEvent {
  stage: "cache";
  operation: "load" | "lookup" | "write";
  durationMs: number;
  outcome: "ok" | "error" | "hit" | "miss" | "bypass";
  errorCode?: string;
}
type CacheLogger = (event: CacheEvent) => void;
const directory = join(process.env.VERCEL === "1" ? tmpdir() : process.cwd(), ".debunkr-cache");
const cacheFile = join(directory, "checks.json");
const entries = new Map<string, StoredCheck>();
const pending = new Map<string, Promise<StoredCheck>>();
let loading: Promise<void> | undefined;
let writes: Promise<void> = Promise.resolve();

function claimKey(input: FactCheckInput): string | null {
  // An image can change the meaning of identical accompanying text.
  if (input.imageBase64 || !input.claim?.trim()) return null;
  const normalized = input.claim.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
  return createHash("sha256").update(JSON.stringify(["tavily-v1", normalized, input.language])).digest("hex");
}

function cacheFailure(log: CacheLogger | undefined, operation: "load" | "write", start: number, error: unknown): void {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  log?.({
    stage: "cache", operation, outcome: "error",
    durationMs: Math.round(performance.now() - start),
    errorCode: typeof code === "string" ? code : "CACHE_ERROR",
  });
}

function loadCache(log?: CacheLogger): Promise<void> {
  loading ??= (async () => {
    const start = performance.now();
    try {
      await mkdir(directory, { recursive: true });
      let text: string;
      try {
        text = await readFile(cacheFile, "utf8");
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
        // A missing file is an empty cache. Persist only after a real success.
        log?.({ stage: "cache", operation: "load", outcome: "miss", durationMs: Math.round(performance.now() - start) });
        return;
      }
      const data = JSON.parse(text);
      if (data?.version !== 1 || !data.entries || typeof data.entries !== "object" || Array.isArray(data.entries)) {
        throw new Error("Invalid fact-check cache file");
      }
      const loaded = new Map<string, StoredCheck>();
      for (const [key, value] of Object.entries(data.entries)) {
        const stored = value as StoredCheck;
        const result = CheckClaimResponse.parse(stored.result);
        if (typeof stored.model !== "string" ||
            !(stored.model.startsWith("gemini-") || OPENROUTER_MODELS.some(model => model === stored.model)) ||
            !result.claims.some((claim) => claim.sources.length > 0)) {
          throw new Error("Invalid grounded fact-check cache entry");
        }
        if (result.overall_verdict !== "UNCLEAR") loaded.set(key, { result, model: stored.model });
      }
      for (const [key, value] of loaded) entries.set(key, value);
      log?.({ stage: "cache", operation: "load", outcome: "ok", durationMs: Math.round(performance.now() - start) });
    } catch (error) {
      // Caching is an optimization: unavailable/corrupt storage must not block checks.
      cacheFailure(log, "load", start, error);
    }
  })();
  return loading;
}

export async function findCachedCheck(input: FactCheckInput, log?: CacheLogger): Promise<StoredCheck | undefined> {
  const start = performance.now();
  const key = claimKey(input);
  if (!key) {
    log?.({ stage: "cache", operation: "lookup", outcome: "bypass", durationMs: 0 });
    return undefined;
  }
  await loadCache(log);
  const cached = entries.get(key);
  log?.({ stage: "cache", operation: "lookup", outcome: cached ? "hit" : "miss", durationMs: Math.round(performance.now() - start) });
  return cached;
}

async function storeCheck(key: string, check: StoredCheck, log?: CacheLogger): Promise<void> {
  // Keep a useful in-memory cache even when optional persistence fails.
  entries.set(key, check);
  const start = performance.now();
  const operation = writes.then(async () => {
    const nextEntries = new Map(entries);
    const temporaryFile = `${cacheFile}.tmp`;
    await writeFile(temporaryFile, JSON.stringify({
      version: 1,
      entries: Object.fromEntries(nextEntries),
    }), { mode: 0o600 });
    await rename(temporaryFile, cacheFile);
    log?.({ stage: "cache", operation: "write", outcome: "ok", durationMs: Math.round(performance.now() - start) });
  });
  writes = operation.catch(() => {});
  try {
    await operation;
  } catch (error) {
    cacheFailure(log, "write", start, error);
  }
}

export async function getOrGenerateCheck(
  input: FactCheckInput,
  generate: () => Promise<StoredCheck>,
  log?: CacheLogger,
): Promise<StoredCheck> {
  const key = claimKey(input);
  if (!key) return generate();
  await loadCache(log);
  const cached = entries.get(key);
  if (cached) return cached;
  const active = pending.get(key);
  if (active) return active;
  const operation = (async () => {
    const check = await generate();
    // Never persist errors, ungrounded responses, or the search-unavailable fallback.
    if (check.result.overall_verdict !== "UNCLEAR" &&
        check.result.claims.some((claim) => claim.sources.length > 0)) {
      await storeCheck(key, check, log);
    }
    return check;
  })();
  pending.set(key, operation);
  try {
    return await operation;
  } finally {
    pending.delete(key);
  }
}
