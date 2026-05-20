"use client";

import { useTheoAssistant } from "@usetheo/react";
import { useState } from "react";
import type { FactCard } from "../../lib/schemas";

/**
 * useTheoAssistant demo — object-shaped streaming via the shared
 * FactCard schema from `lib/schemas.ts`.
 *
 * The schema is imported (NOT redefined) from the same module that the
 * route handler at `/api/assistant` uses. This guarantees client and
 * server agree on the shape — defining the schema twice in two places
 * causes silent partial-parse failures.
 */
export default function AssistantPage() {
  const [topic, setTopic] = useState("jazz music");
  const { object, isLoading, isValid, error, submit } = useTheoAssistant<FactCard>({
    endpoint: "/api/assistant",
  });

  return (
    <main style={{ padding: 32, maxWidth: 720 }}>
      <h1>useTheoAssistant demo</h1>
      <p>
        Object-shaped streaming via{" "}
        <code>Agent.streamObject&lt;FactCard&gt;</code>. The schema is shared
        between client (this page) and server (<code>/api/assistant</code>).
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(`Produce a fact card about: ${topic}.`);
        }}
        style={{ display: "flex", gap: 8, marginBottom: 16 }}
      >
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Topic for the fact card"
          disabled={isLoading}
          style={{ flex: 1, padding: 8, fontSize: 14 }}
        />
        <button type="submit" disabled={isLoading || topic.length === 0}>
          {isLoading ? "..." : "Generate"}
        </button>
      </form>
      <div
        style={{
          minHeight: 200,
          padding: 16,
          border: "1px solid #ccc",
          borderRadius: 8,
        }}
      >
        {object === undefined ? (
          <p style={{ color: "#888" }}>Object appears here as it streams.</p>
        ) : (
          <dl>
            <dt>
              <b>Title</b>
            </dt>
            <dd>{object.title ?? "..."}</dd>
            <dt>
              <b>Summary</b>
            </dt>
            <dd>{object.summary ?? "..."}</dd>
            <dt>
              <b>Year</b>
            </dt>
            <dd>{object.year === null ? "(n/a)" : (object.year ?? "...")}</dd>
            <dt>
              <b>Sources</b>
            </dt>
            <dd>{object.sources?.join(", ") ?? "..."}</dd>
          </dl>
        )}
        <p style={{ marginTop: 12, fontSize: 12, color: isValid ? "#080" : "#888" }}>
          {isValid ? "✓ Schema-validated (complete)" : isLoading ? "Streaming..." : "Idle"}
        </p>
      </div>
      {error && (
        <p style={{ color: "red", marginTop: 12 }}>
          <b>Error:</b> {error.message}
        </p>
      )}
    </main>
  );
}
