import { Router, type IRouter } from "express";
import { CheckClaimBody } from "@workspace/api-zod";
import {
  checkWithGemini,
  GeminiRequestError,
  liveSearchUnavailableResult,
  LiveSearchUnavailableError,
  UnreadableGeminiResponseError,
  validateInlineImage,
  type FactCheckInput,
} from "../lib/geminiFactCheck";
import { findCachedCheck, getOrGenerateCheck } from "../lib/factCheckCache";

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
  for (const key of [process.env.GEMINI_API_KEY, process.env.TAVILY_API_KEY]) {
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
    const cached = await findCachedCheck(normalizedInput);
    if (cached) {
      res.setHeader("X-Debunkr-Cache", "HIT");
      res.setHeader("X-Debunkr-Model", cached.model);
      res.json(cached.result);
      return;
    }
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    if (!checkRateLimit(ip, Date.now())) {
      res.status(429).json({
        error: "Too many checks. Please wait a minute and try again.",
        code: "RATE_LIMIT_REACHED",
      });
      return;
    }
    const stored = await getOrGenerateCheck(normalizedInput, async () => {
      let model = "";
      const result = await checkWithGemini(normalizedInput, (event) => {
        if (event.grounded) model = event.model;
        if (event.model) res.setHeader("X-Debunkr-Model", event.model);
        if (event.tavilyResults !== undefined) res.setHeader("X-Debunkr-Search-Results", event.tavilyResults);
        const details = {
          ...event,
          ...(event.errorText ? { errorText: redactApiKey(event.errorText) } : {}),
        };
        if (event.tavilyResults !== undefined) req.log.info(details, "Tavily search completed");
        else if (event.status >= 400) req.log.warn(details, "Gemini attempt failed");
        else req.log.info(details, event.grounded ? "Gemini grounded check completed" : "Gemini attempt completed");
      });
      return { result, model };
    });
    res.setHeader("X-Debunkr-Cache", input.imageBase64 ? "BYPASS" : "MISS");
    res.setHeader("X-Debunkr-Model", stored.model);
    res.json(stored.result);
  } catch (error) {
    if (error instanceof LiveSearchUnavailableError) {
      req.log.error(
        { httpStatus: error.status, errorText: redactApiKey(error.responseText) },
        "Live search unavailable",
      );
      res.json(liveSearchUnavailableResult({ ...input, claim }));
      return;
    }

    if (error instanceof GeminiRequestError) {
      req.log.error(
        { httpStatus: error.status, errorText: redactApiKey(error.responseText) },
        "Gemini request failed",
      );
      if (error.responseText === "Missing GEMINI_API_KEY") {
        res.status(503).json({
          error: "The fact-check service is not configured yet.",
          code: "KEY_MISSING",
        });
        return;
      }
      if (error.status === 429) {
        res.status(429).json({
          error: "Daily free limit reached. Please try again later.",
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
          error: "The fact-check service could not authenticate with Gemini.",
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

    if (error instanceof UnreadableGeminiResponseError) {
      req.log.error(
        { errorText: redactApiKey(error.responseText) },
        "Gemini returned an unreadable response",
      );
      res.status(502).json({
        error: "Gemini returned an unreadable response. Please retry the check.",
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
