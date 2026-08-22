---
"@theokit/sdk": patch
---

The memory index's `LIKE` fallback — used when FTS5 cannot tokenise a query, which is the normal
path for CJK text — escaped `%` and `_` but not the backslash that its own `ESCAPE '\'` clause
depends on. A query containing a backslash produced a pattern where the inserted escape was
consumed escaping the user's backslash, leaving the next wildcard live:

```
search for   x\%y
old pattern  %x\\%y%     the % is unescaped — matches anything between "x\" and "y"
```

So a literal search silently became a scan, returning rows the caller never asked for. Escaping the
backslash first fixes it, and the rule now lives in one function with the ordering argument written
next to it.

Separately, `ContextManager` called `stat()` on each source file and discarded the result before
reading it. `readFile` already fails when the file is gone, so the extra lookup added nothing but a
window in which the path could resolve to a different file between the two calls. It is gone.
