import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { aliasesOf } from "./commands.ts";
export type Config = {
  data: string;
  mode: "fixture" | "live";
  open: boolean;
  quota: number;
  maxOutbox: number;
  aliases: Record<string, string>;
};
export function privateDirectory(directory: string) {
  if (!path.isAbsolute(directory) || path.normalize(directory) !== directory)
    throw Error("ABSOLUTE_NORMALIZED_DATA_REQUIRED");
  let at = path.parse(directory).root;
  for (const part of directory
    .slice(at.length)
    .split(path.sep)
    .filter(Boolean)) {
    at = path.join(at, part);
    const stat = fs.lstatSync(at);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw Error("UNSAFE_DATA_PATH");
  }
  const stat = fs.lstatSync(directory);
  if (stat.uid !== process.getuid?.() || stat.mode & 0o077)
    throw Error("DATA_MUST_BE_OWNED_0700");
}
export function parseConfig(argv: string[]): Config {
  const args = new Map<string, string>();
  let open = false;
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--open" && !open) {
      open = true;
      continue;
    }
    if (
      !["--data", "--mode", "--config"].includes(key) ||
      args.has(key) ||
      !argv[i + 1] ||
      argv[i + 1].startsWith("--")
    )
      throw Error(
        "USAGE: tui --data /absolute/private/profile --mode fixture|live [--open], or --config /absolute/private/config.json",
      );
    args.set(key, argv[++i]);
  }
  let settings: Record<string, unknown> = {};
  if (args.has("--config")) {
    if (args.size !== 1) throw Error("CONFIG_EXCLUSIVE");
    const file = args.get("--config")!;
    if (!path.isAbsolute(file) || path.normalize(file) !== file)
      throw Error("ABSOLUTE_CONFIG_REQUIRED");
    let at = path.parse(file).root;
    for (const part of file.slice(at.length).split(path.sep)) {
      at = path.join(at, part);
      if (fs.lstatSync(at).isSymbolicLink()) throw Error("UNSAFE_CONFIG_PATH");
    }
    const fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    try {
      const stat = fs.fstatSync(fd);
      if (
        !stat.isFile() ||
        stat.uid !== process.getuid?.() ||
        (stat.mode & 0o777) !== 0o600 ||
        stat.nlink !== 1 ||
        stat.size > 16384
      )
        throw Error("UNSAFE_CONFIG");
      settings = JSON.parse(fs.readFileSync(fd, "utf8"));
    } finally {
      fs.closeSync(fd);
    }
    if (
      !settings ||
      typeof settings !== "object" ||
      Array.isArray(settings) ||
      Object.keys(settings).some(
        (k) => !["data", "mode", "quota", "maxOutbox", "aliases"].includes(k),
      )
    )
      throw Error("INVALID_CONFIG");
    if (
      typeof settings.data === "string" &&
      (file === settings.data || file.startsWith(settings.data + path.sep))
    )
      throw Error("CONFIG_MUST_BE_OUTSIDE_CORE_DATA");
  } else settings = { data: args.get("--data"), mode: args.get("--mode") };
  if (
    typeof settings.data !== "string" ||
    !["fixture", "live"].includes(String(settings.mode))
  )
    throw Error("EXPLICIT_DATA_AND_MODE_REQUIRED");
  privateDirectory(settings.data);
  const quota = settings.quota ?? 256 * 1024 * 1024,
    maxOutbox = settings.maxOutbox ?? 1000;
  if (
    !Number.isSafeInteger(quota) ||
    Number(quota) < 8 * 1024 * 1024 ||
    Number(quota) > 1024 * 1024 * 1024 ||
    !Number.isSafeInteger(maxOutbox) ||
    Number(maxOutbox) < 1 ||
    Number(maxOutbox) > 1000
  )
    throw Error("INVALID_CAPACITY");
  if (
    settings.aliases !== undefined &&
    (!settings.aliases ||
      typeof settings.aliases !== "object" ||
      Array.isArray(settings.aliases))
  )
    throw Error("INVALID_ALIAS");
  return {
    data: settings.data,
    mode: settings.mode as Config["mode"],
    open,
    quota: Number(quota),
    maxOutbox: Number(maxOutbox),
    aliases: aliasesOf(settings.aliases as Record<string, string> | undefined),
  };
}
/** Fixed installed-browser argv; no shell, profile flag, installation or default-browser fallback. */
export async function openBrowser(url: string): Promise<void> {
  const candidates =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
      : [
          "/usr/bin/google-chrome",
          "/usr/bin/chromium",
          "/usr/bin/chromium-browser",
        ];
  const executable = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executable)
    throw Error(
      "NO_INSTALLED_SUPPORTED_BROWSER: open the printed URL in Chrome/Chromium; no installation attempted",
    );
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [url], { stdio: "ignore", detached: true });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
