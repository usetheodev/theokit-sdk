# Changelog

## [0.1.0] - 2026-05-24

### Added
- Initial release. Email platform adapter for `@usetheo/gateway` (Roadmap v1.4 #4).
- `EmailAdapter` extending `BasePlatformAdapter` (ADRs D327-D339).
- Community-standard stack: `nodemailer@^8` (SMTP) + `imapflow@^1` (IMAP IDLE) + `mailparser@^3` (RFC 5322).
- IMAP IDLE preferred, 15s polling fallback (D328).
- Threading via `Message-ID` / `In-Reply-To` / `References` chain — RFC 5322 §3.6.4 (D329).
- `splitForEmail`-style 50000-char body truncation (EC-2).
- Automated-sender filter ON by default (regex + RFC 3834 `Auto-Submitted` header) — D332.
- Allowed-sender allowlist with bracketed-entry normalization (D333 + EC-3).
- `mapEmailError` HTTP / plain-Error mapper.
- DM-only channel mapping (D336); group threads deferred to v0.2.
- Outbound threading reciprocity with References dedup (D337 + EC-6).
- Own-address loopback drop guard (EC-1 CRITICAL).
- Concurrent dispatch serialized via Promise queue (EC-4).
- Subject fallback `"(no subject)"` when missing (EC-5).
- Seen-UID Set with FIFO cap at 5000 (D331).
