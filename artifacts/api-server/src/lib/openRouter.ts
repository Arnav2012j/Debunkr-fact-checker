import { withinCheckSignal } from "./checkDeadline";
import type { FactCheckInput } from "./geminiFactCheck";

// Primary also returned valid JSON in an authenticated availability probe.
// Catalog checked on 2026-10-26; free capacity is not guaranteed.
export const OPENROUTER_MODELS = [
  "dots-studio/dots-3-note-preview:free",
  "google/gemma-4-26b-a4b-it:free",
] as const;
export const LLM_TIMEOUT_MS = 12_000;

export class LLMRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseText: string,
    readonly timedOut = false,
  ) {
    super(message);
    this.name = "LLMRequestError";
  }
}

export class UnreadableLLMResponseError extends Error {
  constructor(readonly responseText: string) {
    super("The checking model returned an unreadable response");
    this.name = "UnreadableLLMResponseError";
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function providerError(value: unknown): LLMRequestError | undefined {
  const error = record(value);
  if (!error) return undefined;
  const code = Number(error.code);
  const status = Number.isInteger(code) && code >= 400 && code <= 599 ? code : 502;
  return new LLMRequestError(
    "OpenRouter returned an error", status,
    providerErrorText(error),
  );
}

function providerErrorText(error: Record<string, unknown>): string {
  const metadata = record(error.metadata);
  // Keep useful upstream diagnostics, not account IDs, headers or arbitrary metadata.
  return JSON.stringify({
    message: typeof error.message === "string" ? error.message.slice(0, 500) : "OpenRouter provider error",
    ...(typeof metadata?.raw === "string" ? { detail: metadata.raw.slice(0, 1000) } : {}),
    ...(typeof metadata?.provider_name === "string" ? { provider: metadata.provider_name } : {}),
    ...(typeof metadata?.limit_source === "string" ? { limitSource: metadata.limit_source } : {}),
  });
}

export async function requestOpenRouter(
  input: FactCheckInput,
  prompt: string,
  model: string,
  deadline: AbortSignal,
): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new LLMRequestError("OpenRouter is not configured", 503, "Missing OPENROUTER_API_KEY");
  const signal = AbortSignal.any([deadline, AbortSignal.timeout(LLM_TIMEOUT_MS)]);
  const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
  if (input.imageBase64 && input.imageMime) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${input.imageMime};base64,${input.imageBase64}` },
    });
  }
  try {
    return await withinCheckSignal(signal, "llm", async () => {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          "X-OpenRouter-Title": "DENBUNKR",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content }],
          stream: false,
          temperature: 0.1,
          max_tokens: 2500,
          reasoning: { enabled: false },
          response_format: { type: "json_object" },
          provider: { require_parameters: true, max_price: { prompt: 0, completion: 0 } },
        }),
        signal,
      });
      if (!response.ok) {
        // Never return raw upstream text to the browser.
        const raw = await response.text();
        let text = "OpenRouter returned a non-JSON error response";
        try {
          const error = record(record(JSON.parse(raw))?.error);
          if (error) text = providerErrorText(error);
        } catch { /* Do not log arbitrary non-JSON upstream bodies. */ }
        throw new LLMRequestError(`OpenRouter returned HTTP ${response.status}`, response.status, text);
      }
      let body: unknown;
      try { body = await response.json(); }
      catch {
        if (signal.aborted) throw signal.reason;
        throw new UnreadableLLMResponseError("OpenRouter returned invalid response JSON");
      }
      const result = record(body);
      const topError = providerError(result?.error);
      if (topError) throw topError;
      const choice = record(Array.isArray(result?.choices) ? result.choices[0] : undefined);
      const choiceError = providerError(choice?.error);
      if (choiceError) throw choiceError;
      // Never treat truncated, refused, tool-only or empty completions as verdicts.
      const message = record(choice?.message);
      if (choice?.finish_reason !== "stop" || message?.refusal ||
          typeof message?.content !== "string" || !message.content.trim()) {
        throw new UnreadableLLMResponseError("OpenRouter returned an incomplete, refused or empty completion");
      }
      return message.content;
    });
  } catch (error) {
    if (error instanceof LLMRequestError || error instanceof UnreadableLLMResponseError) throw error;
    throw new LLMRequestError(
      "OpenRouter request failed", 0,
      error instanceof Error ? error.message : "OpenRouter connection failed", signal.aborted,
    );
  }
}
