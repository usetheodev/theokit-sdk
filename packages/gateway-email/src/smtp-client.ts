/**
 * SMTP client wrapper around `nodemailer`. Thin shim; tests inject a fake.
 *
 * @internal
 */

import { createTransport, type SendMailOptions, type Transporter } from "nodemailer";

/** Sentinel runtime export — workaround for rollup-plugin-dts deep type-only re-export bug. */
export const __smtpMarker: unique symbol = Symbol("smtp");

export interface SmtpClientConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly auth: { user: string; pass: string };
}

export interface SmtpSendOptions {
  readonly from: string | { name: string; address: string };
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  /** Message-ID (without `<>`) we're replying to. */
  readonly inReplyTo?: string;
  /** References chain (without `<>`). Will be serialized with braces. */
  readonly references?: readonly string[];
}

export interface ISmtpClient {
  verify(): Promise<true>;
  send(opts: SmtpSendOptions): Promise<string>;
  close(): Promise<void>;
}

export class SmtpClient implements ISmtpClient {
  private transporter: Transporter | undefined;

  constructor(private readonly config: SmtpClientConfig) {}

  private getTransporter(): Transporter {
    if (this.transporter === undefined) {
      this.transporter = createTransport({
        host: this.config.host,
        port: this.config.port,
        secure: this.config.secure,
        auth: this.config.auth,
      });
    }
    return this.transporter;
  }

  async verify(): Promise<true> {
    return this.getTransporter().verify();
  }

  async send(opts: SmtpSendOptions): Promise<string> {
    const mail: SendMailOptions = {
      from: opts.from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
    };
    if (opts.inReplyTo !== undefined) {
      mail.inReplyTo = `<${opts.inReplyTo}>`;
    }
    if (opts.references !== undefined && opts.references.length > 0) {
      mail.references = opts.references.map((r) => `<${r}>`);
    }
    const info = await this.getTransporter().sendMail(mail);
    // Strip `<>` from new Message-ID for consistency with inbound.
    const raw = (info.messageId ?? "").replace(/^<|>$/g, "");
    return raw;
  }

  async close(): Promise<void> {
    if (this.transporter !== undefined) {
      this.transporter.close();
      this.transporter = undefined;
    }
  }
}
