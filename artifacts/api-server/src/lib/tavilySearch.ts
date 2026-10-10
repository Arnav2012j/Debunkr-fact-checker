export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

export class SearchUnavailableError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function searchClaim(claim: string): Promise<SearchResult[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new SearchUnavailableError(503, "TAVILY_API_KEY is not configured");
  const sentences = claim.trim().match(/[^.!?]+[.!?]*/g) ?? [claim];
  const query = (claim.trim().length <= 300 ? claim : sentences.slice(0, 2).join(" "))
    .replace(/\s+/g, " ").trim().slice(0, 300);
  if (!query) throw new SearchUnavailableError(400, "No claim text available for search");
  let response: Response;
  try {
    response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, search_depth: "basic", max_results: 6, include_answer: false }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new SearchUnavailableError(0, "Tavily search request failed or timed out");
  }
  if (!response.ok) throw new SearchUnavailableError(response.status, "Tavily search returned an error");
  let data: { results?: unknown[] };
  try {
    const parsed: unknown = await response.json();
    if (!parsed || typeof parsed !== "object") throw new Error("Invalid search response");
    data = parsed as { results?: unknown[] };
  } catch {
    throw new SearchUnavailableError(response.status, "Tavily returned unreadable search results");
  }
  const results: SearchResult[] = [];
  for (const raw of Array.isArray(data?.results) ? data.results.slice(0, 6) : []) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.title !== "string" || typeof item.url !== "string" || typeof item.content !== "string") continue;
    try {
      const url = new URL(item.url);
      if (!["https:", "http:"].includes(url.protocol) || !item.content.trim()) continue;
      results.push({ title: item.title, url: item.url, content: item.content.slice(0, 4000) });
    } catch { /* Ignore invalid search URLs, never replace them with model text. */ }
  }
  if (!results.length) throw new SearchUnavailableError(response.status, "Tavily returned no usable results");
  return results;
}
