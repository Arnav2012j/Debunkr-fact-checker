---
name: Vercel hidden emit errors
description: Why Vercel can report Emit skipped even when ordinary TypeScript compilation passes.
---

When Vercel reports “Emit skipped” while ordinary TypeScript checks pass, inspect its Node builder's language-service compilation path before changing application code or weakening checks.

**Why:** The builder filters TS6059 from displayed diagnostics, but an imported workspace TypeScript source outside the configured compilation root can still prevent emission. Its language-service host does not provide project references the way a normal project compilation does. This was reproduced by compiling the app, routes index, and health route sequentially; the health emit failed with TS6059 despite ordinary emitting and no-emit builds succeeding.

**How to apply:** Reproduce with the installed TypeScript version and the builder's configuration overrides and language-service host. Keep `noEmitOnError` enabled. A compilation root that encompasses imported workspace source avoids the boundary error without replacing shared dependencies. Re-check the current Vercel builder source because its behavior can change.
