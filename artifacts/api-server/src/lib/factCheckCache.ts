import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CheckClaimResponse } from "@workspace/api-zod";
import type { FactCheckInput } from "./geminiFactCheck";

type Result = ReturnType<typeof CheckClaimResponse.parse>;
export interface StoredCheck {
  result: Result;
  model: string;
}
const directory = join(process.cwd(), ".debunkr-cache");
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

function loadCache(): Promise<void> {
  loading ??= (async () => {
    await mkdir(directory, { recursive: true });
    let text: string;
    try {
      text = await readFile(cacheFile, "utf8");
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      await writeFile(cacheFile, JSON.stringify({ version: 1, entries: {} }), { flag: "wx", mode: 0o600 });
      return;
    }
    const data = JSON.parse(text);
    if (data?.version !== 1 || !data.entries || typeof data.entries !== "object" || Array.isArray(data.entries)) {
      throw new Error("Invalid fact-check cache file");
    }
    for (const [key, value] of Object.entries(data.entries)) {
      const stored = value as StoredCheck;
      const result = CheckClaimResponse.parse(stored.result);
      if (typeof stored.model !== "string" || !stored.model.startsWith("gemini-") ||
          !result.claims.some((claim) => claim.sources.length > 0)) {
        throw new Error("Invalid grounded fact-check cache entry");
      }
      if (result.overall_verdict !== "UNCLEAR") entries.set(key, { result, model: stored.model });
    }
  })();
  return loading;
}

export async function findCachedCheck(input: FactCheckInput): Promise<StoredCheck | undefined> {
  const key = claimKey(input);
  if (!key) return undefined;
  await loadCache();
  return entries.get(key);
}

async function storeCheck(key: string, check: StoredCheck): Promise<void> {
  const operation = writes.then(async () => {
    const nextEntries = new Map(entries);
    nextEntries.set(key, check);
    const temporaryFile = `${cacheFile}.tmp`;
    await writeFile(temporaryFile, JSON.stringify({
      version: 1,
      entries: Object.fromEntries(nextEntries),
    }), { mode: 0o600 });
    await rename(temporaryFile, cacheFile);
    entries.set(key, check);
  });
  writes = operation.catch(() => {});
  await operation;
}

export async function getOrGenerateCheck(
  input: FactCheckInput,
  generate: () => Promise<StoredCheck>,
): Promise<StoredCheck> {
  const key = claimKey(input);
  if (!key) return generate();
  await loadCache();
  const cached = entries.get(key);
  if (cached) return cached;
  const active = pending.get(key);
  if (active) return active;
  const operation = (async () => {
    const check = await generate();
    // Never persist errors, ungrounded responses, or the search-unavailable fallback.
    if (check.result.overall_verdict !== "UNCLEAR" &&
        check.result.claims.some((claim) => claim.sources.length > 0)) {
      await storeCheck(key, check);
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
