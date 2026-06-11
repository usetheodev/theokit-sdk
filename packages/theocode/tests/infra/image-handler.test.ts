import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectImageType, imageToBase64 } from "../../src/infra/image-handler.js";

describe("detectImageType", () => {
  it("detects png", () => {
    expect(detectImageType("photo.png")).toBe("image/png");
  });

  it("detects jpg", () => {
    expect(detectImageType("photo.jpg")).toBe("image/jpeg");
  });

  it("detects jpeg", () => {
    expect(detectImageType("photo.jpeg")).toBe("image/jpeg");
  });

  it("detects webp", () => {
    expect(detectImageType("photo.webp")).toBe("image/webp");
  });

  it("returns null for non-image", () => {
    expect(detectImageType("file.txt")).toBeNull();
    expect(detectImageType("file.ts")).toBeNull();
  });

  it("is case-insensitive on extension", () => {
    expect(detectImageType("PHOTO.PNG")).toBe("image/png");
  });
});

describe("imageToBase64", () => {
  const dir = join(tmpdir(), "img-test-" + Date.now());
  mkdirSync(dir, { recursive: true });

  it("encodes a valid image file", () => {
    const p = join(dir, "test.png");
    writeFileSync(p, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG magic bytes
    const result = imageToBase64(p);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mimeType).toBe("image/png");
      expect(result.base64.length).toBeGreaterThan(0);
    }
  });

  it("EC-3: rejects non-image extension", () => {
    const p = join(dir, "data.txt");
    writeFileSync(p, "hello");
    const result = imageToBase64(p);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Unsupported image extension");
  });

  it("EC-3: rejects 0-byte file", () => {
    const p = join(dir, "empty.png");
    writeFileSync(p, "");
    const result = imageToBase64(p);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("0 bytes");
  });

  it("EC-3: rejects non-existent file", () => {
    const result = imageToBase64(join(dir, "nope.png"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not found");
  });

  // Cleanup
  it("cleanup", () => {
    rmSync(dir, { recursive: true, force: true });
  });
});
