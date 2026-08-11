---
"@theokit/sdk": patch
---

Publish with npm provenance attestation.

The release workflow disabled it with the reason "npm refuses provenance attestation for PRIVATE
source repositories — this repo is currently private". The repository is public; the precondition the
comment named as its own migration trigger was already met and nothing had acted on it.

A consumer can now verify a tarball was built by the release workflow from a specific commit, rather
than trusting that whoever held the publish token was us. The tokenless OIDC binding — configured per
package on npmjs.com rather than in this repository — remains the next step.
