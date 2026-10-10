import { CheckClaimResponse } from "@workspace/api-zod";

const MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"] as const;
const MAX_HTTP_ATTEMPTS = 2;
export interface GeminiAttemptEvent {
  model: string;
  attempt: number;
  status: number;
  errorText?: string;
  retryDelayMs?: number;
  grounded?: boolean;
}
type AttemptLogger = (event: GeminiAttemptEvent) => void;
const ALLOWED_TACTICS = new Set([
  "Fear tactic",
  "Fake authority",
  "Cherry-picked data",
  "Out of context",
  "Emotional bait",
  "Too good to be true",
  "Old news recycled",
]);
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

type CheckResult = ReturnType<typeof CheckClaimResponse.parse>;
type CheckedClaim = CheckResult["claims"][number];
type GroundedSource = CheckedClaim["sources"][number];
type AllowedTactic = CheckedClaim["tactics"][number];

export interface FactCheckInput {
  claim?: string;
  language: "English" | "Hindi" | "Spanish" | "French";
  imageBase64?: string;
  imageMime?: "image/png" | "image/jpeg";
}

export class GeminiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseText: string,
  ) {
    super(message);
    this.name = "GeminiRequestError";
  }
}

export class UnreadableGeminiResponseError extends Error {
  constructor(readonly responseText: string) {
    super("Gemini returned an unreadable response");
    this.name = "UnreadableGeminiResponseError";
  }
}

export class LiveSearchUnavailableError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly responseText: string,
  ) {
    super(message);
    this.name = "LiveSearchUnavailableError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function boundedInteger(value: unknown, max: number): number {
  return Math.max(0, Math.min(max, Math.round(numberValue(value))));
}

function listOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
}

function isAllowedTactic(value: string): value is AllowedTactic {
  return ALLOWED_TACTICS.has(value);
}

function classifySource(publisher: string, url: string): GroundedSource["type"] {
  const source = `${publisher} ${url}`.toLowerCase();
  if (
    /who\.int|cdc\.gov|nih\.gov|nhs\.uk|mayoclinic|health\.gov|health organization|health org/.test(
      source,
    )
  ) {
    return "Health org";
  }
  if (
    /\.gov(?:\.|\/|$)|\.gov\.in|gov\.uk|govt|government|ministry|\.gouv\./.test(
      source,
    )
  ) {
    return "Government";
  }
  if (
    /\.edu(?:\.|\/|$)|pubmed|doi\.org|research|journal|nature\.com|science\.org|arxiv|university/.test(
      source,
    )
  ) {
    return "Research";
  }
  return "News";
}

function extractGroundedSources(metadata: unknown): {
  sources: GroundedSource[];
  sourceChunkIndices: Map<string, number>;
  supports: Array<{ text: string; indices: number[] }>;
} {
  const grounding = record(metadata);
  const chunks = Array.isArray(grounding?.groundingChunks)
    ? grounding.groundingChunks
    : [];
  const groundingSupports = Array.isArray(grounding?.groundingSupports)
    ? grounding.groundingSupports
    : [];
  const supports = groundingSupports.flatMap((item) => {
    const support = record(item);
    const segment = record(support?.segment);
    const indices = Array.isArray(support?.groundingChunkIndices)
      ? support.groundingChunkIndices.filter(
          (index): index is number =>
            typeof index === "number" &&
            Number.isInteger(index) &&
            index >= 0 &&
            index < chunks.length,
        )
      : [];
    return indices.length
      ? [{ text: stringValue(segment?.text).toLowerCase(), indices }]
      : [];
  });
  const supportedIndices = new Set(supports.flatMap((support) => support.indices));
  const sources: GroundedSource[] = [];
  const sourceChunkIndices = new Map<string, number>();

  chunks.forEach((item, index) => {
    if (!supportedIndices.has(index)) return;
    const chunk = record(item);
    const web = record(chunk?.web);
    const url = stringValue(web?.uri);
    const metadataTitle = stringValue(web?.title);
    if (!url || !metadataTitle) return;

    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") return;
      const publisher = metadataTitle;
      sources.push({
        publisher,
        title: metadataTitle,
        url: parsedUrl.toString(),
        type: classifySource(publisher, parsedUrl.hostname),
      });
      sourceChunkIndices.set(parsedUrl.toString(), index);
    } catch {
      // A malformed URL in grounding metadata is ignored, never replaced with model text.
    }
  });

  const uniqueSources = Array.from(
    new Map(sources.map((source) => [source.url, source])).values(),
  );
  return { sources: uniqueSources, sourceChunkIndices, supports };
}

