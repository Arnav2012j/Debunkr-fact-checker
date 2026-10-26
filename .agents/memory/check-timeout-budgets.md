---
name: Check timeout budgets
description: Distinguish the browser's whole-check deadline from per-provider timeouts.
---
All provider stages and fallback attempts must share one server-side request deadline. Keep the browser deadline slightly longer so it can receive the server's explicit timeout response.

**Why:** The user replaced the earlier independent provider/browser limits after the fallback chain could outlive the browser and surface a generic error. The priority is now a bounded wait and an honest failure, not giving every model a fresh full timeout.

**How to apply:** Limit each stage by the remaining overall budget, include body reads and cache work, and never start fallback after the request deadline. Preserve evidence checks; a deadline must return an error, never an invented verdict. Treat the normal-provider speed goal as a target, not a measured guarantee.
