import { Router, type IRouter } from "express";
import { CheckClaimBody } from "@workspace/api-zod";
import {
  checkWithLLM,
  LLMRequestError,
  liveSearchUnavailableResult,
  LiveSearchUnavailableError,
  UnreadableLLMResponseError,
  validateInlineImage,
  type FactCheckInput,
} from "../lib/geminiFactCheck";
import { findCachedCheck, getOrGenerateCheck, type CacheEvent } from "../lib/factCheckCache";
import { CHECK_TIMEOUT_MS, CheckTimeoutError, withinCheckSignal } from "../lib/checkDeadline";

const router: IRouter = Router();
const RATE_LIMIT = 8;
const RATE_WINDOW_MS = 60_000;
const requestsByIp = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string, now: number): boolean {
  if (requestsByIp.size > 1000) {
    for (const [key, value] of requestsByIp) {
      if (value.resetAt <= now) requestsByIp.delete(key);
    }
  }
  const current = requestsByIp.get(ip);
  if (!current || current.resetAt <= now) {
    requestsByIp.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (current.count >= RATE_LIMIT) return false;
  current.count += 1;
  return true;
}

function redactApiKey(value: string): string {
  for (const key of [process.env.OPENROUTER_API_KEY, process.env.GEMINI_API_KEY, process.env.TAVILY_API_KEY]) {
    if (key) value = value.replaceAll(key, "[redacted]");
  }
  return value;
}

function containsOnlyHttpUrls(value: string): boolean {
  const links = value.match(/[a-z][a-z\d+.-]*:\/\/[^\s<>"']+/gi) ?? [];
  return links.every((link) => {
    const candidate = link.replace(/[),.;!?]+$/g, "");
    try {
      const url = new URL(candidate);
      return (
        (url.protocol === "http:" || url.protocol === "https:") &&
        Boolean(url.hostname)
      );
    } catch {
      return false;
    }
  });
}

router.post("/check", async (req, res): Promise<void> => {
  const requestStart = performance.now();
  const deadline = AbortSignal.timeout(CHECK_TIMEOUT_MS);
  res.once("finish", () => {
    req.log.info({
      stage: "request",
      durationMs: Math.round(performance.now() - requestStart),
      httpStatus: res.statusCode,
    }, "Fact check request completed");
  });
  const logCache = (event: CacheEvent) => {
    if (event.outcome === "error") req.log.warn(event, "Fact check cache storage unavailable");
    else req.log.info(event, "Fact check cache completed");
  };
  const parsed = CheckClaimBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Enter a claim or upload a PNG or JPEG image, and choose a language.",
      code: "INVALID_INPUT",
    });
    return;
  }

  const input = parsed.data as FactCheckInput;
  const claim = input.claim?.trim();
  if (!claim && !input.imageBase64) {
    res.status(400).json({ error: "Enter a claim or upload an image.", code: "INVALID_INPUT" });
    return;
  }
  if (claim && claim.length > 2000) {
    res.status(400).json({ error: "Claims must be 2,000 characters or fewer.", code: "INVALID_INPUT" });
    return;
  }
  if (claim && !containsOnlyHttpUrls(claim)) {
    res.status(400).json({
      error: "Links must use a valid http or https address.",
      code: "INVALID_URL",
    });
    return;
  }

  const imageError = validateInlineImage(input);
  if (imageError) {
    res.status(400).json({ error: imageError, code: "INVALID_IMAGE" });
    return;
  }

  try {
    const normalizedInput = { ...input, claim };
    const cached = await withinCheckSignal(deadline, "cache", () => findCachedCheck(normalizedInput, logCache));
    if (cached) {
      res.setHeader("X-Debunkr-Cache", "HIT");
      res.setHeader("X-Debunkr-Model", cached.model);
      res.json(cached.result);
      return;
    }
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    if (!checkRateLimit(ip, Date.now())) {
      res.status(429).json({
        error: "Daily free limit reached. Please try again later.",
        code: "RATE_LIMIT_REACHED",
      });
      return;
    }
    const stored = await withinCheckSignal(deadline, "request", () => getOrGenerateCheck(normalizedInput, async () => {
      let model = "";
      const result = await checkWithLLM(normalizedInput, (event) => {
        if (event.grounded) model = event.model;
        if (!res.headersSent && !res.destroyed) {
          if (event.model) res.setHeader("X-Debunkr-Model", event.model);
          if (event.tavilyResults !== undefined) res.setHeader("X-Debunkr-Search-Results", event.tavilyResults);
        }
        const details = {
          ...event,
          stage: event.tavilyResults !== undefined ? "search" : "llm",
          provider: event.tavilyResults !== undefined ? "tavily" : "openrouter",
          ...(event.errorText ? { errorText: redactApiKey(event.errorText) } : {}),
        };
        if (event.tavilyResults !== undefined) req.log.info(details, "Tavily search completed");
        else if (event.errorText || event.timedOut) req.log.warn(details, "OpenRouter attempt failed");
        else req.log.info(details, event.grounded ? "OpenRouter grounded check completed" : "OpenRouter attempt completed");
      }, deadline);
      return { result, model };
    }, logCache));
    res.setHeader("X-Debunkr-Cache", input.imageBase64 ? "BYPASS" : "MISS");
    res.setHeader("X-Debunkr-Model", stored.model);
    res.json(stored.result);
  } catch (error) {
    if (error instanceof CheckTimeoutError) {
      req.log.warn({ stage: error.stage, durationMs: Math.round(performance.now() - requestStart) }, "Fact check timed out");
      res.status(504).json({
        error: error.message,
        code: "CHECK_TIMEOUT",
      });
      return;
    }
    if (error instanceof LiveSearchUnavailableError) {
      req.log.error(
        { httpStatus: error.status, errorText: redactApiKey(error.responseText) },
        "Live search unavailable",
      );
      res.json(liveSearchUnavailableResult({ ...input, claim }));
      return;
    }

    if (error instanceof LLMRequestError) {
      req.log.error(
        { httpStatus: error.status, errorText: redactApiKey(error.responseText) },
        "OpenRouter request failed",
      );
      if (error.responseText === "Missing OPENROUTER_API_KEY") {
        res.status(503).json({
          error: "The fact-check service is not configured yet.",
          code: "KEY_MISSING",
        });
        return;
      }
      if (error.status === 429) {
        res.status(429).json({
          error: "The free checking service is busy or rate-limited. Please try again later. No verdict was produced.",
          code: "GEMINI_RATE_LIMITED",
        });
        return;
      }
      if (
        error.status === 401 ||
        error.status === 403 ||
        /api[_ ]key (?:not valid|invalid)|invalid api key|api_key_invalid|permission_denied/i.test(
          error.responseText,
        )
      ) {
        res.status(401).json({
          error: "The fact-check service could not authenticate with OpenRouter.",
          code: "INVALID_KEY",
        });
        return;
      }
      res.status(502).json({
        error: "The fact-check service could not complete this check.",
        code: "GEMINI_ERROR",
      });
      return;
    }

    if (error instanceof UnreadableLLMResponseError) {
      req.log.error(
        { errorText: redactApiKey(error.responseText) },
        "OpenRouter returned an unreadable response",
      );
      res.status(502).json({
        error: "The checking model returned an unreadable response. Please retry the check.",
        code: "UNREADABLE_RESPONSE",
      });
      return;
    }

    req.log.error({ err: error }, "Fact check failed unexpectedly");
    res.status(500).json({
      error: "Something went wrong while checking this claim.",
      code: "INTERNAL_ERROR",
    });
  }
});

export default router;
