---
name: Check timeout budgets
description: Distinguish the browser's whole-check deadline from per-provider timeouts.
---
A successful primary-model check does not prove that fallback will finish before the browser's deadline.

**Why:** The user explicitly requested a browser deadline shorter than the worst-case search plus two full model attempts. These limits were kept as requested, rather than silently increasing the browser timeout.

**How to apply:** Account for the entire search-and-judge chain when discussing timeout guarantees. Obtain approval before changing explicitly requested deadlines to accommodate worst-case fallback time.
