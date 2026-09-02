---
"@theokit/sdk": patch
---

Telemetry auto-instrumentation now logs what each adapter actually wired.

Five of the seven adapters install something concrete — an OTel span processor,
an event processor, a vendor client. Braintrust and LangSmith cannot: those
vendors auto-instrument from an env var, so loading the module is the whole
contribution. Both are legitimate, but the registry printed
`Braintrust auto-instrumented.` for the second kind, which read as a wired
telemetry pipeline when nothing had been installed.

`register()` now returns what it wired and the registry reports that instead of
asserting a single outcome for all seven. A vendor that is detected but cannot
be wired says so too, rather than being logged as instrumented.
