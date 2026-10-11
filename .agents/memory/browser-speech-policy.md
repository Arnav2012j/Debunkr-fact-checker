---
name: Browser speech policy
description: Why speech must not regenerate or translate existing fact-check results.
---
Voice input, read aloud, and quick-link utilities must not introduce extra Gemini or Tavily calls.

**Why:** The user explicitly constrained these conveniences to browser APIs and existing check/cache behavior. Changing language does not translate already-generated explanations.

**How to apply:** Never add a translation or regeneration request to enable narration. If the current app language differs from the result language, show the next-check language note instead of narrating in a mismatched voice. Explicit Check submissions and explicitly requested auto-check links remain the only check triggers.
