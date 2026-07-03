---
"@theokit/sdk": minor
"@theokit/sdk-cache": minor
---

Fix a cross-model semantic-cache false hit and add session revert (#67). (1) **Model-scoped cache:** the semantic-search path filtered eligible entries by embedder + namespace + dim + expiry but NOT `modelId`, so two models sharing an embedder could return each other's cached response; `semanticSearch` / `isEligibleForSearch` now require `modelId` equality (the composite KV key already included it). (2) **Session revert:** `ConversationStorageAdapter.truncateConversation(id, keepCount)` reverts a transcript back to its first `keepCount` messages ("undo the last turn(s)"), rewriting the JSONL atomically under the same cross-process lock as append/compaction; the FS + in-memory adapters implement it. `keepCount <= 0` empties, `keepCount >= length` is a no-op.
