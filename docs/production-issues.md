# DENBUNKR: production provider failure and OpenRouter migration

## Confirmed incident

Status: failure identified; replacement integration implemented and availability
probed locally, not deployed or verified with an authenticated production request.

The user reported two earlier successful checks, followed by repeated failure of
“Who won the latest Nobel Peace Prize?”. The interface showed “Searching sources”
and then “The checking service had a problem. Please try again.”

The user supplied this Vercel runtime event (timestamp/request ID not supplied):

- Provider: Gemini; model `gemini-3.8-flash`
- HTTP status: **503**; duration: **2257 ms**; `timedOut: false`
- Message: “This model is currently experiencing high demand. Spikes in demand
  are usually temporary. Please try again later.”
- Event: `Gemini attempt failed`, stage `gemini`, attempt 1

This confirms upstream Gemini unavailability on at least one production attempt.
It does not establish every attempt's cause or the primary model's status.
No direct access to Vercel runtime logs was available; the event was user-supplied.
The visual tracker is driven by an estimate, not backend stage telemetry, so its
“Searching sources” label does not establish a Tavily failure.

## Scoped replacement

Tavily still retrieves evidence once. The LLM now uses OpenRouter Chat Completions:

1. Primary: `dots-studio/dots-3-note-preview:free`
2. Fallback: `google/gemma-4-26b-a4b-it:free`

On 2026-10-26, OpenRouter's public models catalog and endpoint metadata requests
returned HTTP 200 and listed zero token prices, text/image input, JSON output
support and an endpoint with status 0. Metadata alone did not prove usable capacity.

The first proposed pair, Gemma 4 26B and Gemma 4 31B, failed the single live Nobel
request: Tavily returned HTTP 200 with six results in 2779 ms, then the two models
returned HTTP 429 in 742 ms and 780 ms. Both errors identified Google AI Studio
and `limit_source: upstream_provider_shared_pool`, not proven daily account quota
exhaustion. API response: 429, no verdict/citations, about 4415 ms client elapsed.
The Nobel request was not repeated and no failure was cached.

After the key became available in the workspace, a separate minimal authenticated
availability probe through the same adapter succeeded for
`dots-studio/dots-3-note-preview:free`: HTTP 200, valid `{"ok":true}`, 1633 ms.
This establishes a working completion with this key at that moment, not a
successful full fact-check or a production latency guarantee. It is now primary.
Its endpoint lists AtlasCloud; the one fallback lists Google AI Studio and had
the shared-pool limit above. Catalog entries for other investigated Nvidia models
did not list status 0; no authenticated requests were sent to them.

The user added the OpenRouter key securely; its value was never displayed.
No Gemini key, Tavily key, production secret, or deployment setting was changed
by the agent. Free capacity, provider availability and account limits can change.

Requests use explicit `:free` model IDs plus zero prompt/completion price caps,
JSON-object response format, 2500 output tokens, and disabled reasoning. There are
no OpenRouter web plugins or tools: Tavily remains the sole evidence retriever.
Image-plus-claim input is sent as a base64 image URL part. The pre-existing
image-only empty-search limitation is not changed by this provider migration.

## Safety, timeouts and compatibility

- Same public fact-check request/response schema and citation normalization.
- Only references to supplied Tavily results can become citations. Model-provided
  URLs are ignored. Unsupported/conflicting verdicts are downgraded to UNCLEAR.
- Search failure retains the uncached, source-free UNCLEAR fallback.
- One 20-second server deadline includes search, model attempts and cache work;
  Tavily gets at most 5 seconds and each model at most 12 seconds within that budget.
  The browser timeout remains 22 seconds.
- One attempt per model. Timeout/network/transient failures, 404 and 429 may try the
  second model; missing credentials, authentication failures, 400 and 402 do not.
- Invalid, incomplete, refused, truncated or malformed output returns an error,
  never a made-up verdict. HTTP-200 embedded provider errors are also rejected.
