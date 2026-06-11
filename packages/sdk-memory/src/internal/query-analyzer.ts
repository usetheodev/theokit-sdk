/**
 * Query analyzer — LLM-driven sub-query distillation for complex queries.
 *
 * Inspired by CrewAI's `recall_flow.py`. Opt-in: short queries (≤250 chars)
 * pass through unchanged. Per ADR D3.
 *
 * @internal
 */

const MAX_SHORT_QUERY_LENGTH = 250;

interface QueryAnalysisResult {
  subQueries: string[];
  timeFilter?: number;
  scopeHint?: string;
}

export async function analyzeQuery(
  query: string,
  callLlm: (system: string, user: string) => Promise<string>,
): Promise<QueryAnalysisResult> {
  if (query.length <= MAX_SHORT_QUERY_LENGTH) {
    return { subQueries: [query] };
  }

  try {
    const result = await callLlm(
      'Extract 1-3 targeted search sub-queries from the user\'s question. Output ONLY valid JSON: {"subQueries": ["..."], "timeFilter": null, "scopeHint": null}. No explanation.',
      query,
    );
    const parsed = JSON.parse(result) as QueryAnalysisResult;
    if (!Array.isArray(parsed.subQueries) || parsed.subQueries.length === 0) {
      return { subQueries: [query] };
    }
    return parsed;
  } catch {
    // EC-4: LLM error or malformed JSON → fall back to original query
    return { subQueries: [query] };
  }
}
