---
name: Vercel hidden emit errors
description: Why Vercel can report Emit skipped even when ordinary TypeScript compilation passes.
---

When Vercel reports “Emit skipped” while ordinary TypeScript checks pass, inspect its Node builder's language-service compilation path before changing application code or weakening checks.

**Why:** The builder filters TS6059 from displayed diagnostics, but an imported workspace TypeScript source outside the configured compilation root can still prevent emission. Its language-service host does not provide project references the way a normal project compilation does. This was reproduced by compiling the app, routes index, and health route sequentially; the health emit failed with TS6059 despite ordinary emitting and no-emit builds succeeding.

**How to apply:** Reproduce with the installed TypeScript version and the builder's configuration overrides and language-service host. Keep `noEmitOnError` enabled. A compilation root that encompasses imported workspace source avoids the boundary error without replacing shared dependencies. Re-check the current Vercel builder source because its behavior can change.

For Fetch response-property errors, check the Node Fetch declarations' transitive type resolution before casting the response or replacing native fetch.

**Why:** In the Vercel-style language-service reproduction, pnpm's symlinked Node declarations could not resolve their Undici declarations, leaving the global `Response` interface with no properties. Normal project typechecking resolved those declarations successfully. Making the existing compatible Undici types directly accessible from the API package fixed the compiler path without changing runtime code.

**How to apply:** Inspect the inferred response's properties and resolve the Undici type import from both the symlinked and real Node declaration paths. Prefer an explicit development dependency on the compatible types over type assertions, handwritten response interfaces, or adding browser globals to a server configuration.

Treat the custom bundle build and Vercel Express entrypoint selection as separate steps.

**Why:** Vercel's Express builder chooses an entrypoint after build scripts run. A successful esbuild bundle does not mean the runtime loads that bundle; it may instead choose source whose directory imports native Node ESM rejects. Its detector prioritizes root app entrypoints over source entrypoints and requires a literal Express package import.

**How to apply:** Verify the actual detected entrypoint and import it with native Node, not just through a bundler. Preserve the separate listening-server path for Replit. When using a bundled Express-app shim, keep its explicit Express import because the detector checks source text; removing an apparently unused import can change which entrypoint Vercel selects.
