---
"@theokit/sdk": patch
---

Provider-reported token usage is validated before it reaches `run.usage`, the cost calculation and
`@theokit/sdk-budget`.

A negative count used to be billed as a negative cost and moved a budget gate downward; a numeric
string was concatenated rather than summed, producing `"0100050"` where a total was intended. Both
now drop with a diagnostic naming the field, and a numeric string parses. Fractional counts are
floored rather than discarded.

Magnitude is deliberately not checked: any ceiling here would be invented, rejecting a legitimate
large batch while still passing anything just under it. That is a budget policy, and
`@theokit/sdk-budget` is where a cap belongs.
