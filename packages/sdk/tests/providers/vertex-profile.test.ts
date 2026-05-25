/**
 * Vertex profile tests — base URL resolution + dialect inference (D291-D293).
 */

import { describe, expect, it } from "vitest";
import {
  inferModelDialect,
  resolveVertexBaseUrl,
  stripVertexPrefix,
  VERTEX,
} from "../../src/internal/providers/builtin/vertex.js";

describe("VERTEX profile shape", () => {
  it("apiMode anthropic_messages + authType gcp_oauth", () => {
    expect(VERTEX.apiMode).toBe("anthropic_messages");
    expect(VERTEX.authType).toBe("gcp_oauth");
  });

  it("reads GOOGLE_APPLICATION_CREDENTIALS env var", () => {
    expect(VERTEX.envVars).toEqual(["GOOGLE_APPLICATION_CREDENTIALS"]);
  });
});

describe("inferModelDialect", () => {
  it("vertex/anthropic/X → anthropic", () => {
    expect(inferModelDialect("vertex/anthropic/claude-sonnet-4-5")).toBe("anthropic");
  });

  it("vertex/google/X → gemini", () => {
    expect(inferModelDialect("vertex/google/gemini-2.0-flash-001")).toBe("gemini");
  });

  it("default is gemini for unknown formats", () => {
    expect(inferModelDialect("vertex/unknown/foo")).toBe("gemini");
  });

  it("EC-7: handles multiple slashes correctly", () => {
    expect(inferModelDialect("vertex/anthropic/claude/variant")).toBe("anthropic");
    expect(inferModelDialect("vertex/google/gemini/sub")).toBe("gemini");
  });
});

describe("resolveVertexBaseUrl", () => {
  it("regional Gemini uses /endpoints/openapi suffix", () => {
    const url = resolveVertexBaseUrl({
      projectId: "p1",
      location: "us-central1",
      modelDialect: "gemini",
    });
    expect(url).toBe(
      "https://us-central1-aiplatform.googleapis.com/v1/projects/p1/locations/us-central1/endpoints/openapi",
    );
  });

  it("regional Anthropic uses /publishers/anthropic suffix", () => {
    const url = resolveVertexBaseUrl({
      projectId: "p1",
      location: "europe-west4",
      modelDialect: "anthropic",
    });
    expect(url).toBe(
      "https://europe-west4-aiplatform.googleapis.com/v1/projects/p1/locations/europe-west4/publishers/anthropic",
    );
  });

  it("D293: global location strips region prefix from host", () => {
    const url = resolveVertexBaseUrl({
      projectId: "p1",
      location: "global",
      modelDialect: "anthropic",
    });
    expect(url).toBe(
      "https://aiplatform.googleapis.com/v1/projects/p1/locations/global/publishers/anthropic",
    );
  });

  it("D293: global + gemini also strips prefix", () => {
    const url = resolveVertexBaseUrl({
      projectId: "p1",
      location: "global",
      modelDialect: "gemini",
    });
    expect(url).toBe(
      "https://aiplatform.googleapis.com/v1/projects/p1/locations/global/endpoints/openapi",
    );
  });
});

describe("stripVertexPrefix", () => {
  it("strips vertex/anthropic/ prefix", () => {
    expect(stripVertexPrefix("vertex/anthropic/claude-sonnet-4-5@20250929")).toBe(
      "claude-sonnet-4-5@20250929",
    );
  });

  it("strips vertex/google/ prefix", () => {
    expect(stripVertexPrefix("vertex/google/gemini-2.0-flash-001")).toBe("gemini-2.0-flash-001");
  });

  it("returns unchanged when no prefix", () => {
    expect(stripVertexPrefix("claude-sonnet-4-5")).toBe("claude-sonnet-4-5");
  });
});
