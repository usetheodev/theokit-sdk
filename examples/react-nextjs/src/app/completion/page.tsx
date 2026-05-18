"use client";

import { useTheoCompletion } from "@usetheo/react";

export default function CompletionPage() {
  const { completion, input, setInput, complete, isLoading, error } = useTheoCompletion({
    endpoint: "/api/completion",
  });
  return (
    <main style={{ padding: 32, maxWidth: 720 }}>
      <h1>useTheoCompletion demo</h1>
      <p>
        Single-shot text generation. The completion replaces on each new call (no history).
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void complete();
        }}
        style={{ display: "flex", gap: 8, marginBottom: 16 }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Try: Summarize the history of jazz in one sentence."
          disabled={isLoading}
          style={{ flex: 1, padding: 8, fontSize: 14 }}
        />
        <button type="submit" disabled={isLoading || input.length === 0}>
          {isLoading ? "..." : "Complete"}
        </button>
      </form>
      <div
        style={{
          minHeight: 100,
          padding: 16,
          border: "1px solid #ccc",
          borderRadius: 8,
          whiteSpace: "pre-wrap",
        }}
      >
        {completion.length > 0 ? completion : <span style={{ color: "#888" }}>Output appears here.</span>}
      </div>
      {error && (
        <p style={{ color: "red", marginTop: 12 }}>
          <b>Error:</b> {error.message}
        </p>
      )}
    </main>
  );
}
