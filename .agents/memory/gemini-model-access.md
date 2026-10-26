---
name: Provider model access
description: Distinguish documented or catalog capabilities from actual authenticated model availability.
---

Use actual Gemini API responses to establish model availability; a documented Google Search capability does not guarantee access.

**Why:** On 2026-10-10, both Gemini 2.5 Flash variants returned HTTP 404 saying they were no longer available to new users, despite appearing in grounding documentation. Other Flash models had returned quota errors instead.

**How to apply:** Report model-access failures distinctly from quota failures. If the user specifies an exact model list, do not silently substitute a different model.

Assess plain generation separately from built-in search tool availability.

**Why:** Plain requests succeeded with the same project's key after built-in Google Search requests had returned quota failures. The user chose separate Tavily retrieval and LLM evidence judging to avoid that tool dependency.

**How to apply:** Do not infer that a plain Gemini model is unusable from a search-tool quota error, and do not restore built-in search without user approval.

For OpenRouter, report zero-price catalog/endpoint metadata separately from a
successful authenticated completion. Neither listing nor an active endpoint
proves account access, free capacity, latency, or valid fact-check generation.

**Why:** A production-only key is not automatically available in the development
workspace; public metadata can be checked when authenticated generation cannot.
Even healthy, zero-priced endpoint listings have returned shared-upstream-pool
429 responses during authenticated requests. That is not proof of daily account
quota exhaustion.

**How to apply:** Mark authenticated completion NOT RUN when its key is
unavailable. Do not claim that a catalog check establishes a working provider,
and do not use a different provider or paid route to conceal missing verification.
