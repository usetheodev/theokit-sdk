import Link from "next/link";

export default function Home() {
  return (
    <main style={{ padding: 32, maxWidth: 720 }}>
      <h1>@usetheo/react demo</h1>
      <p>
        This Next.js app demonstrates all three React hooks shipped by{" "}
        <code>@usetheo/react</code>, each on its own route.
      </p>
      <h2>Routes</h2>
      <table style={{ borderCollapse: "collapse", marginTop: 12 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #ccc" }}>
            <th style={{ padding: 8, textAlign: "left" }}>Route</th>
            <th style={{ padding: 8, textAlign: "left" }}>Hook</th>
            <th style={{ padding: 8, textAlign: "left" }}>Use case</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ borderBottom: "1px solid #eee" }}>
            <td style={{ padding: 8 }}>
              <Link href="/chat">/chat</Link>
            </td>
            <td style={{ padding: 8 }}>
              <code>useTheoChat</code>
            </td>
            <td style={{ padding: 8 }}>Multi-turn conversation with message history</td>
          </tr>
          <tr style={{ borderBottom: "1px solid #eee" }}>
            <td style={{ padding: 8 }}>
              <Link href="/completion">/completion</Link>
            </td>
            <td style={{ padding: 8 }}>
              <code>useTheoCompletion</code>
            </td>
            <td style={{ padding: 8 }}>Single-shot text generation (autocomplete, summarize, etc)</td>
          </tr>
          <tr style={{ borderBottom: "1px solid #eee" }}>
            <td style={{ padding: 8 }}>
              <Link href="/assistant">/assistant</Link>
            </td>
            <td style={{ padding: 8 }}>
              <code>useTheoAssistant</code>
            </td>
            <td style={{ padding: 8 }}>Object-shaped streaming (form-filler, structured output)</td>
          </tr>
        </tbody>
      </table>
      <h2>When to use which</h2>
      <ul>
        <li>
          <strong>useTheoChat</strong> — when you want to render a chat UI with history persistence.
        </li>
        <li>
          <strong>useTheoCompletion</strong> — when you want a single response for a single input (no history). Replaces, not appends.
        </li>
        <li>
          <strong>useTheoAssistant&lt;T&gt;</strong> — when you want a typed object back, with partials streamed for incremental rendering (e.g., autofill a form as the model produces).
        </li>
      </ul>
    </main>
  );
}
