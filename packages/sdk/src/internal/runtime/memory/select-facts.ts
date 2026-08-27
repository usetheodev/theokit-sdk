import type { MemoryFact } from "../../memory/types.js";

/**
 * Selection for injection: rank the store and cut it, so what enters the prompt stops
 * tracking what is on disk.
 *
 * Before this, `readMemoryForSend` returned every fact and the system prompt carried all of
 * them, every turn. Measured across 99 real stores, injected bytes correlated with entry
 * count at r = 0.958 — roughly 1,060 tokens per entry, crossing the 60 KB session budget at
 * 16 facts. Ten stores were already past it; the largest injected ~72.6K tokens per turn,
 * before the user's first message. That is not a ranking-quality problem, it is arithmetic.
 *
 * Ranking uses `modified`, which the store has always stamped, parsed and typed — and never
 * read. The field's own doc comment says what it is for: "the whole point is to weigh a note
 * from this morning against one from four months ago."
 *
 * WHY TWO BUCKETS, and not `(a.modified ?? "").localeCompare(...)`:
 *
 * A fact without `modified` is not old, it is UNDATED — written before the field existed, or
 * hand-added to `MEMORY.md` by someone the store's own header invites to edit it. Sorting it
 * as if it were from 1970 is inference wearing the costume of a default, and this codebase
 * already rejects that reasoning one field over: "A kind is never INFERRED. A wrong kind is
 * worse than none." The same holds here. So undated facts get a guaranteed share of the
 * budget instead of a fabricated timestamp that buries them.
 */

/** Defaults are the session budget of the recall contract, not tuning knobs found by trial. */
export const DEFAULT_MAX_ENTRIES = 10;

/**
 * Characters per token, measured over the real memory corpus (99 stores, 685 entries).
 * Named rather than folded into the byte cap, because the first version of this file did fold
 * it in and got the cap wrong: the contract's budget is 15,000 TOKENS, "60 KB" was the
 * rounded-off char figure someone wrote next to it, and 60 * 1024 chars is 16,605 tokens —
 * 11% over the ceiling it claimed to enforce. A budget stated in one unit and enforced in
 * another is a budget nobody is enforcing.
 */
export const CHARS_PER_TOKEN = 3.7;

/** The recall contract's per-session ceiling, in the unit the contract states it in. */
export const DEFAULT_MAX_TOKENS = 15_000;

/** Derived, never hand-rounded. */
export const DEFAULT_MAX_BYTES = Math.floor(DEFAULT_MAX_TOKENS * CHARS_PER_TOKEN);

/** Share of `maxEntries` reserved for undated facts before dated ones may claim the rest. */
export const DEFAULT_UNDATED_SHARE = 0.5;

export interface SelectFactsOptions {
  maxEntries?: number;
  maxBytes?: number;
  undatedShare?: number;
  /**
   * The turn's text. When given, facts are ranked by lexical relevance to it, fused with
   * recency. When absent, ranking falls back to recency alone.
   *
   * Measured (T3, live model, 25-fact store): with recency-only ranking, a fact that answers
   * the question is MISSED when it is the oldest entry and RECALLED when it is the newest.
   * Recency is not relevance, and a store only has to outgrow the cap once for the difference
   * to decide whether the agent can answer.
   */
  query?: string;
}

/**
 * Function words carry no retrieval signal and actively hurt: every "Internal note N: the
 * reporting job..." shares "the" with every question, which was enough to put filler ahead of
 * the answering fact in a live run.
 */
const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "are",
  "was",
  "with",
  "that",
  "this",
  "from",
  "have",
  "has",
  "had",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "how",
  "its",
  "it's",
  "you",
  "your",
  "not",
  "but",
  "all",
  "can",
  "will",
  "just",
  "value",
  "answer",
  "please",
  "about",
]);

/** Words worth matching on: 3+ chars, lowercased, deduplicated, function words removed. */
function terms(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
  );
}

/**
 * Lexical relevance, no dense vectors — ADR-01 permits substring, Jaccard-on-words and BM25,
 * and forbids embeddings in this path. This is the first two; BM25 needs corpus statistics the
 * caller does not have here and is the next increment.
 */
function relevance(fact: MemoryFact, queryTerms: Set<string>): number {
  if (queryTerms.size === 0) return 0;
  const factTerms = terms(fact.text);
  if (factTerms.size === 0) return 0;
  let shared = 0;
  for (const w of queryTerms) if (factTerms.has(w)) shared += 1;
  if (shared === 0) return 0;
  // Jaccard over the union, so a long fact does not win by sheer vocabulary size.
  const union = new Set([...queryTerms, ...factTerms]).size;
  return shared / union;
}

/**
 * Reciprocal Rank Fusion over the ranked lists, with the constant the contract names. RRF
 * combines orderings without inventing weights for signals measured on different scales —
 * which is the trap a hand-tuned `0.6 * relevance + 0.4 * recency` walks straight into.
 */
const RRF_K = 60;

