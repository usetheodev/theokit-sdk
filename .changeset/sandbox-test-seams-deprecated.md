---
"@theokit/sdk": patch
---

`@theokit/sdk/sandbox` marks `resetInteractiveWarnLatch` and `resetSandboxWarnLatch`
as deprecated. Both are test seams for WARN-once latches that were re-exported
under plain camelCase, reading like ordinary API. They still work and are removed
in the next major; there is no replacement, because production code has no reason
to reset a warn-once latch.

`resetBwrapMemo` is NOT deprecated and now documents why it is public: it is the
companion to `detectBwrapMemoized`, and the only way to make a long-lived host
re-probe after `bwrap` is installed.