- Existing `GEMINI_ERROR` / `GEMINI_RATE_LIMITED` wire codes remain as legacy
  provider-error codes so already deployed frontend versions continue to work.
  Logs now explicitly identify `provider: openrouter`, model, status and timings.
  Provider-429 wording in all four UI languages now says busy/rate-limited rather
  than claiming every upstream throttle is daily quota exhaustion.
- The historical filename `geminiFactCheck.ts` now holds provider-independent
  evidence/prompt/result logic; `openRouter.ts` holds the transport.
- Cache writes remain non-fatal. Cache loading accepts the selected OpenRouter
  model IDs as well as old Gemini entries. Existing real cached results are not
  deleted, and a cache hit can therefore still report an old Gemini model.
- Provider error logs redact all three API keys; no secret values or sensitive
  authorization headers should be pasted into troubleshooting reports.

## Verification commands

From the repository root:

```sh
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run build
node --test artifacts/api-server/test/check-flow.test.mjs
pnpm --filter @workspace/debunkr run typecheck
pnpm --filter @workspace/debunkr run build
```

The test suite replaces every external provider call. It checks free-only request
settings, fallback and deadlines, HTTP and embedded failures, malformed/refused/
truncated responses, missing credentials, image transport, citation preservation,
unsupported verdict downgrade, cache cold starts/write failures and client routing.
Mock fixtures are test data, not stored production fact-check results.

### Local verification results (2026-10-26)

| Check | Result |
| --- | --- |
| API typecheck | PASS |
| API esbuild build | PASS |
| Mocked API/client tests | PASS — 34 tests, 0 failures |
| Frontend typecheck | PASS |
| Frontend Vite production build | PASS |
| Authenticated primary availability probe | PASS — valid JSON, HTTP 200, 1633 ms |
| One live Nobel check with initial Gemma pair | FAIL — both models returned upstream shared-pool 429; Tavily succeeded |
| Full fact-check with final Dots primary | NOT RUN — no repeat live claim submission |
| Live source-page relevance review | NOT RUN — the live request produced no verdict/citations |
| Vercel deployment verification | NOT RUN — no deployment was initiated |

The frontend build still reports a non-fatal tooltip sourcemap-location warning and
a bundle-size warning over 500 kB. API bundles also have esbuild size advisories.
These warnings do not fail the builds and were not changed by this migration.

## Manual production verification (not performed)

1. Review and sync the changed source/test/documentation files to GitHub.
2. Confirm `OPENROUTER_API_KEY` is present for the intended Vercel deployment
   environment; keep `GEMINI_API_KEY` and `TAVILY_API_KEY` unchanged.
3. After explicit approval, redeploy the backend. Redeploy the frontend to receive
   the corrected provider-rate-limit wording; its layout and behavior are unchanged.
   Adding a key/redeploying old source alone does not switch providers.
4. Submit one uncached claim. Verify one Tavily search and an OpenRouter model
   attempt in Vercel logs, with status and duration. Inspect the actual response
   schema and cited source pages for relevance; do not infer success from HTTP 200
   on the catalog or the estimated tracker.
5. If both models are busy, require an error without `overall_verdict`. If search
   fails, require source-free UNCLEAR. Check that no error gets cached.

Current remaining uncertainty: Vercel account/configuration parity, privacy/routing
settings, free capacity/quota, full-prompt latency, and live evidence relevance.

## References

- https://openrouter.ai/api/v1/models
- https://openrouter.ai/api/v1/models/dots-studio/dots-3-note-preview:free/endpoints
- https://openrouter.ai/api/v1/models/google/gemma-4-26b-a4b-it:free/endpoints
- https://openrouter.ai/api/v1/models/google/gemma-4-31b-it:free/endpoints
- https://openrouter.ai/docs/api/reference/overview
- https://openrouter.ai/docs/guides/routing/provider-selection