function sourceListForClaim(
  claimText: string,
  allSources: GroundedSource[],
  supports: Array<{ text: string; indices: number[] }>,
  sourceChunkIndices: Map<string, number>,
): GroundedSource[] {
  if (!allSources.length) return [];
  const terms = claimText
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2);
  const matchingIndices = new Set<number>();

  for (const support of supports) {
    const matchesClaim =
      !terms.length || terms.some((term) => support.text.includes(term));
    if (matchesClaim) support.indices.forEach((index) => matchingIndices.add(index));
  }

  if (!matchingIndices.size) {
    supports.forEach((support) =>
      support.indices.forEach((index) => matchingIndices.add(index)),
    );
  }

  return allSources
    .filter((source) => {
      const index = sourceChunkIndices.get(source.url);
      return index !== undefined && matchingIndices.has(index);
    })
    .slice(0, 8);
}

function parseModelJson(text: string): Record<string, unknown> {
  const withoutFences = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const parsed: unknown = JSON.parse(withoutFences);
  const object = record(parsed);
  if (!object) throw new Error("Gemini response was not a JSON object");
  return object;
}

function getCandidate(response: unknown): Record<string, unknown> | null {
  const responseObject = record(response);
  const candidates = Array.isArray(responseObject?.candidates)
    ? responseObject.candidates
    : [];
  return record(candidates[0]);
}

function candidateText(candidate: Record<string, unknown> | null): string {
  const content = record(candidate?.content);
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  return parts
    .map((part) => record(part)?.text)
    .filter((text): text is string => typeof text === "string")
    .join("\n")
    .trim();
}

function actionFor(verdict: CheckResult["overall_verdict"]): CheckResult["action"] {
  if (verdict === "TRUE") return "Safe to share";
  if (verdict === "FALSE") return "Don't share this";
  return "Wait for more evidence";
}

function normalizeClaim(
  value: unknown,
  grounding: ReturnType<typeof extractGroundedSources>,
): CheckedClaim {
  const source = record(value) ?? {};
  const verdict =
    source.verdict === "TRUE" || source.verdict === "FALSE"
      ? source.verdict
      : "UNCLEAR";
  const explanation = stringValue(source.explanation, "There is not enough reliable evidence to assess this claim.");
  const rawTactics = listOfStrings(source.tactics).filter(isAllowedTactic);
  const tactics = verdict === "TRUE" ? [] : rawTactics;
  const breakdown = record(source.evidence_breakdown) ?? {};
  const text = stringValue(source.text, "Claim from the submitted image");

  return {
    text,
    verdict,
    explanation,
    explanation_simple: stringValue(source.explanation_simple, explanation),
    explanation_elder: stringValue(source.explanation_elder, explanation),
    evidence_strength: boundedInteger(source.evidence_strength, 100),
    evidence_breakdown: {
      supporting: boundedInteger(breakdown.supporting, 100),
      disputing: boundedInteger(breakdown.disputing, 100),
      neutral: boundedInteger(breakdown.neutral, 100),
    },
    red_flags: listOfStrings(source.red_flags),
    tactics,
    tactic_explanations:
      verdict === "TRUE"
        ? []
        : listOfStrings(source.tactic_explanations).slice(0, tactics.length),
    why_it_spreads: stringValue(source.why_it_spreads),
    sources: sourceListForClaim(
      text,
      grounding.sources,
      grounding.supports,
      grounding.sourceChunkIndices,
    ),
  };
}

