import { spawn } from "node:child_process";
const LIMIT = 4 * 1024 * 1024;
export class Clipboard {
  constructor(readonly platform = process.platform) {}
  private run(
    executable: "/usr/bin/pbpaste" | "/usr/bin/pbcopy",
    input = "",
  ): Promise<string> {
    if (this.platform !== "darwin")
      return Promise.reject(Error("CLIPBOARD_UNSUPPORTED: macOS only"));
    if (Buffer.byteLength(input) > LIMIT)
      return Promise.reject(Error("CLIPBOARD_BOUND"));
    return new Promise((resolve, reject) => {
      const child = spawn(executable, [], {
        shell: false,
        env: {
          PATH: "/usr/bin:/bin",
          LANG: "en_US.UTF-8",
          LC_ALL: "en_US.UTF-8",
        },
        stdio: ["pipe", "pipe", "ignore"],
      });
      let bytes = 0,
        error: Error | undefined;
      const chunks: Buffer[] = [];
      const fail = (reason: Error) => {
        error ??= reason;
        child.kill("SIGKILL");
      };
      const timer = setTimeout(() => fail(Error("CLIPBOARD_TIMEOUT")), 2000);
      child.once("error", fail);
      child.stdin.on("error", fail);
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > LIMIT) fail(Error("CLIPBOARD_BOUND"));
        else chunks.push(chunk);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (error || code !== 0) reject(error ?? Error("CLIPBOARD_FAILED"));
        else {
          try {
            resolve(
              new TextDecoder("utf-8", { fatal: true }).decode(
                Buffer.concat(chunks),
              ),
            );
          } catch {
            reject(Error("CLIPBOARD_INVALID_UTF8"));
          }
        }
      });
      child.stdin.end(input);
    });
  }
  read() {
    return this.run("/usr/bin/pbpaste");
  }
  async write(text: string) {
    await this.run("/usr/bin/pbcopy", text);
  }
}
