import { markdown } from "../../benchmarks/common/report.ts";
import path from "node:path";
import { Domains, configuration } from "./domain.ts";
import {
  deploymentGuard,
  inside,
  noLinks,
  readJSON,
  repository,
  requireThat,
} from "./io.ts";
import {
  archiveFacility,
  archiveDestination,
  assertArchiveTargetExternal,
} from "./archive.ts";
import { selfCheck } from "./self-check.ts";

async function main() {
  const [command, ...args] = process.argv.slice(2),
    options: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    requireThat(
      ["--run", "--checkpoint", "--config", "--root", "--apply"].includes(
        args[i],
      ) &&
        !!args[i + 1] &&
        !options[args[i]],
      "INVALID_ARGUMENTS",
    );
    options[args[i]] = args[i + 1];
  }
  const root = options["--root"]
    ? path.resolve(options["--root"])
    : path.join(repository, ".local/benchmark");
  if (["run", "self-check"].includes(command))
    requireThat(
      options["--root"] && root !== path.join(repository, ".local/benchmark"),
      "BENCHMARK_EXPLICIT_FACILITY_ROOT_REQUIRED",
    );
  deploymentGuard(repository, root);
  if (command === "archive") {
    requireThat(
      options["--root"] &&
        Object.keys(options).every((k) => ["--root", "--apply"].includes(k)),
      "ARCHIVE_EXPLICIT_ROOT_REQUIRED",
    );
    requireThat(
      options["--apply"] === undefined || options["--apply"] === "true",
      "ARCHIVE_APPLY_MUST_BE_TRUE",
    );
    assertArchiveTargetExternal(root, archiveDestination);
    const result = await archiveFacility(
      root,
      archiveDestination,
      options["--apply"] === "true",
    );
    console.log(JSON.stringify(result, null, 2));
    if (
      result.status === "ARCHIVED" &&
      (!result.source_removed || result.warnings?.length)
    )
      process.exitCode = 1;
    return;
  }
  requireThat(!options["--apply"], "APPLY_ONLY_FOR_ARCHIVE");
  if (options["--config"]) {
    const file = path.resolve(options["--config"]);
    noLinks(file);
    requireThat(
      inside(path.join(root, "configs"), file),
      "CONFIG_OUTSIDE_FACILITY",
    );
    options["--config"] = file;
  }
  if (command === "self-check") {
    const { report, directory } = await selfCheck(root);
    console.log(
      JSON.stringify(
        {
          report: directory,
          cases: report.cases,
          first_failure: report.first_failure,
        },
        null,
        2,
      ),
    );
    if (report.cases.some((c) => ["FAIL", "INCOMPLETE"].includes(c.status)))
      process.exitCode = 1;
    return;
  }
  if (command === "report") {
    const id = options["--run"];
    requireThat(id && /^[0-9a-f-]{36}$/.test(id), "REPORT_ID_REQUIRED");
    console.log(
      markdown(readJSON(path.join(root, "reports", id, "report.json"))),
    );
    return;
  }
  await Domains.use(root, async (d) => {
    const id = options["--run"];
    let result: unknown;
    if (command === "run") {
      const run = await d.create(
        options["--config"] ? readJSON(options["--config"]) : configuration,
      );
      result = await d.start(run.id);
    } else {
      requireThat(id, "RUN_ID_REQUIRED");
      if (command === "status") result = d.load(id);
      else if (command === "start") result = await d.start(id);
      else if (command === "stop") result = await d.stop(id);
      else if (command === "checkpoint")
        result = { checkpoint: await d.checkpoint(id) };
      else if (command === "restore") {
        requireThat(options["--checkpoint"], "CHECKPOINT_REQUIRED");
        result = await d.restore(id, options["--checkpoint"]);
      } else if (command === "recover") result = await d.recover(id);
      else if (command === "seal") result = await d.seal(id);
      else if (command === "clean") result = await d.clean(id);
      else
        throw Error(
          "Use run|status|start|stop|checkpoint|restore|recover|seal|clean|report|self-check|archive",
        );
    }
    // Never print tokens, passwords or DSNs from a private registry record.
    const r = result as any;
    console.log(
      JSON.stringify(
        r.id
          ? {
              run_id: r.id,
              lineage: r.lineage,
              state: r.state,
              evidence: r.evidence,
            }
          : r,
        null,
        2,
      ),
    );
  });
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