function jsonShapeInstructions(language: FactCheckInput["language"]): string {
  return `Return ONLY one valid JSON object. Do not use markdown fences. Keep every JSON key and verdict value in English. Write all explanatory text, tactic labels/explanations, and calm_reply in ${language}. Do not include any source URLs or invent source names; sources will be attached only from verified grounding metadata. If the input is a question, first rewrite it as a clear factual claim. If the input is a link, investigate the URL and check the factual claims it contains. If an image is attached, read its text and extract the factual claims before checking them.

Use this exact shape:
{"overall_verdict":"TRUE|FALSE|UNCLEAR","action":"Safe to share|Don't share this|Wait for more evidence","summary":"short evidence-based summary","calm_reply":"exactly 2 polite sentences with the verdict, key reason, and one grounded source name","claims":[{"text":"one factual claim","verdict":"TRUE|FALSE|UNCLEAR","explanation":"evidence-based explanation","explanation_simple":"very short everyday sentences","explanation_elder":"calm and respectful, with a short real-life example","evidence_strength":0,"evidence_breakdown":{"supporting":0,"disputing":0,"neutral":0},"red_flags":[],"tactics":[],"tactic_explanations":[],"why_it_spreads":"short explanation","sources":[]}]}.

Rules: Use only these tactic labels: Fear tactic, Fake authority, Cherry-picked data, Out of context, Emotional bait, Too good to be true, Old news recycled. Use an empty tactics list for TRUE claims. Return UNCLEAR when evidence is limited or conflicting. Use plain language. For dangerous health claims, tell people to contact local medical or emergency services. evidence_strength is how strongly the evidence supports the verdict, not the chance the claim is true. Simple explanations must never change the verdict.`;
}

async function requestGeminiOnce(
  input: FactCheckInput,
  model: string,
  retryInstruction = "",
): Promise<unknown> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new GeminiRequestError(
      "GEMINI_API_KEY is not configured",
      503,
      "Missing GEMINI_API_KEY",
    );
  }

  const parts: Array<Record<string, unknown>> = [
    {
      text: `${jsonShapeInstructions(input.language)}\n\nAnalyze this input:\n${input.claim?.trim() || "Check the factual claims visible in the attached image."}${retryInstruction}`,
    },
  ];
  if (input.imageBase64 && input.imageMime) {
    parts.push({
      inline_data: {
        mime_type: input.imageMime,
        data: input.imageBase64,
      },
    });
  }

  let response: Response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: "You are an evidence-first fact checker. Never invent sources. Use Google Search grounding for current facts. If search evidence is absent, limited, or conflicting, return UNCLEAR instead of guessing.",
            },
          ],
        },
        contents: [{ role: "user", parts }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new GeminiRequestError("Gemini request failed", 0, message);
  }

  if (!response.ok) {
    const responseText = await response.text();
    throw new GeminiRequestError(
      `Gemini returned HTTP ${response.status}`,
      response.status,
      responseText,
    );
  }

  try {
    return await response.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UnreadableGeminiResponseError(message);
  }
}

