---
name: Wait estimate intent
description: Product requirement for honest Analysis wait-time and progress messaging.
---
Analysis wait time is a heuristic estimate, not evidence that a provider has reached a particular stage.

**Why:** The user explicitly requires estimates to be labeled as estimates, overrun messaging instead of zero or negative remaining time, and no completed verdict until a response actually arrives.

**How to apply:** Keep these distinctions when revising the tracker or timer. Cached answers and development fixtures must not teach the app that real checks are instantaneous or artificially slow.
