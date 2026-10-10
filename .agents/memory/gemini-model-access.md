---
name: Gemini model access
description: Distinguish documented capabilities from actual model availability for this API project.
---

Use actual Gemini API responses to establish model availability; a documented Google Search capability does not guarantee access.

**Why:** On 2026-10-10, both Gemini 2.5 Flash variants returned HTTP 404 saying they were no longer available to new users, despite appearing in grounding documentation. Other Flash models had returned quota errors instead.

**How to apply:** Report model-access failures distinctly from quota failures. If the user specifies an exact model list, do not silently substitute a different model.
