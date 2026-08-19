/**
 * B-051 — the thirteen `AuthCallbackError` sites in `oauth-device.ts` that lcov reported at count 0.
 *
 * This is an interactive login, so the coverage asymmetry is inverted from most modules: the success
 * path is what a developer walks once while wiring the flow up (and is what the two existing tests
 * cover), while the failure paths are what a USER meets — a code that expired while they looked for
 * their phone, a provider answering `access_denied`, an endpoint returning HTML through a corporate
 * proxy. Each must surface as a typed error carrying a code the CLI can branch on.
 *
 * Every test asserts the CODE, never merely that something threw: all fourteen throws in the file
 * construct the same `AuthCallbackError` class, so `rejects.toThrow(AuthCallbackError)` would pass
 * even if every site emitted the wrong code. The code is the field a caller switches on, so it is the
 * field a test pins (plan ADR D1 — the same hole batch 8 found in the HTTP mapper, where
 * `CredentialError extends AuthenticationError` survived every mutant that asserted only the class).
 */

import { describe, expect, it } from "vitest";

import { AuthCallbackError } from "../../../src/internal/../server/auth/errors.js";
import type {
  DeviceCodeGrant,
  DeviceDeps,
  DeviceOAuthConfig,
  OpenAIDeviceConfig,
} from "../../../src/internal/auth/auth-types.js";
import {
  deviceLogin,
  openaiDeviceLogin,
  pollDeviceToken,
  requestDeviceCode,
  requestOpenAIUsercode,
} from "../../../src/internal/auth/oauth-device.js";

const FIXED_NOW = 1_000_000_000_000;

const deviceConfig: DeviceOAuthConfig = {
  provider: "openai",
  authorizeEndpoint: "https://auth.test/authorize",
  tokenEndpoint: "https://auth.test/token",
  clientId: "cid-1",
  scopes: ["openid"],
  redirectUri: "https://app.test/cb",
  deviceCodeEndpoint: "https://auth.test/device",
};

const openaiConfig: OpenAIDeviceConfig = {
  ...deviceConfig,
  deviceUsercodeEndpoint: "https://auth.test/usercode",
  devicePollEndpoint: "https://auth.test/devicepoll",
  verificationUri: "https://auth.test/activate",
};

const grant: DeviceCodeGrant = {
  deviceCode: "dc",
  userCode: "UC-1234",
  verificationUri: "https://auth.test/activate",
  interval: 1,
  expiresIn: 900,
};

/**
 * A `DeviceDeps` whose clock is frozen and whose sleep is free, driven by a queue of canned responses.
 *
 * `sleep` resolving immediately is what keeps the poll-loop tests instant; the loop's bound comes from
 * `now`, not from elapsed wall time, which is why a frozen clock does not make them spin forever — each
 * poll consumes one queued response and the assertions land before the queue runs dry.
 */
