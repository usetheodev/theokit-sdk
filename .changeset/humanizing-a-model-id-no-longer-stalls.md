---
"@theokit/sdk": patch
---

`humanizeModelName` stripped trailing slashes with a pattern that backtracks. On a model id ending
in a long run of slashes, the engine consumed to the end of the string at every start position:
25,000 slashes took half a second, 100,000 took **31 seconds** with one CPU pinned — to render a
label.

The trim is now a single linear pass. Behaviour is unchanged: a trailing slash is still stripped,
several are still stripped, and an id without one is untouched.
