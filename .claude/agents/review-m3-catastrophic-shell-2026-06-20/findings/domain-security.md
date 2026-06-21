# domain-security (adversarial) — m3-catastrophic-shell
Verdict (initial): 0 BLOCKER, 1 HIGH, 3 MEDIUM, 2 LOW-by-contract. 41-case matrix executed.
- HIGH F1 → FIXED: DEVICE_REDIRECT broken for all real device names (\b bug).
- MEDIUM F2 → FIXED: rm -rf of /etc//usr//home//var//boot false negatives (only literal / blocked).
- MEDIUM F3 → FIXED: chown -R / unchecked.
- MEDIUM F4 → FIXED: git push origin +main (+refspec force) false negative.
- LOW F5 (accepted): sh -c "payload" nested shell not re-screened — out of scope ADR D5; code comment added.
- LOW F6 (accepted): rm${IFS}-rf${IFS}/ runtime obfuscation — out of scope ADR D5.
- INFO: zero false positives across the matrix; command-position design sound; fail-closed pre-spawn default allowCatastrophic=false.
Post-fix adversarial re-run: 9/9 should-block now block, 8/8 should-allow allowed — ALL GOOD.