async function requestGemini(
  input: FactCheckInput,
  model: string,
  logAttempt?: AttemptLogger,
  retryInstruction = "",
): Promise<unknown> {
  for (let attempt = 1; attempt <= MAX_HTTP_ATTEMPTS; attempt += 1) {
    try {
      const response = await requestGeminiOnce(input, model, retryInstruction);
      logAttempt?.({ model, attempt, status: 200 });
      return response;
    } catch (error) {
      if (!(error instanceof GeminiRequestError)) throw error;
      const retryable =
        error.status === 503 &&
        error.responseText !== "Missing GEMINI_API_KEY";
      const retryDelayMs = retryable && attempt < MAX_HTTP_ATTEMPTS
        ? 1000
        : undefined;
      logAttempt?.({ model, attempt, status: error.status, errorText: error.responseText, retryDelayMs });
      if (retryDelayMs === undefined) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  throw new Error("Gemini attempt limit exhausted");
}

function isSearchUnavailableError(error: GeminiRequestError): boolean {
  return /google_search|grounding|search (?:tool|is not available|unavailable)|not supported|unsupported/i.test(
    error.responseText,
  );
}

function isInvalidKeyError(error: GeminiRequestError): boolean {
  return (
    error.status === 401 ||
    error.status === 403 ||
    /api[_ ]key (?:not valid|invalid)|invalid api key|api_key_invalid|permission_denied/i.test(
      error.responseText,
    )
  );
}

function unavailableText(language: FactCheckInput["language"]): {
  explanation: string;
  simple: string;
  elder: string;
  reply: string;
} {
  const messages = {
    English: {
      explanation:
        "Live search is unavailable right now, so this claim could not be checked against current sources.",
      simple: "Live search is unavailable right now. We do not have enough evidence to check this.",
      elder:
        "Live search is unavailable right now. It is like not being able to reach the library today; waiting is safer than guessing.",
      reply:
        "Live search is unavailable right now, so I cannot verify this claim. It is better to wait for reliable evidence before sharing.",
    },
    Hindi: {
      explanation:
        "अभी लाइव खोज उपलब्ध नहीं है, इसलिए इस दावे की मौजूदा स्रोतों से जाँच नहीं हो सकी।",
      simple: "अभी लाइव खोज उपलब्ध नहीं है। जाँच के लिए पर्याप्त सबूत नहीं मिले।",
      elder:
        "अभी लाइव खोज उपलब्ध नहीं है। इसे ऐसे समझें जैसे आज पुस्तकालय तक पहुँचना संभव न हो; अनुमान लगाने से बेहतर है थोड़ा इंतज़ार करना।",
      reply:
        "अभी लाइव खोज उपलब्ध नहीं है, इसलिए मैं इस दावे की पुष्टि नहीं कर सकता। भरोसेमंद सबूत मिलने तक इसे साझा करने के लिए इंतज़ार करना बेहतर है।",
    },
    Spanish: {
      explanation:
        "La búsqueda en vivo no está disponible ahora, así que no se pudo comprobar esta afirmación con fuentes actuales.",
      simple: "La búsqueda en vivo no está disponible ahora. No hay pruebas suficientes para comprobarlo.",
      elder:
        "La búsqueda en vivo no está disponible ahora. Es como no poder consultar la biblioteca hoy; es mejor esperar que adivinar.",
      reply:
        "La búsqueda en vivo no está disponible ahora, así que no puedo verificar esta afirmación. Es mejor esperar pruebas fiables antes de compartirla.",
    },
    French: {
      explanation:
        "La recherche en direct est indisponible pour le moment ; cette affirmation n’a donc pas pu être vérifiée avec des sources actuelles.",
      simple: "La recherche en direct est indisponible. Nous n’avons pas assez de preuves pour vérifier cela.",
      elder:
        "La recherche en direct est indisponible. C’est comme ne pas pouvoir consulter la bibliothèque aujourd’hui ; mieux vaut attendre que deviner.",
      reply:
        "La recherche en direct est indisponible, je ne peux donc pas vérifier cette affirmation. Mieux vaut attendre des preuves fiables avant de la partager.",
    },
  };
  return messages[language];
}

export function liveSearchUnavailableResult(
  input: FactCheckInput,
): CheckResult {
  const copy = unavailableText(input.language);
  const claimText = input.claim?.trim() || "Claim from the submitted image";
  return CheckClaimResponse.parse({
    overall_verdict: "UNCLEAR",
    action: "Wait for more evidence",
    summary: "Live search is unavailable right now",
    calm_reply: copy.reply,
    claims: [
      {
        text: claimText,
        verdict: "UNCLEAR",
        explanation: copy.explanation,
        explanation_simple: copy.simple,
        explanation_elder: copy.elder,
        evidence_strength: 0,
        evidence_breakdown: { supporting: 0, disputing: 0, neutral: 0 },
        red_flags: [],
        tactics: [],
        tactic_explanations: [],
        why_it_spreads: "",
        sources: [],
      },
    ],
  });
}

function buildResult(
  modelData: Record<string, unknown>,
  grounding: ReturnType<typeof extractGroundedSources>,
): CheckResult {
  const verdict: CheckResult["overall_verdict"] =
    modelData.overall_verdict === "TRUE" || modelData.overall_verdict === "FALSE"
      ? modelData.overall_verdict
      : "UNCLEAR";
  const claims = Array.isArray(modelData.claims)
    ? modelData.claims.map((claim) => normalizeClaim(claim, grounding))
    : [];
  if (!claims.length) {
    throw new UnreadableGeminiResponseError(
      "Gemini returned no claims in its JSON response",
    );
  }

  return CheckClaimResponse.parse({
    overall_verdict: verdict,
    action: actionFor(verdict),
    summary: stringValue(modelData.summary, claims[0]?.explanation ?? ""),
    calm_reply: stringValue(modelData.calm_reply, claims[0]?.explanation ?? ""),
    claims,
  });
}

export function validateInlineImage(input: FactCheckInput): string | null {
  if (!input.imageBase64) return null;
  if (!input.imageMime) return "Image MIME type is required.";
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.imageBase64)) {
    return "The image data is not valid base64.";
  }
  const bytes = Buffer.from(input.imageBase64, "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    return "Images must be smaller than 3 MB.";
  }
  const isPng =
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (
    (input.imageMime === "image/png" && !isPng) ||
    (input.imageMime === "image/jpeg" && !isJpeg)
  ) {
    return "The uploaded image does not match its PNG or JPEG file type.";
  }
  return null;
}

