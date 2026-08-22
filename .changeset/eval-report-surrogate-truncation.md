---
"@theokit/cli": patch
---

`theokit eval --output report.md` no longer emits a lone UTF-16 surrogate when a
dataset input or model output is truncated (#342). The cut counted code units, so
a boundary landing between the halves of an emoji kept one half — a lone
surrogate has no UTF-8 encoding, so writers and markdown renderers downstream
either substitute U+FFFD or reject the file.

Truncation now cuts only on a character boundary. The width budget stays in code
units, since it exists to keep the table narrow; what changed is where the cut may
fall.
