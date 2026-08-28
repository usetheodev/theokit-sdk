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

import type { MemoryFact } from "../../memory/types.js";

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
 * Reciprocal Rank Fusion damping. RRF combines orderings without inventing weights for signals
 * measured on different scales — the trap a hand-tuned `0.6 * relevance + 0.4 * recency` walks
 * straight into.
 *
 * FIVE, not the literature's 60. k = 60 is calibrated for TREC-scale runs of hundreds of
 * documents; a memory store is tens. At 60 the reciprocals of adjacent ranks differ by under 2%,
 * so the fusion flattens into a near-tie and whichever list is evaluated last effectively decides.
 *
 * Swept against both corpora rather than chosen:
 *
 *   k    LongMemEval-S (500q)   coding-agent-life (15q)
 *   60   484/500                14/15
 *   30   484/500                14/15
 *   10   484/500                14/15
 *    5   484/500                15/15
 *    1   484/500                15/15
 *
 * The large corpus is INSENSITIVE to k — BM25's ordering dominates once terms are weighted by
 * IDF, which is worth knowing because it means this constant is not load-bearing there. The small
 * corpus is where flattening bites, and it stops biting at 5.
 *
 * The measurement cannot separate 5 from 1; both are perfect on one corpus and identical on the
 * other. So the tie is broken on principle, not on evidence: at k = 1 the damping is nearly gone
 * and rank 1 of the first list swamps everything, which is fusion in name only.
 */
const RRF_K = 5;

/**
 * Corroborated facts outrank uncorroborated ones at equal relevance.
 *
 * The deterministic half of what SOP-06-01 calls gating CONFIDENCE rather than presence. Marking
 * the block `[unconfirmed]` puts the information in front of the model and leaves the decision to
 * it — measured against a live model, that works when there is something to compare against and
 * does NOT when the marked fact is the only candidate.
 *
 * It deliberately does NOT exclude. An uncorroborated fact alone in the store is still recalled,
 * because "a fact written once is available in the next session" is the promise the whole system
 * rests on.
 *
 * Unknown (absent count) sits between the two — the store cannot claim it was confirmed and cannot
 * claim it was not.
 */
function corroborationRank(fact: MemoryFact): number {
  if (fact.observations === undefined) return 1;
  return fact.observations > 1 ? 2 : 0;
}

/** Stable: relevance order is preserved within each corroboration tier. */
function sortByCorroboration(facts: readonly MemoryFact[]): MemoryFact[] {
  return [...facts].sort((a, b) => corroborationRank(b) - corroborationRank(a));
}

/** BM25 saturation and length-normalisation constants, at the values the literature settles on. */
const BM25_K1 = 1.2;
const BM25_B = 0.75;

/** One document's term counts and length — what BM25 needs and a term SET cannot provide. */
interface DocTerms {
  readonly counts: Map<string, number>;
  readonly length: number;
}

function docTerms(text: string): DocTerms {
  const counts = new Map<string, number>();
  let length = 0;
  for (const w of text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((x) => x.length >= 3 && !STOPWORDS.has(x))) {
    counts.set(w, (counts.get(w) ?? 0) + 1);
    length += 1;
  }
  return { counts, length };
}

/**
 * BM25 relevance over the whole store, computed once per call.
 *
 * WHY THIS REPLACED JACCARD, measured rather than argued. On LongMemEval-S (500 questions, 54
 * sessions each) Jaccard scored hit@5 = 80.0% against 89.0% for a naive tokenised substring
 * baseline in the same harness — worse than grep. The mechanism was isolated on a smaller corpus:
 * asked "what are the user's formatting preferences", the discriminating term `preferences`
 * appeared in 2 of 15 documents while `user` appeared in 14, and Jaccard weighted them the same.
 * Almost every document then scored above zero, the fusion flattened what little ordering
 * remained, and recency decided a relevance question.
 *
 * IDF is the entire fix: a term in 14 of 15 documents carries almost no information and BM25
 * says so, while Jaccard cannot say anything about a term it only knows is shared.
 *
 * The corpus statistics are computed from `facts` itself. An earlier comment here claimed BM25
 * "needs corpus statistics the caller does not have" — the caller passes the whole store as the
 * first argument, so the statistics were always in scope. That sentence deferred a fix for a
 * reason that did not exist.
 */
