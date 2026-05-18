"use client";

import { useTheoChat } from "@usetheo/react";

export default function ChatPage() {
  const { messages, input, setInput, send, isStreaming, error } = useTheoChat({
    agentId: "demo-web-chat",
    endpoint: "/api/chat",
  });
  return (
    <main style={{ padding: 32, maxWidth: 720 }}>
      <h1>useTheoChat demo</h1>
      <p>Multi-turn chat with message history. State persists across renders.</p>
      <div
        style={{
          minHeight: 300,
          marginBottom: 16,
          padding: 16,
          border: "1px solid #ccc",
          borderRadius: 8,
        }}
      >
        {messages.length === 0 ? (
          <p style={{ color: "#888" }}>Say hi to start the conversation.</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} style={{ marginBottom: 8 }}>
              <b style={{ color: m.role === "user" ? "#06c" : "#080" }}>{m.role}:</b> {m.content}
            </div>
          ))
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        style={{ display: "flex", gap: 8 }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          disabled={isStreaming}
          style={{ flex: 1, padding: 8, fontSize: 14 }}
        />
        <button type="submit" disabled={isStreaming || input.length === 0}>
          {isStreaming ? "..." : "Send"}
        </button>
      </form>
      {error && (
        <p style={{ color: "red", marginTop: 12 }}>
          <b>Error:</b> {error.message}
        </p>
      )}
    </main>
  );
}
