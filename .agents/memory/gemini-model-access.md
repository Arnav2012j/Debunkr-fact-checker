---
name: Gemini model access
description: Distinguish documented capabilities from actual model availability for this API project.
---

Use actual Gemini API responses to establish model availability; a documented Google Search capability does not guarantee access.

**Why:** On 2026-10-10, both Gemini 2.5 Flash variants returned HTTP 404 saying they were no longer available to new users, despite appearing in grounding documentation. Other Flash models had returned quota errors instead.

**How to apply:** Report model-access failures distinctly from quota failures. If the user specifies an exact model list, do not silently substitute a different model.

Assess plain generation separately from built-in search tool availability.

**Why:** Plain requests succeeded with the same project's key after built-in Google Search requests had returned quota failures. The user chose Tavily for retrieval and Gemini only for evidence-based judging to avoid that tool dependency.

**How to apply:** Do not infer that a plain Gemini model is unusable from a search-tool quota error, and do not restore built-in search without user approval.