/**
 * Facts that match the question come first; the rest fill whatever budget is left, by recency.
 *
 * The split is not a refinement of RRF — it corrects a real failure. Fusing one flat list at
 * k = 60 over a 25-fact store compressed the rank differences until recency won outright: the
 * answering fact scored 1/61 + 1/85 = 0.0282 against a filler's 1/74 + 1/61 = 0.0299, and was
 * dropped. k = 60 is calibrated for lists of hundreds; a memory store is not one.
 *
 * Within the matching group RRF still does the work it is good at — combining relevance and
 * recency orderings without inventing weights for signals measured on different scales.
 */
function rankForQuery(facts: readonly MemoryFact[], queryTerms: Set<string>): MemoryFact[] {
  const scored = facts.map((f) => ({ f, score: relevance(f, queryTerms) }));
  const matching = scored.filter((s) => s.score > 0).map((s) => s.f);
  const rest = scored.filter((s) => s.score === 0).map((s) => s.f);

  const byRelevance = [...matching].sort(
    (a, b) => relevance(b, queryTerms) - relevance(a, queryTerms),
  );
  const byRecency = [...matching].sort((a, b) =>
    (b.modified ?? "").localeCompare(a.modified ?? ""),
  );
  const rank = new Map<MemoryFact, number>();
  const add = (list: readonly MemoryFact[]): void => {
    list.forEach((f, i) => {
      rank.set(f, (rank.get(f) ?? 0) + 1 / (RRF_K + i + 1));
    });
  };
  add(byRelevance);
  add(byRecency);
  const fused = [...matching].sort((a, b) => (rank.get(b) ?? 0) - (rank.get(a) ?? 0));

  return [...fused, ...rest.sort((a, b) => (b.modified ?? "").localeCompare(a.modified ?? ""))];
}

/**
 * Split into dated and undated, each ordered by the best signal it has.
 *
 * Dated facts fuse relevance with recency when there is a query, and fall back to recency
 * alone when there is not. Undated facts have no timestamp to fall back on, so relevance is
 * the only ordering they admit; without a query they keep read order, which is index order and
 * the only signal they carry.
 */
function rankBuckets(
  facts: readonly MemoryFact[],
  query: string | undefined,
): { dated: MemoryFact[]; undated: MemoryFact[] } {
  const dated: MemoryFact[] = [];
  const undated: MemoryFact[] = [];
  for (const f of facts) {
    (f.modified === undefined ? undated : dated).push(f);
  }

  const queryTerms = terms(query ?? "");
  if (queryTerms.size === 0) {
    // ISO 8601 sorts lexicographically, which is why the store stamps it.
    dated.sort((a, b) => (b.modified as string).localeCompare(a.modified as string));
    return { dated, undated };
  }
  return {
    dated: rankForQuery(dated, queryTerms),
    undated: [...undated].sort((a, b) => relevance(b, queryTerms) - relevance(a, queryTerms)),
  };
}

/**
 * Rank and cut. Returns at most `maxEntries` facts totalling at most `maxBytes`.
 *
 * Neither bucket starves the other: a quota one bucket cannot fill is available to the
 * other, so a store of only dated facts still fills the whole budget.
 */
export function selectFactsForInjection(
  facts: readonly MemoryFact[],
  options: SelectFactsOptions = {},
): MemoryFact[] {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const undatedShare = options.undatedShare ?? DEFAULT_UNDATED_SHARE;

  if (maxEntries <= 0 || maxBytes <= 0) return [];
  if (facts.length === 0) return [];

  const { dated, undated } = rankBuckets(facts, options.query);

  // Undated keep read order: the store lists them in index order, which is the only
  // ordering signal they carry. Inventing one would be the same mistake as inventing a date.
  const undatedQuota = Math.min(undated.length, Math.ceil(maxEntries * undatedShare));
  const datedQuota = maxEntries - undatedQuota;

  const picked: MemoryFact[] = [];
  let bytes = 0;
  // Cursor per bucket: the second pass resumes where the first stopped instead of
  // rescanning, which would re-pick facts already taken.
  let datedAt = 0;
  let undatedAt = 0;

  const take = (pool: readonly MemoryFact[], from: number, quota: number): number => {
    let i = from;
    let taken = 0;
    while (i < pool.length && taken < quota && picked.length < maxEntries) {
      const f = pool[i] as MemoryFact;
      i += 1;
      const size = f.text.length;
      // A single fact larger than the remaining budget is skipped rather than allowed to
      // consume it: one entry crowding out ten is the failure this function exists to stop.
      if (bytes + size > maxBytes) continue;
      picked.push(f);
      bytes += size;
      taken += 1;
    }
    return i;
  };

  datedAt = take(dated, datedAt, datedQuota);
  undatedAt = take(undated, undatedAt, undatedQuota);
  // Whatever quota a bucket could not fill is now free for the other one.
  datedAt = take(dated, datedAt, maxEntries - picked.length);
  take(undated, undatedAt, maxEntries - picked.length);

  return picked;
}
