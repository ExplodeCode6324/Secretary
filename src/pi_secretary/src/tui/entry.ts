import fs from "node:fs";
import { parseConfig, openBrowser } from "./config.ts";
import { TuiApp } from "./app.ts";

async function main() {
  const config = parseConfig(process.argv.slice(2));
  const assets = Object.fromEntries(
    [
      ["/", "index.html", "text/html; charset=utf-8"],
      ["/client.js", "client.js", "text/javascript; charset=utf-8"],
      ["/style.css", "style.css", "text/css; charset=utf-8"],
    ].map(([route, file, type]) => [
      route,
      {
        type,
        body: fs.readFileSync(
          new URL("./web/" + file, import.meta.url),
          "utf8",
        ),
      },
    ]),
  );
  const app = new TuiApp(config, assets);
  let started = false,
    failed = false;
  app.onExit = (saved) => {
    if (!started) process.exit(1); // The precise startup error was already reported.
    console.error(
      saved
        ? "TUI closed; durable state saved. Core remains independent."
        : "TUI closed with unconfirmed writes; reopen durable state for recovery.",
    );
    process.exit(saved && !failed ? 0 : 1);
  };
  for (const signal of ["SIGINT", "SIGHUP", "SIGTERM"] as const)
    process.once(signal, () => {
      void app.close();
    });
  process.once("uncaughtException", (error) => {
    failed = true;
    console.error(error.message);
    void app.close();
  });
  process.once("unhandledRejection", (error) => {
    failed = true;
    console.error(String(error));
    void app.close();
  });
  try {
    const url = await app.start();
    started = true;
    console.log(
      "Secretary local browser command interface. Attach-only; start Core separately.",
    );
    console.log(
      "Open in installed Chrome/Chromium. Single-use URL expires after 60 seconds:",
    );
    console.log(url);
    if (config.open)
      await openBrowser(url).catch((error) => console.error(error.message));
  } catch (error) {
    failed = true;
    console.error(error instanceof Error ? error.message : String(error));
    await app.close();
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
