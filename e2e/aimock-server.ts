import { LLMock } from "@copilotkit/aimock";

/** One request as the mock server received it — the wire, not the reply. */
export interface RecordedRequest {
  readonly path?: string;
  readonly body?: { messages?: Array<{ content?: string }> };
}

/**
 * Owns the lifetime of one mock provider server: start it on an ephemeral port, expose
 * where it is and what it received, stop it.
 *
 * Deliberately a single concrete class rather than an interface with one implementer
 * (plan ADR D1). B-143..B-147 will each add a surface; if a second implementation
 * actually arrives, the abstraction is extracted then, shaped by two real cases.
 *
 * The port is always ephemeral (ADR D2): CI runs packages concurrently, and a fixed port
 * turns a collision into a flake that reads as a product defect.
 */
export class AimockServer {
  private constructor(
    private readonly mock: LLMock,
    readonly url: string,
  ) {}

  /**
   * @param reply - text the mock answers with. Given explicitly so the assertion can compare
   *   against a value this test chose, rather than against whatever a default produced.
   */
  static async start(reply: string): Promise<AimockServer> {
    const mock = new LLMock({ port: 0 });
    mock.onMessage(/.*/, { content: reply });
    await mock.start();
    const url = mock.url;
    if (url === undefined || url.length === 0) {
      throw new Error(
        "aimock started but reported no URL — refusing to run against an unknown host",
      );
    }
    return new AimockServer(mock, url);
  }

  /** Every request the server received, in arrival order. */
  get requests(): RecordedRequest[] {
    return this.mock.getRequests() as RecordedRequest[];
  }

  async stop(): Promise<void> {
    await this.mock.stop();
  }
}
