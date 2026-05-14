import { describe, expect, it } from "vitest";

import { Theokit } from "../../src/index.js";
import meGolden from "../golden/theokit/me.json";
import modelsGolden from "../golden/theokit/models.json";
import repositoriesGolden from "../golden/theokit/repositories.json";
import { normalizeForGolden } from "../helpers/normalize.js";

describe("Theokit account and catalog contract", () => {
  it("returns the API key identity from Theokit.me", async () => {
    const me = await Theokit.me({ apiKey: "theo_test_contract_key" });

    expect(normalizeForGolden(me)).toEqual(meGolden);
  });

  it("returns model catalog entries with parameter and variant contracts", async () => {
    const models = await Theokit.models.list({ apiKey: "theo_test_contract_key" });

    expect(normalizeForGolden(models)).toEqual(modelsGolden);
  });

  it("returns connected repositories as stable GitHub URLs", async () => {
    const repositories = await Theokit.repositories.list({ apiKey: "theo_test_contract_key" });

    expect(normalizeForGolden(repositories)).toEqual(repositoriesGolden);
  });

  it("rejects missing or invalid apiKey with AuthenticationError", async () => {
    await expect(Theokit.me({ apiKey: "invalid" })).rejects.toMatchObject({
      name: "AuthenticationError",
      isRetryable: false,
      code: expect.any(String),
    });
  });
});
