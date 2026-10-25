import http from "node:http";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { AddressInfo } from "node:net";

const secret = () => randomBytes(32).toString("base64url");
const verifier = (value: string) => createHash("sha256").update(value).digest();
const matches = (value: unknown, expected?: Buffer) =>
  typeof value === "string" &&
  value.length === 43 &&
  !!expected &&
  timingSafeEqual(verifier(value), expected);
const exact = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).sort().join() === keys.sort().join();
export type Assets = Record<string, { type: string; body: string }>;
export type BrowserHooks = {
  snapshot: () => unknown;
  event: (
    event: unknown,
    generation: number,
  ) => Promise<void | { unchanged: true }>;
  connected: (generation: number) => void;
  disconnected: (generation: number) => void;
  expired: () => void;
};
type Peer = {
  ws: WebSocket;
  generation: number;
  phase: "hello" | "ack" | "sync" | "ready" | "replaced";
  seq: number;
  queued: number;
  chain: Promise<void>;
  timer: ReturnType<typeof setTimeout>;
};
/** Credentials exist only in process memory and the authenticated tab's sessionStorage. */
export class BrowserServer {
  readonly http: http.Server;
  readonly ws = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024,
    perMessageDeflate: false,
  });
  origin = "";
  launchURL = "";
  private bootstrap = secret();
  private bootstrapHash: Buffer | undefined = verifier(this.bootstrap);
  private reconnectHash?: Buffer;
  private active?: Peer;
  private peers = new Set<Peer>();
  private generation = 0;
  private deadline: number;
  private deadlineTimer?: ReturnType<typeof setTimeout>;
  private closing = false;
  constructor(
    readonly assets: Assets,
    readonly hooks: BrowserHooks,
    readonly windowMs = 60000,
  ) {
    this.deadline = Date.now() + windowMs;
    this.http = http.createServer((req, res) => {
      const common = {
        "Content-Security-Policy":
          "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-store",
        "Cross-Origin-Resource-Policy": "same-origin",
      };
      if (
        req.headers.host !== new URL(this.origin).host ||
        (req.headers.origin && req.headers.origin !== this.origin) ||
        req.method !== "GET"
      ) {
        res.writeHead(403, common).end();
        return;
      }
      const asset = this.assets[req.url ?? ""];
      if (!asset) {
        res.writeHead(404, common).end();
        return;
      }
      res
        .writeHead(200, { ...common, "Content-Type": asset.type })
        .end(asset.body);
    });
    this.http.headersTimeout = 5000;
    this.http.requestTimeout = 5000;
    this.http.keepAliveTimeout = 1000;
    this.http.on("upgrade", (req, socket, head) => {
      if (
        this.closing ||
        req.url !== "/channel" ||
        req.headers.host !== new URL(this.origin).host ||
        req.headers.origin !== this.origin ||
        this.peers.size >= 5 ||
        req.headers["sec-websocket-protocol"]
      ) {
        socket.destroy();
        return;
      }
      this.ws.handleUpgrade(req, socket, head, (ws) => this.accept(ws));
    });
  }
  async listen(): Promise<string> {
    await new Promise<void>((resolve, reject) => {
      this.http.once("error", reject);
      this.http.listen(0, "127.0.0.1", resolve);
    });
    this.origin = `http://127.0.0.1:${(this.http.address() as AddressInfo).port}`;
    this.launchURL = this.origin + "/#" + this.bootstrap;
    this.bootstrap = "";
    this.armDeadline();
    return this.launchURL;
  }
  private armDeadline() {
    clearTimeout(this.deadlineTimer);
    if (!Number.isFinite(this.deadline) || this.closing) return;
    this.deadlineTimer = setTimeout(
      () => {
        if (Date.now() < this.deadline) {
          this.armDeadline();
          return;
        }
        this.bootstrapHash = undefined;
        this.reconnectHash = undefined;
        this.hooks.expired();
      },
      Math.max(1, this.deadline - Date.now()),
    );
  }
  private send(peer: Peer, message: unknown) {
    if (peer.ws.readyState !== WebSocket.OPEN) return;
    const bytes = JSON.stringify(message);
    if (Buffer.byteLength(bytes) + peer.ws.bufferedAmount > 1024 * 1024) {
      peer.ws.close(1009, "OUTPUT_BOUND_RESYNC");
      return;
    }
    peer.ws.send(bytes);
  }
  private revoke(peer: Peer, reason: string) {
    if (peer === this.active) {
      this.hooks.disconnected(peer.generation);
      this.active = undefined;
      this.deadline = Date.now() + this.windowMs;
      this.armDeadline();
    }
    peer.phase = "replaced";
    this.send(peer, { type: "replaced", reason, preserve_unsaved: true });
    peer.ws.close(1000, reason);
  }
  private accept(ws: WebSocket) {
    const peer: Peer = {
      ws,
      generation: 0,
      phase: "hello",
      seq: 0,
      queued: 0,
      chain: Promise.resolve(),
      timer: setTimeout(() => ws.close(1008, "HANDSHAKE_TIMEOUT"), 5000),
    };
    this.peers.add(peer);
    ws.on("error", () => {});
    ws.on("close", () => {
      clearTimeout(peer.timer);
      this.peers.delete(peer);
      if (this.active === peer) {
        this.hooks.disconnected(peer.generation);
        this.active = undefined;
        this.deadline = Date.now() + this.windowMs;
        this.armDeadline();
      }
    });
    ws.on("message", (raw, binary) => {
      let event: Record<string, unknown>;
      try {
        if (binary) throw Error("BINARY_FORBIDDEN");
        const text = new TextDecoder("utf-8", { fatal: true }).decode(
          Buffer.isBuffer(raw) ? raw : Buffer.concat(raw as Buffer[]),
        );
        event = JSON.parse(text);
        if (!event || typeof event !== "object" || Array.isArray(event))
          throw Error("INVALID_FRAME");
        if (peer.phase === "hello") {
          if (
            !exact(event, ["type", "credential"]) ||
            event.type !== "hello" ||
            Date.now() >= this.deadline ||
            !(
              matches(event.credential, this.bootstrapHash) ||
              matches(event.credential, this.reconnectHash)
            )
          ) {
            this.send(peer, {
              type: "invalid-credential",
              recovery:
                "Wait for this TUI to exit, then relaunch for a fresh URL.",
            });
            ws.close(1008, "INVALID_CREDENTIAL");
            return;
          }
          this.bootstrapHash = undefined;
          this.reconnectHash = undefined;
          if (this.active)
            this.revoke(this.active, "REPLACED_BY_NEW_GENERATION");
          const nextSecret = secret();
          this.reconnectHash = verifier(nextSecret);
          peer.generation = ++this.generation;
          peer.phase = "ack";
          this.active = peer;
          this.send(peer, {
            type: "hello",
            generation: peer.generation,
            reconnect: nextSecret,
          });
          return;
        }
        if (peer !== this.active || event.generation !== peer.generation)
          throw Error("STALE_GENERATION");
        if (peer.phase === "ack") {
          if (
            !exact(event, ["type", "generation"]) ||
            event.type !== "hello-ack"
          )
            throw Error("HANDSHAKE_ACK_REQUIRED");
          peer.phase = "sync";
          this.send(peer, {
            type: "sync",
            generation: peer.generation,
            state: this.hooks.snapshot(),
          });
          return;
        }
        if (peer.phase === "sync") {
          if (
            !exact(event, ["type", "generation"]) ||
            event.type !== "sync-ack"
          )
            throw Error("STATE_SYNC_REQUIRED");
          peer.phase = "ready";
          clearTimeout(peer.timer);
          this.deadline = Infinity;
          this.armDeadline();
          this.hooks.connected(peer.generation);
          this.send(peer, {
            type: "ready",
            generation: peer.generation,
            state: this.hooks.snapshot(),
          });
          return;
        }
        if (
          peer.phase !== "ready" ||
          !exact(event, ["type", "generation", "seq", "event"]) ||
          event.type !== "event" ||
          event.seq !== peer.seq + 1
        )
          throw Error("INVALID_SEQUENCE");
        peer.seq++;
        const size =
          raw instanceof ArrayBuffer
            ? raw.byteLength
            : Array.isArray(raw)
              ? raw.reduce((s, x) => s + x.length, 0)
              : raw.length;
        peer.queued += size;
        if (peer.queued > 8 * 1024 * 1024) throw Error("INPUT_QUEUE_BOUND");
        const seq = peer.seq,
          payload = event.event;
        peer.chain = peer.chain
          .then(async () => {
            if (peer !== this.active || peer.phase !== "ready") return;
            try {
              const result = await this.hooks.event(payload, peer.generation);
              this.send(peer, {
                type: "ack",
                generation: peer.generation,
                seq,
                ...(result?.unchanged ? {} : { state: this.hooks.snapshot() }),
              });
            } catch (error) {
              const code =
                error instanceof Error ? error.message : "INPUT_ERROR";
              this.send(peer, {
                type: "rejected",
                generation: peer.generation,
                seq,
                error: code,
                state: this.hooks.snapshot(),
              });
              // Revision/range uncertainty invalidates this connection. Business refusal is recoverable.
              if (
                /^(STALE_GENERATION|STALE_REVISION|STALE_INPUT_RANGE|INVALID_EVENT|UNSUPPORTED_INPUT|INPUT_TRANSACTION_EXPIRED|INVALID_INPUT_CHUNK)/.test(
                  code,
                )
              )
                this.revoke(peer, "RESYNC_REQUIRED");
            }
          })
          .finally(() => {
            peer.queued -= size;
          });
      } catch {
        this.revoke(peer, "INVALID_PROTOCOL");
        ws.close(1008, "INVALID_PROTOCOL");
      }
    });
  }
  publish() {
    if (this.active?.phase === "ready")
      this.send(this.active, {
        type: "state",
        generation: this.active.generation,
        state: this.hooks.snapshot(),
      });
  }
  notify(message: unknown) {
    if (this.active?.phase === "ready") this.send(this.active, message);
  }
  async close() {
    this.closing = true;
    clearTimeout(this.deadlineTimer);
    this.bootstrapHash = undefined;
    this.reconnectHash = undefined;
    for (const peer of this.peers) {
      clearTimeout(peer.timer);
      if (peer === this.active) this.hooks.disconnected(peer.generation);
      this.send(peer, { type: "quit" });
      peer.ws.close(1000, "TUI_CLOSED");
      peer.ws.terminate();
    }
    this.active = undefined;
    this.http.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve) => this.ws.close(() => resolve())),
      new Promise<void>((resolve) => this.http.close(() => resolve())),
    ]);
  }
}
