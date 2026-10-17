// Async pipe IO lives here while the calling thread waits for a durable ACK.
import { parentPort, workerData } from "node:worker_threads";
import { spawn } from "node:child_process";
const alive = new Int32Array(workerData.alive);
const child = spawn(
  "python3",
  [workerData.helper, workerData.dir, workerData.channel],
  { stdio: ["pipe", "pipe", "ignore"] },
);
parentPort.postMessage({ kind: "pid", pid: child.pid });
let pending,
  opened = false,
  failed = false,
  closing = false,
  buffer = "";
function fail(error = "STORE_NOT_OWNER") {
  if (failed) return;
  failed = true;
  Atomics.store(alive, 0, 0);
  if (pending) {
    Atomics.store(pending.state, 0, -1);
    Atomics.notify(pending.state, 0);
  }
  parentPort.postMessage({ kind: "failure", error });
  child.kill("SIGKILL");
}
child.on("error", () => fail());
child.stdin.on("error", () => fail());
child.on("exit", () => Atomics.store(alive, 1, 1));
child.on("close", () => {
  if (!closing || buffer || pending) fail();
  Atomics.store(alive, 0, 0);
  parentPort.postMessage({ kind: "exited" });
  parentPort.close();
});
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  if (failed) return;
  buffer += chunk;
  try {
    for (;;) {
      const end = buffer.indexOf("\n");
      if (end < 0) {
        if (buffer.length > 4096) throw Error();
        return;
      }
      if (end > 4096) throw Error();
      const reply = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (!opened) {
        if (
          reply.id !== "open" ||
          reply.error ||
          !Number.isSafeInteger(reply.sequence) ||
          reply.sequence < 0 ||
          !/^[a-f0-9]{64}$/.test(reply.digest)
        )
          throw Error(reply.error || "STORE_NOT_OWNER");
        opened = true;
        Atomics.store(alive, 0, 1);
        parentPort.postMessage({ kind: "ready", reply });
      } else {
        if (
          !pending ||
          reply.error ||
          reply.id !== pending.id ||
          reply.sequence !== pending.sequence ||
          reply.digest !== pending.digest
        )
          throw Error();
        const bytes = Buffer.from(JSON.stringify(reply));
        pending.bytes.set(bytes);
        Atomics.store(pending.state, 1, bytes.length);
        Atomics.store(pending.state, 0, 1);
        Atomics.notify(pending.state, 0);
        pending = undefined;
      }
    }
  } catch (error) {
    fail(error.message || "STORE_NOT_OWNER");
  }
});
parentPort.on("message", (request) => {
  if (request.kind === "abort") {
    fail();
    return;
  }
  if (request.kind === "close") {
    closing = true;
    child.stdin.end();
    return;
  }
  if (failed || !opened || closing || pending) {
    fail();
    return;
  }
  pending = {
    ...request,
    state: new Int32Array(request.reply, 0, 2),
    bytes: new Uint8Array(request.reply, 8),
  };
  child.stdin.write(
    JSON.stringify({
      id: request.id,
      sequence: request.sequence,
      digest: request.digest,
      frame: request.frame,
    }) + "\n",
  );
});
