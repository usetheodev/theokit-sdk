import { describe, expect, it } from "vitest";

import { wsUrlFromBase } from "../src/client.js";

describe("wsUrlFromBase", () => {
  it("https → wss with /api/v4/websocket suffix", () => {
    expect(wsUrlFromBase("https://mattermost.acme.com")).toBe(
      "wss://mattermost.acme.com/api/v4/websocket",
    );
  });

  it("http → ws", () => {
    expect(wsUrlFromBase("http://localhost:8065")).toBe("ws://localhost:8065/api/v4/websocket");
  });

  it("strips trailing slash before appending", () => {
    expect(wsUrlFromBase("https://mattermost.acme.com/")).toBe(
      "wss://mattermost.acme.com/api/v4/websocket",
    );
  });
});
