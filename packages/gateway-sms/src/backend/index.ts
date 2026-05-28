/**
 * Backend factory — picks the right impl from `opts.backend`.
 *
 * @internal
 */

import type { SMSBackend } from "../backend-types.js";
import type { SMSAdapterOptions } from "../types.js";
import { PlivoBackend } from "./plivo.js";
import { TwilioBackend } from "./twilio.js";
import { VonageBackend } from "./vonage.js";

export function createBackend(opts: SMSAdapterOptions): SMSBackend {
  switch (opts.backend) {
    case "twilio":
      return new TwilioBackend(opts);
    case "plivo":
      return new PlivoBackend(opts);
    case "vonage":
      return new VonageBackend(opts);
    default: {
      const _exhaustive: never = opts;
      throw new Error(`unknown backend: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
