import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * An HTTP server that answers every request with the same failure status, and counts what it
 * received.
 *
 * Deliberately `node:http` rather than a mock library knob (parsimony ladder rung 2): the
 * behaviour needed here is "refuse everything", which the standard library expresses in a few
 * lines with no API to guess at. Two attempts to express it through the mock's own options —
 * `on(pattern, {status})` and `setChaos({errorRate})` — both returned 200, because I had guessed
 * their shape. Twenty lines of stdlib cannot be guessed wrong: the assertion below proves what it
 * answers.
 */
export class AlwaysFailingServer {
  private constructor(
    private readonly server: Server,
    readonly url: string,
    readonly received: string[],
  ) {}

  static async start(status: number): Promise<AlwaysFailingServer> {
    const received: string[] = [];
    const server = createServer((req, res) => {
      received.push(req.url ?? "");
      res.writeHead(status, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: { message: `always failing with ${status}`, type: "server_error" },
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    return new AlwaysFailingServer(server, `http://127.0.0.1:${port}`, received);
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