function depsFrom(
  responses: Array<Response | Error>,
  clock: () => number = () => FIXED_NOW,
): DeviceDeps {
  let i = 0;
  return {
    now: clock,
    sleep: async () => {},
    fetch: (async () => {
      const next = responses[i++];
      if (next instanceof Error) throw next;
      if (next === undefined) throw new Error("test stub: ran out of canned responses");
      return next;
    }) as unknown as typeof fetch,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Asserts the rejection is an `AuthCallbackError` carrying `code` — the field a caller branches on. */
async function expectAuthCode(promise: Promise<unknown>, code: string): Promise<AuthCallbackError> {
  const err = await promise.then(
    () => {
      throw new Error(`expected a rejection with code ${code}, but the call resolved`);
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AuthCallbackError);
  expect((err as AuthCallbackError).code, "the code a caller switches on").toBe(code);
  return err as AuthCallbackError;
}

describe("requestDeviceCode — the three failures of the flow's entry point", () => {
  it("test_a_transport_failure_is_reported_as_device_authorization_failed", async () => {
    const deps = depsFrom([new Error("ECONNREFUSED")]);
    const err = await expectAuthCode(
      requestDeviceCode(deviceConfig, deps),
      "oauth_device_authorization_failed",
    );
    expect(err.message, "the transport reason must survive into the message").toContain(
      "ECONNREFUSED",
    );
  });

  it("test_a_non_2xx_device_endpoint_is_reported_as_device_authorization_failed", async () => {
    const deps = depsFrom([json({ error: "server_error" }, 500)]);
    const err = await expectAuthCode(
      requestDeviceCode(deviceConfig, deps),
      "oauth_device_authorization_failed",
    );
    expect(err.message, "the status is what tells an operator which half failed").toContain("500");
  });

  it("test_a_body_without_device_code_is_rejected_rather_than_returned", async () => {
    // The failure a naive implementation forgets: HTTP 200, but nothing usable in it. Returning here
    // would push `undefined` into the poll loop, where it surfaces far from its cause.
    const deps = depsFrom([json({ verification_uri: "https://auth.test/activate" })]);
    await expectAuthCode(
      requestDeviceCode(deviceConfig, deps),
      "oauth_device_authorization_failed",
    );
  });
});

describe("pollDeviceToken — three error branches inside a function that already runs", () => {
  it("test_a_transport_failure_mid_poll_is_reported_as_token_exchange_failed", async () => {
    const deps = depsFrom([new Error("socket hang up")]);
    const err = await expectAuthCode(
      pollDeviceToken(deviceConfig, grant, deps),
      "oauth_token_exchange_failed",
    );
    expect(err.message).toContain("socket hang up");
  });

  it("test_a_non_2xx_without_an_oauth_error_body_fails_the_poll", async () => {
    // The subtle branch. RFC 8628 §3.5 delivers `authorization_pending` AS a 400, so a non-2xx is only
    // fatal when the body is NOT OAuth-shaped. This test and the next sit on opposite sides of that
    // condition, and a mistake in it would either abort a legal wait or wait forever on a real error.
    const deps = depsFrom([json({}, 500)]);
    const err = await expectAuthCode(
      pollDeviceToken(deviceConfig, grant, deps),
      "oauth_token_exchange_failed",
    );
    expect(err.message).toContain("500");
  });

  it("test_a_rejection_from_the_provider_is_surfaced_with_its_reason", async () => {
    const deps = depsFrom([json({ error: "access_denied" }, 400)]);
    const err = await expectAuthCode(
      pollDeviceToken(deviceConfig, grant, deps),
      "oauth_token_exchange_failed",
    );
    expect(err.message, "the user pressed Deny; the reason is the whole diagnosis").toContain(
      "access_denied",
    );
  });
});

describe("requestOpenAIUsercode — the same three shapes on the two-step flow", () => {
  it("test_a_transport_failure_on_usercode_is_reported_as_device_authorization_failed", async () => {
    const deps = depsFrom([new Error("EAI_AGAIN")]);
    const err = await expectAuthCode(
      requestOpenAIUsercode(openaiConfig, deps),
      "oauth_device_authorization_failed",
    );
    expect(err.message).toContain("EAI_AGAIN");
  });

  it("test_a_non_2xx_usercode_endpoint_is_reported_as_device_authorization_failed", async () => {
    const deps = depsFrom([json({}, 503)]);
    const err = await expectAuthCode(
      requestOpenAIUsercode(openaiConfig, deps),
      "oauth_device_authorization_failed",
    );
    expect(err.message).toContain("503");
  });

  it("test_a_usercode_body_missing_its_ids_is_rejected", async () => {
    const deps = depsFrom([json({ interval: "5" })]);
    await expectAuthCode(
      requestOpenAIUsercode(openaiConfig, deps),
      "oauth_device_authorization_failed",
    );
  });
});

describe("openaiDeviceLogin — four failures, including the one that distinguishes pending from fatal", () => {
  /** The usercode step must succeed before the poll failures under test are reachable. */
  const usercodeOk = () => json({ device_auth_id: "dai", user_code: "UC", interval: "1" });

  it("test_a_transport_failure_on_the_two_step_poll_is_reported_as_token_exchange_failed", async () => {
    const deps = depsFrom([usercodeOk(), new Error("ETIMEDOUT")]);
    const err = await expectAuthCode(
      openaiDeviceLogin(openaiConfig, deps, { onPrompt: () => {} }),
      "oauth_token_exchange_failed",
    );
    expect(err.message).toContain("ETIMEDOUT");
  });

  it("test_a_poll_body_without_an_authorization_code_is_rejected", async () => {
    const deps = depsFrom([usercodeOk(), json({ code_verifier: "ver" })]);
    await expectAuthCode(
      openaiDeviceLogin(openaiConfig, deps, { onPrompt: () => {} }),
      "oauth_token_exchange_failed",
    );
  });

  it("test_a_status_other_than_403_or_404_ends_the_poll", async () => {
    // 403/404 mean "the user has not clicked yet"; every other status is fatal. Getting this backwards
    // turns a normal wait into a hard login failure, or hides a real one behind an endless poll.
    const deps = depsFrom([usercodeOk(), json({}, 500)]);
    const err = await expectAuthCode(
      openaiDeviceLogin(openaiConfig, deps, { onPrompt: () => {} }),
      "oauth_token_exchange_failed",
    );
    expect(err.message).toContain("500");
  });

  it("test_the_two_step_poll_expires_once_the_deadline_passes", async () => {
    // The deadline is 15 minutes of INJECTED clock. Advancing `now` past it on the second read is what
    // ends the loop — a real clock would make this test take fifteen minutes or nothing at all.
    let reads = 0;
    const clock = () => (reads++ === 0 ? FIXED_NOW : FIXED_NOW + 16 * 60 * 1000);
    const deps = depsFrom([usercodeOk()], clock);
    await expectAuthCode(
      openaiDeviceLogin(openaiConfig, deps, { onPrompt: () => {} }),
      "oauth_device_code_expired",
    );
  });
});

describe("deviceLogin — the orchestrator a caller actually invokes", () => {
  it("test_the_user_is_prompted_before_the_first_poll", async () => {
    // No throw of its own, so it is outside the item's thirteen — but it was at FNDA:0, and its contract
    // is an ordering one that no single-function test above can see: a login that polls before showing
    // the user their code is broken even though every unit under it passes.
    const order: string[] = [];
    const deps: DeviceDeps = {
      now: () => FIXED_NOW,
      sleep: async () => {},
      fetch: (async (url: string) => {
        order.push(url === deviceConfig.tokenEndpoint ? "poll" : "device-code");
        return url === deviceConfig.tokenEndpoint
          ? json({ access_token: "acc", expires_in: 3600 })
          : json({
              device_code: "dc",
              user_code: "UC-1234",
              verification_uri: "https://auth.test/activate",
              interval: 1,
              expires_in: 900,
            });
      }) as unknown as typeof fetch,
    };

    const prompted: Array<{ userCode: string }> = [];
    const tokens = await deviceLogin(deviceConfig, deps, {
      onPrompt: (p) => {
        order.push("prompt");
        prompted.push(p);
      },
    });

    expect(tokens.access).toBe("acc");
    expect(prompted[0]?.userCode, "the user must be handed the code from the grant").toBe(
      "UC-1234",
    );
    expect(order, "prompting after polling would leave the user staring at nothing").toEqual([
      "device-code",
      "prompt",
      "poll",
    ]);
  });
});
