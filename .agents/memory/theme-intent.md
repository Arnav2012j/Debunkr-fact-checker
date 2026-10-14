---
name: Theme intent
description: User-selected base theme has precedence over verdict moods.
---
Light, Dark, and System remain the base theme for every verdict. Verdict moods may change the sticker, accents, and mascot only; they must never switch the page's base theme.

**Why:** The user reported Dark flipping to white, then explicitly specified that verdicts must not change the base theme. The newer instruction replaces the old Light/FALSE dramatic exception. The current requested brand uses a tactile sticker palette rather than lime-and-ink.

**How to apply:** Preserve base-theme ownership for every verdict and use its mood only for stickers, accents, and the mascot. Follow any newer user instruction about the brand palette; do not reintroduce glows, gradients, or glass effects.

Keep pre-paint page colors and browser theme-color metadata aligned with the current base palette, not only the React stylesheet tokens.

**Why:** Older inline page-background rules overrode a redesigned Night palette despite correctly updated component tokens. Background shorthand also erased the dotted paper pattern.

**How to apply:** When changing the palette, audit pre-paint markup and settings styles together. Use background-color for the initial page color when a stylesheet supplies a background pattern.
