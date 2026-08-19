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
 * `sleep` resolving immediately is what keeps the poll-loop tests instant.
 *
 * Read the termination condition carefully before reusing this: with the DEFAULT frozen clock,
 * `deps.now() < deadline` is permanently true, so the `now`-based bound is exactly what a frozen clock
 * disables. What actually ends a loop here is the response queue running dry, which surfaces as the
 * stub's own error at the first `fetch` site — NOT as the expiry throw. A `pollDeviceToken` expiry test
 * written on the default clock therefore gets `oauth_token_exchange_failed`, not
 * `oauth_device_code_expired`. Pass a moving `clock` to test expiry (see the two expiry tests below).
 *
 * The thirteen error tests are unaffected: each throws on its first response, before the queue matters.
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
    // Review found this was the one test of the thirteen whose oracle was not discriminating. Delete the
    // guard entirely (`if (false)`) and control falls through to `exchangeCode`, which hits the exhausted
    // stub queue and raises `oauth_token_exchange_failed` — THE SAME CODE — from a different module.
    // The test passed against a mutant in which no throw in this file executed at all.
    //
    // The message is what separates them: only this site says "no authorization_code".
    const deps = depsFrom([usercodeOk(), json({ code_verifier: "ver" })]);
    const err = await expectAuthCode(
      openaiDeviceLogin(openaiConfig, deps, { onPrompt: () => {} }),
      "oauth_token_exchange_failed",
    );
    expect(err.message, "the code alone is shared with the harness's own failure path").toContain(
      "authorization_code",
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

  it("test_the_two_step_poll_expires_after_polling_rather_than_before", async () => {
    // The deadline is 15 minutes of INJECTED clock — a real clock would make this test take fifteen
    // minutes or nothing at all.
    //
    // Review caught the first version advancing the clock on read 1, which is the `while` test itself:
    // the loop body never ran, so it proved "the loop is not entered when the deadline has already
    // passed" while being named for expiry after polling. It still killed a `while (true)` mutant, but
    // by stub exhaustion rather than by the behaviour.
    //
    // Now the clock holds through one real pending poll (403) and only then jumps past the deadline, so
    // the test walks the path a user walks: they were polled for, they did not approve, it expired.
    // The clock is keyed to the poll HAVING HAPPENED rather than to a count of `now()` reads. Counting
    // reads is brittle — my first attempt was off by one, the loop went round again, and the test failed
    // against the stub running dry instead of against expiry.
    let polled = false;
    const clock = () => (polled ? FIXED_NOW + 16 * 60 * 1000 : FIXED_NOW);
    const deps = depsFrom([usercodeOk(), json({}, 403)]);
    const inner = deps.fetch;
    const withClock: DeviceDeps = {
      ...deps,
      now: clock,
      fetch: (async (...args: Parameters<typeof fetch>) => {
        const res = await inner(...args);
        if (res.status === 403) polled = true;
        return res;
      }) as unknown as typeof fetch,
    };
    const err = await expectAuthCode(
      openaiDeviceLogin(openaiConfig, withClock, { onPrompt: () => {} }),
      "oauth_device_code_expired",
    );
    expect(polled, "expiry must be reached THROUGH a poll, not before the first one").toBe(true);
    expect(
      err.message,
      "and not the stub running dry, which shares no message with expiry",
    ).toContain("expired");
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

describe("a non-JSON body — the proxy case the module's own contract did not survive", () => {
  /** What a captive portal or a corporate proxy actually returns: HTTP 200, and HTML in the body. */
  const html = (status = 200): Response =>
    new Response("<html><title>Network sign-in required</title></html>", {
      status,
      headers: { "content-type": "text/html" },
    });

  // B-051's DoD listed "malformed JSON" among the responses to table-drive, and it was the one item the
  // first pass did not deliver — the batch's own prose invoked "an endpoint returning HTML through a
  // corporate proxy" while no test fed a non-JSON body. Review caught the gap, and the gap was hiding a
  // real defect: three of the four entry points let `res.json()`'s raw `SyntaxError` escape, past a
  // caller prepared only for `AuthCallbackError`. These four tests are the RED that fix answered.

  it("test_html_from_the_device_endpoint_is_typed_rather_than_a_raw_syntax_error", async () => {
    const err = await expectAuthCode(
      requestDeviceCode(deviceConfig, depsFrom([html()])),
      "oauth_device_authorization_failed",
    );
    expect(
      err.message,
      "the body is quoted so the user can see it is a proxy, not the provider",
    ).toContain("Network sign-in required");
  });

  it("test_html_from_the_usercode_endpoint_is_typed_rather_than_a_raw_syntax_error", async () => {
    const err = await expectAuthCode(
      requestOpenAIUsercode(openaiConfig, depsFrom([html()])),
      "oauth_device_authorization_failed",
    );
    expect(err.message).toContain("non-JSON");
  });

  it("test_html_from_the_two_step_poll_is_typed_rather_than_a_raw_syntax_error", async () => {
    const deps = depsFrom([
      json({ device_auth_id: "dai", user_code: "UC", interval: "1" }),
      html(),
    ]);
    const err = await expectAuthCode(
      openaiDeviceLogin(openaiConfig, deps, { onPrompt: () => {} }),
      "oauth_token_exchange_failed",
    );
    expect(err.message).toContain("non-JSON");
  });

  it("test_a_body_that_cannot_be_read_at_all_still_produces_a_typed_error", async () => {
    // The `.catch(() => "")` inside the parse helper: a socket that dies mid-body makes `res.text()`
    // itself reject. Without the catch that rejection escapes untyped — the same defect this batch
    // fixes, reintroduced one layer down by the fix for it. Cheap to cover, and it was the last
    // function in the file at FNDA:0.
    const broken = {
      status: 200,
      ok: true,
      text: () => Promise.reject(new Error("socket closed")),
    } as unknown as Response;
    const deps: DeviceDeps = {
      now: () => FIXED_NOW,
      sleep: async () => {},
      fetch: (async () => broken) as unknown as typeof fetch,
    };
    const err = await expectAuthCode(
      requestDeviceCode(deviceConfig, deps),
      "oauth_device_authorization_failed",
    );
    expect(err.message).toContain("non-JSON");
  });

  it("test_the_poll_loop_already_tolerated_a_non_json_body_and_still_does", async () => {
    // The one entry point that was already safe, via `.catch(() => ({}))` on the poll parse. It is here
    // so the fix cannot silently regress the path that did NOT need fixing — and because that catch
    // handler was the last function in the file at FNDA:0 after the first pass.
    const err = await expectAuthCode(
      pollDeviceToken(deviceConfig, grant, depsFrom([html(500)])),
      "oauth_token_exchange_failed",
    );
    expect(err.message, "a non-2xx with an unreadable body is reported by its status").toContain(
      "500",
    );
  });
});

describe("pollDeviceToken expiry — the throw the item deliberately does not claim", () => {
  it("test_the_device_code_expires_once_the_deadline_passes", async () => {
    // Line 176 is the one throw in the file that lcov already showed as covered, which is why B-051
    // excludes it — and reviewing this batch found nothing ASSERTS it: mutating its code argument left
    // the whole 4451-test suite green. That is the same distinction this batch argues for everywhere
    // else (executed is not asserted), so leaving it would be arguing the point and then not applying it.
    const deps = depsFrom([], () => FIXED_NOW);
    const expired = { ...grant, expiresIn: 0 };
    const err = await expectAuthCode(
      pollDeviceToken(deviceConfig, expired, deps),
      "oauth_device_code_expired",
    );
    expect(err.message).toContain("expired");
  });
});