interface ScoredDoc {
  readonly fact: MemoryFact;
  readonly terms: DocTerms;
}

/** How many documents contain each query term — the only corpus statistic BM25 needs. */
function documentFrequencies(
  docs: readonly ScoredDoc[],
  queryTerms: Set<string>,
): Map<string, number> {
  const df = new Map<string, number>();
  for (const term of queryTerms) {
    let count = 0;
    for (const d of docs) if (d.terms.counts.has(term)) count += 1;
    df.set(term, count);
  }
  return df;
}

/** One document's BM25 score against the query, given the corpus statistics. */
function scoreDoc(
  doc: ScoredDoc,
  queryTerms: Set<string>,
  df: Map<string, number>,
  n: number,
  avgLength: number,
): number {
  let score = 0;
  for (const term of queryTerms) {
    const tf = doc.terms.counts.get(term);
    if (tf === undefined) continue;
    const frequency = df.get(term) ?? 0;
    // Probabilistic IDF with the +1 that keeps it non-negative when a term is in every document.
    const idf = Math.log(1 + (n - frequency + 0.5) / (frequency + 0.5));
    const norm = tf + BM25_K1 * (1 - BM25_B + (BM25_B * doc.terms.length) / avgLength);
    score += (idf * (tf * (BM25_K1 + 1))) / norm;
  }
  return score;
}

function bm25Scores(
  facts: readonly MemoryFact[],
  queryTerms: Set<string>,
): Map<MemoryFact, number> {
  const scores = new Map<MemoryFact, number>();
  if (queryTerms.size === 0 || facts.length === 0) return scores;

  // One tokenisation pass over the store. The previous version called its scoring function from
  // inside sort comparators, so every fact was re-tokenised O(n log n) times per query — measured
  // at 205ms median against grep's 12ms on the same corpus, and 60ms after this change.
  const docs: ScoredDoc[] = facts.map((f) => ({ fact: f, terms: docTerms(f.text) }));
  const n = docs.length;
  const avgLength = docs.reduce((sum, d) => sum + d.terms.length, 0) / n || 1;
  const df = documentFrequencies(docs, queryTerms);

  for (const d of docs) {
    const score = scoreDoc(d, queryTerms, df, n, avgLength);
    if (score > 0) scores.set(d.fact, score);
  }
  return scores;
}

/**
 * Facts that match the question come first; the rest fill whatever budget is left, by recency.
 *
 * The split is not a refinement of the fusion — it corrects a real failure. Fusing one flat list
 * at k = 60 over a 25-fact store compressed the rank differences until recency won outright, and
 * the answering fact was dropped. k = 60 is calibrated for lists of hundreds; a memory store is
 * not one.
 *
 * Within the matching group RRF still does the work it is good at — combining relevance, recency
 * and corroboration orderings without inventing weights for signals measured on different scales.
 */
function rankForQuery(facts: readonly MemoryFact[], scores: Map<MemoryFact, number>): MemoryFact[] {
  const matching = facts.filter((f) => (scores.get(f) ?? 0) > 0);
  const rest = facts.filter((f) => (scores.get(f) ?? 0) <= 0);

  const byRelevance = [...matching].sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0));
  const byRecency = [...matching].sort((a, b) =>
    (b.modified ?? "").localeCompare(a.modified ?? ""),
  );
  // Corroboration is a THIRD ranked list inside the fusion, not a sort applied before it. The
  // first version sorted by corroboration and then let RRF re-sort by relevance and recency, which
  // discarded the ordering entirely — the code read as if it ranked by corroboration and
  // measurably did not. RRF fuses orderings; anything that is not one of its inputs is not in the
  // result.
  const byCorroboration = sortByCorroboration(matching);
  const rank = new Map<MemoryFact, number>();
  const add = (list: readonly MemoryFact[]): void => {
    list.forEach((f, i) => {
      rank.set(f, (rank.get(f) ?? 0) + 1 / (RRF_K + i + 1));
    });
  };
  add(byRelevance);
  add(byRecency);
  add(byCorroboration);
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
  // Scored over the WHOLE store, not per bucket: IDF is a property of the corpus, and computing
  // it twice over two halves would give the same term two different weights.
  const scores = bm25Scores(facts, queryTerms);
  return {
    dated: rankForQuery(dated, scores),
    undated: [...undated].sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0)),
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
