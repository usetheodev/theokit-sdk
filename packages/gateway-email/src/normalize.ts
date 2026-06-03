/**
 * Inbound `raw RFC 5322 bytes` → `EmailMessageEvent`.
 *
 * EC-2 absorbed: body capped at `maxBodyChars` (default 50000).
 * EC-5 absorbed: subject fallback to `"(no subject)"`.
 *
 * @internal
 */

import type { EmailMessageEvent } from "@theokit/gateway";
import { simpleParser } from "mailparser";

/**
 * Sentinel runtime export — workaround for rollup-plugin-dts deep type-only
 * re-export bug. The marker is INTENTIONALLY orphan: it forces rollup-plugin-dts
 * to keep the module in the bundle so re-exports from `index.ts` resolve.
 *
 * @knipignore
 */
export const __normalizeMarker: unique symbol = Symbol("email-normalize");

export interface NormalizeOptions {
  readonly botAddress: string;
  /** EC-2: cap body length. Default 50000. */
  readonly maxBodyChars?: number;
}

const DEFAULT_MAX_BODY = 50_000;

function stripBraces(id: string | undefined): string | undefined {
  if (id === undefined || id.length === 0) return undefined;
  return id.replace(/^<|>$/g, "");
}

function normalizeRefs(refs: string | string[] | undefined): readonly string[] | undefined {
  if (refs === undefined) return undefined;
  const arr = Array.isArray(refs) ? refs : refs.split(/\s+/).filter((s) => s.length > 0);
  const cleaned = arr.map((r) => stripBraces(r)).filter((r): r is string => r !== undefined);
  return cleaned.length > 0 ? cleaned : undefined;
}

interface AddressEntry {
  readonly address?: string;
  readonly name?: string;
}

interface AddressObject {
  readonly value?: ReadonlyArray<AddressEntry>;
}

function addressesFrom(
  obj: AddressObject | ReadonlyArray<AddressObject> | undefined,
): AddressEntry[] {
  if (obj === undefined) return [];
  if (Array.isArray(obj)) {
    const out: AddressEntry[] = [];
    for (const o of obj) out.push(...(o.value ?? []));
    return out;
  }
  return Array.from((obj as AddressObject).value ?? []);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: shape-mapping function — each branch is a small conditional spread for an optional RFC 5322 field; splitting hurts the "one event normalization here" locality.
export async function normalizeEmail(
  rawBuffer: Buffer | string,
  opts: NormalizeOptions,
): Promise<EmailMessageEvent> {
  const parsed = await simpleParser(rawBuffer);

  const messageId = stripBraces(parsed.messageId) ?? "unknown";
  const inReplyTo = stripBraces(parsed.inReplyTo);
  const references = normalizeRefs(parsed.references as string | string[] | undefined);

  const fromEntries = addressesFrom(parsed.from as AddressObject | undefined);
  const fromAddress = (fromEntries[0]?.address ?? "anonymous").toLowerCase().trim();
  const fromName = fromEntries[0]?.name;

  const botAddrLc = opts.botAddress.toLowerCase().trim();
  const recipients: string[] = [];
  for (const entry of [
    ...addressesFrom(parsed.to as AddressObject | ReadonlyArray<AddressObject> | undefined),
    ...addressesFrom(parsed.cc as AddressObject | ReadonlyArray<AddressObject> | undefined),
  ]) {
    const addr = entry.address?.toLowerCase().trim();
    if (addr !== undefined && addr.length > 0 && addr !== botAddrLc) {
      recipients.push(addr);
    }
  }

  // EC-5: subject fallback.
  const subject = parsed.subject ?? "(no subject)";

  // EC-2: cap body.
  const rawText = parsed.text ?? "";
  const maxChars = opts.maxBodyChars ?? DEFAULT_MAX_BODY;
  const text =
    rawText.length > maxChars
      ? `${rawText.slice(0, maxChars)}\n\n[truncated — full body in event.email.raw]`
      : rawText;

  const receivedAt = parsed.date instanceof Date ? parsed.date.getTime() : Date.now();
  const attachmentCount = Array.isArray(parsed.attachments) ? parsed.attachments.length : 0;

  const emailMeta: EmailMessageEvent["email"] = {
    messageId,
    ...(inReplyTo !== undefined ? { inReplyTo } : {}),
    ...(references !== undefined ? { references } : {}),
    subject,
    fromAddress,
    ...(fromName !== undefined ? { fromName } : {}),
    recipients,
    attachmentCount,
    raw: parsed,
  };

  return {
    id: messageId,
    platform: "email",
    sender: {
      id: fromAddress,
      ...(fromName !== undefined ? { displayName: fromName } : {}),
    },
    channel: { id: fromAddress, type: "dm", topicId: messageId },
    text,
    receivedAt,
    email: emailMeta,
  };
}
