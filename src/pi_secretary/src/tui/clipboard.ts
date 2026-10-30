import { spawn } from "node:child_process";

/** Clipboard text is stdin, never a shell command. Also handles a closed pipe. */
export function pipeClipboard(
  command: string,
  args: string[],
  text: string,
  timeoutMs = 3000,
): Promise<boolean | string> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ["pipe", "ignore", "ignore"],
      env: {
        ...process.env,
        LANG: "en_US.UTF-8",
        LC_CTYPE: "en_US.UTF-8",
        LC_ALL: "en_US.UTF-8",
      },
    });
    let failure = "";
    const timer = setTimeout(() => {
      failure = "复制超时，剪贴板未确认";
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdin.on("error", () => {
      failure = "复制失败：剪贴板输入已关闭";
    });
    child.on("error", () => {
      failure = "复制失败：系统剪贴板不可用";
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(failure || (code === 0 ? true : "复制失败：系统剪贴板未写入"));
    });
    child.stdin.end(text, "utf8");
  });
}

export function serialClipboardWriter(
  write: (text: string) => Promise<boolean | string>,
) {
  let copies: Promise<unknown> = Promise.resolve();
  return (text: string) => {
    const job = copies.catch(() => {}).then(() => write(text));
    copies = job;
    return job;
  };
}
const writeLocalClipboard = serialClipboardWriter((text) =>
  pipeClipboard("/usr/bin/pbcopy", [], text),
);
/** Pi supplies displayed selection text, not Markdown source or hidden paste payloads. */
export function copySelection(
  text: string,
  platform = process.platform,
): Promise<boolean | string> {
  if (
    platform !== "darwin" ||
    process.env.SSH_CONNECTION ||
    process.env.SSH_TTY
  )
    return Promise.resolve("复制暂仅支持本地 macOS 终端；SSH 剪贴板未接入");
  return writeLocalClipboard(text);
}