async function checkWithModel(input: FactCheckInput, model: string, logAttempt?: AttemptLogger): Promise<CheckResult> {
  const apiResponse = await requestGemini(input, model, logAttempt);
  let modelData: Record<string, unknown>;

  const candidate = getCandidate(apiResponse);
  const text = candidateText(candidate);
  try {
    modelData = parseModelJson(text);
  } catch {
    throw new UnreadableGeminiResponseError(text);
  }

  const finalCandidate = getCandidate(apiResponse);
  const grounding = extractGroundedSources(finalCandidate?.groundingMetadata);
  if (!grounding.sources.length || !grounding.supports.length) {
    throw new LiveSearchUnavailableError(
      "Gemini returned no usable Google Search grounding metadata",
      200,
      "No supported sources in groundingMetadata",
    );
  }
  const result = buildResult(modelData, grounding);
  logAttempt?.({ model, attempt: 0, status: 200, grounded: true });
  return result;
}

export async function checkWithGemini(input: FactCheckInput, logAttempt?: AttemptLogger): Promise<CheckResult> {
  for (let index = 0; index < MODELS.length; index += 1) {
    const model = MODELS[index]!;
    try {
      return await checkWithModel(input, model, logAttempt);
    } catch (error) {
      const canTryNextModel =
        error instanceof LiveSearchUnavailableError ||
        (error instanceof GeminiRequestError &&
          error.responseText !== "Missing GEMINI_API_KEY" &&
          !isInvalidKeyError(error) &&
          (error.status === 429 || error.status === 503 || error.status === 404 || isSearchUnavailableError(error)));
      if (!canTryNextModel || index === MODELS.length - 1) throw error;
    }
  }
  throw new Error("No Gemini model available");
}
