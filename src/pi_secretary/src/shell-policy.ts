import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { relativePath } from "./scopes.ts";

/** A deliberately small shell grammar. No substitutions or control operators. */
export function simpleCommand(
  command: string,
  reusable = false,
): string[] | null {
  if (!command || /[;&|`$><()\r\n\0]/.test(command)) return null;
  const tokens: string[] = [];
  let word = "",
    quote = "",
    started = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote === "'") {
      if (c === "'") quote = "";
      else word += c;
    } else if (c === "\\") {
      const next = command[++i];
      if (!next) return null;
      if (quote === '"' && !['"', "\\"].includes(next)) word += "\\";
      word += next;
      started = true;
    } else if (quote === '"') {
      if (c === '"') quote = "";
      else word += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      started = true;
    } else if (c === " " || c === "\t") {
      if (started) tokens.push(word);
      word = "";
      started = false;
    } else {
      if (c === "#" || (reusable && /[*?\[\]{}~]/.test(c))) return null;
      word += c;
      started = true;
    }
  }
  if (quote) return null;
  if (started) tokens.push(word);
  if (
    !tokens.length ||
    !tokens[0] ||
    tokens[0].includes("=") ||
    /^(if|then|else|elif|fi|for|while|until|do|done|case|esac|function|time|coproc|!|\{|\})$/.test(
      tokens[0],
    )
  )
    return null;
  return tokens;
}

export type ShellExecution = {
  argv: string[];
  env: Record<string, string>;
  policy_version: 1;
};
const toolDirs = ["/usr/bin", "/bin", "/opt/homebrew/bin", "/usr/local/bin"];
export function shellEnvironment() {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    LANG: "en_US.UTF-8",
  };
}
function executable(name: string, root: string) {
  for (const dir of toolDirs) {
    try {
      const file = fs.realpathSync(path.join(dir, name));
      if (file === root || file.startsWith(root + path.sep)) continue;
      if (!fs.statSync(file).isFile()) continue;
      fs.accessSync(file, fs.constants.X_OK);
      return file;
    } catch {
      /* Try next trusted installation directory. */
    }
  }
  return null;
}
const options: Record<
  string,
  { flags: string[]; values?: Record<string, "integer" | "pattern" | "type"> }
> = {
  ls: { flags: ["l", "a", "h", "R", "t", "1"] },
  cat: { flags: [] },
  stat: { flags: [] },
  file: { flags: [] },
  head: { flags: [], values: { n: "integer" } },
  tail: { flags: [], values: { n: "integer" } },
  wc: { flags: ["l", "w", "c"] },
  tree: { flags: ["a", "d"], values: { L: "integer" } },
  grep: {
    flags: ["r", "n", "i", "l", "c", "E", "F", "w"],
    values: { "--include": "pattern", "--exclude": "pattern" },
  },
  rg: {
    flags: ["n", "i", "l", "c", "F", "w", "--hidden"],
    values: { g: "pattern", t: "type" },
  },
};
function operand(root: string, value: string, fileOnly = false) {
  if (value === "-") throw Error("INVALID_PATH");
  const target = relativePath(root, value, true);
  if (fileOnly && !fs.statSync(target).isFile())
    throw Error("INVALID_RESOURCE");
}
function ordinary(root: string, words: string[]) {
  const [name, ...args] = words,
    spec = options[name];
  if (!spec) return false;
  let end = false,
    pattern = !["rg", "grep"].includes(name),
    paths = 0;
  const recursive =
    name === "rg" ||
    (name === "grep" && args.some((a) => /^-[rnilcEFw]*r[rnilcEFw]*$/.test(a)));
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!end && a === "--") {
      end = true;
      continue;
    }
    if (!end && a.startsWith("-")) {
      const key = a.startsWith("--") ? a.split("=")[0] : a.slice(1);
      const kind = spec.values?.[key];
      if (kind) {
        const value = a.includes("=") ? a.slice(a.indexOf("=") + 1) : args[++i];
        if (
          !value ||
          (kind === "integer" && !/^\d{1,7}$/.test(value)) ||
          (kind === "type" && !/^[\w-]+$/.test(value))
        )
          return false;
      } else if (!(
        spec.flags.includes(key) ||
        (!a.startsWith("--") &&
          key.length > 0 &&
          [...key].every((c) => spec.flags.includes(c)))
      ))
        return false;
      continue;
    }
    if (!pattern) {
      pattern = true;
      continue;
    }
    operand(
      root,
      a,
      ["cat", "head", "tail", "wc"].includes(name) ||
        (["grep", "rg"].includes(name) && !recursive),
    );
    if (["grep", "rg"].includes(name) && recursive) {
      const st = fs.statSync(relativePath(root, a, true));
      if (!st.isDirectory() && !st.isFile()) return false;
    }
    paths++;
  }
  if (!pattern) return false;
  if (["cat", "head", "tail", "wc", "stat", "file"].includes(name) && !paths)
    return false;
  if (name === "grep" && !recursive && !paths) return false;
  return true;
}
function find(root: string, args: string[]) {
  let i = 0;
  while (i < args.length && !args[i].startsWith("-")) operand(root, args[i++]);
  if (!i) return false;
  for (; i < args.length; i += 2) {
    const [key, value] = args.slice(i, i + 2);
    if (!value) return false;
    if (["-name", "-iname", "-path"].includes(key)) continue;
    if (key === "-type" && /^[fdl]$/.test(value)) continue;
    if (["-maxdepth", "-mindepth"].includes(key) && /^\d{1,5}$/.test(value))
      continue;
    if (key === "-size" && /^[+-]?\d+[ckMG]?$/i.test(value)) continue;
    if (key === "-mtime" && /^[+-]?\d+$/.test(value)) continue;
    return false;
  }
  return true;
}
function git(root: string, args: string[]): string[] | null {
  const [sub, ...rest] = args;
  const flags: Record<string, string[]> = {
    status: [],
    diff: ["--stat", "--name-only", "--cached"],
    log: ["--stat", "--name-only", "--oneline"],
    show: ["--stat", "--name-only", "--oneline"],
    "rev-parse": [],
    branch: [],
  };
  if (!Object.hasOwn(flags, sub) || (sub === "branch" && rest.length))
    return null;
  const dot = relativePath(root, ".git");
  if (!fs.statSync(dot).isDirectory()) return null;
  for (const p of [".git/objects", ".git/objects/info"]) relativePath(root, p);
  for (const p of [
    "commondir",
    "objects/info/alternates",
    "objects/info/http-alternates",
  ])
    if (fs.existsSync(path.join(dot, p))) return null;
  let paths = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (
      a === "--" &&
      !paths &&
      ["diff", "log", "show", "status"].includes(sub)
    ) {
      paths = true;
      continue;
    }
    if (paths) {
      operand(root, a);
      continue;
    }
    if (flags[sub].includes(a)) continue;
    if (
      a === "-n" &&
      ["log", "show"].includes(sub) &&
      /^\d{1,6}$/.test(rest[++i] ?? "")
    )
      continue;
    if (
      ["diff", "log", "show", "rev-parse"].includes(sub) &&
      /^(HEAD(?:[~^]\d*)?|[a-f0-9]{7,40})$/.test(a)
    )
      continue;
    return null;
  }
  return [
    "--no-pager",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "log.showSignature=false",
    "-c",
    "diff.ignoreSubmodules=all",
    `--git-dir=${dot}`,
    `--work-tree=${root}`,
    sub,
    ...(["diff", "log", "show"].includes(sub)
      ? ["--no-ext-diff", "--no-textconv"]
      : []),
    ...rest,
  ];
}
export function readonlyShell(
  root: string,
  command: string,
): ShellExecution | null {
  try {
    const words = simpleCommand(command);
    if (!words) return null;
    const name = words[0];
    let args: string[] | null;
    if (name === "git") args = git(root, words.slice(1));
    else if (name === "find")
      args = find(root, words.slice(1)) ? words.slice(1) : null;
    else args = ordinary(root, words) ? words.slice(1) : null;
    if (!args) return null;
    const bin = executable(name, root);
    if (!bin) return null;
    if (name === "rg") args.unshift("--no-config");
    if (name === "grep") args.unshift("--devices=skip");
    const execution: ShellExecution = {
      argv: [bin, ...args],
      policy_version: 1,
      env: {
        PATH: toolDirs.join(":"),
        LANG: "en_US.UTF-8",
        ...(name === "git"
          ? {
              GIT_CEILING_DIRECTORIES: path.dirname(root),
              GIT_CONFIG_NOSYSTEM: "1",
              GIT_CONFIG_GLOBAL: "/dev/null",
              GIT_OPTIONAL_LOCKS: "0",
              GIT_TERMINAL_PROMPT: "0",
              GIT_NO_LAZY_FETCH: "1",
            }
          : {}),
      },
    };
    if (name === "git") {
      // git diff/status can invoke clean/process filters even with textconv disabled.
      // Query only configuration, discard its values, and require the no-match exit code.
      const globals = args.slice(0, args.indexOf(words[1]));
      const probe = spawnSync(
        bin,
        [...globals, "config", "--includes", "--get-regexp", "^filter\\."],
        {
          cwd: root,
          env: execution.env,
          stdio: "ignore",
          timeout: 2000,
        },
      );
      if (probe.error || probe.status !== 1) return null;
    }
    return execution;
  } catch {
    return null;
  }
}
