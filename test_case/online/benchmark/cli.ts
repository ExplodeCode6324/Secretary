import {
  buildAssessment,
  planFreshAssessment,
  exportAssessment,
  reserveAssessment,
  sendAssessment,
  importAssessment,
  assessmentNoResponse,
} from "./assessment.ts";
import {
  createAssessmentReplayManifest,
  replayAssessment,
} from "./assessment-report.ts";
import { writeJSON } from "./io.ts";
import fs from "node:fs";
import { sha } from "./io.ts";
import {
  gradeJSONBytes,
  incompleteGradePreparation,
  readOwnedGradeFile,
  gradeUUID,
} from "./grading-transaction.ts";
import { exportJudgeMigration } from "./grading-migration-store.ts";
import {
  requireExistingGradeFacility,
  reconcileGradeTransaction,
} from "./grading-transaction.ts";
import {
  assertReviewedMigrationHead,
  prepareMigrationReady,
  reserveMigrationAttempt,
  recordMigrationSend,
  recordMigrationNoResponse,
  importMigrationResponse,
} from "./grading-attempt.ts";
import { importGradeBatch } from "./grading-batch.ts";
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
import { probeModels } from "./probe.ts";
import { preparePublic } from "./dataset.ts";
import { stopDatabase } from "./postgres.ts";
import { pilot } from "./episodes.ts";
import { modelIDs, type ModelID } from "./live-model.ts";
import {
  readGradeSubmission,
  freezeGradeDisposition,
  exportGradePacket,
  importGradePacket,
} from "./grading.ts";
import { replaySummaryCapacity } from "./capacity.ts";
import { preparePrivate } from "./private-replay.ts";
import { publicPilot } from "./public-reader.ts";
import { auditEpisode } from "./evidence-audit.ts";
import { lifecyclePilot } from "./lifecycle.ts";
import { prepareRepository, repositoryPilot } from "./repository-replay.ts";
import { worldPilot } from "./world-replay.ts";
import { scoreDevelopment } from "./score.ts";
import { exportPublicGrades, importPublicGrades } from "./public-grading.ts";

async function main() {
  const [command, ...args] = process.argv.slice(2),
    options: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    requireThat(
      [
        "--batch",
        "--attempt",
        "--transaction",
        "--sha256",
        "--run",
        "--checkpoint",
        "--config",
        "--root",
        "--apply",
        "--approval",
        "--subset",
        "--models",
        "--verdict",
        "--profiles",
        "--source",
        "--provenance",
      ].includes(args[i]) &&
        !!args[i + 1] &&
        !options[args[i]],
      "INVALID_ARGUMENTS",
    );
    options[args[i]] = args[i + 1];
  }
  const root = options["--root"]
    ? path.resolve(options["--root"])
    : path.join(repository, ".local/benchmark");
  if (
    [
      "run",
      "self-check",
      "memory-probe",
      "memory-prepare",
      "memory-pilot",
      "memory-private-prepare",
      "memory-public",
      "memory-lifecycle",
      "memory-repository-prepare",
      "memory-repository",
      "memory-world",
    ].includes(command)
  )
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
  if (
    command.startsWith("memory-assessment-") ||
    command.startsWith("memory-judge-") ||
    command.startsWith("memory-grade-batch-") ||
    command === "memory-score"
  )
    requireExistingGradeFacility(root);
  const input = (key: string) => {
    requireThat(options[key], "GRADE_ARGUMENT_REQUIRED");
    return readGradeSubmission(root, path.resolve(options[key])).raw;
  };
  if (command === "memory-assessment-replay") {
    const manifest = input("--source"),
      locations = input("--config");
    console.log(
      JSON.stringify(
        replayAssessment(manifest, locations, options["--sha256"]),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "memory-judge-ready") {
    const source = input("--source"),
      proof = input("--approval");
    console.log(
      JSON.stringify(await prepareMigrationReady(source.roots, proof)),
    );
    return;
  }
  await Domains.use(root, async (d) => {
    if (command === "memory-assessment-plan") {
      const source = input("--source");
      const plan = planFreshAssessment(
        root,
        source.runs,
        source.cohort,
        source.anchor_relative,
      );
      const id = plan.worklist.new_batches[0].assessment_id;
      const file = path.join(
        repository,
        ".local/reviews",
        `assessment-source-${id}.json`,
      );
      requireThat(!fs.existsSync(file), "ASSESSMENT_PLAN_ALREADY_EXISTS");
      writeJSON(file, plan);
      console.log(
        JSON.stringify({
          file,
          assessment_id: id,
          worklist_sha256: sha(gradeJSONBytes(plan.worklist)),
        }),
      );
      return;
    }
    if (command === "memory-assessment-prepare") {
      const source = input("--source");
      const prepared = buildAssessment(
        root,
        source.worklist,
        source.history,
        options["--batch"],
        source.anchor_relative,
      );
      // Only the private preparation artifact contains mappings/control keys.
      const destination = path.join(
        repository,
        ".local/reviews",
        `assessment-preparation-${options["--batch"]}.json`,
      );
      requireThat(
        !fs.existsSync(destination),
        "ASSESSMENT_PREPARATION_ALREADY_EXISTS",
      );
      writeJSON(destination, {
        record: prepared.record,
        privateData: prepared.privateData,
        preparation_sha256: prepared.preparation_sha256,
      });
      console.log(
        JSON.stringify({
          file: destination,
          record_sha256: sha(gradeJSONBytes(prepared.record)),
          request_sha256: prepared.record.request_sha256,
          preparation_sha256: prepared.preparation_sha256,
        }),
      );
      return;
    }
    if (
      command === "memory-assessment-export" ||
      command === "memory-grade-batch-export"
    ) {
      const source = input("--source");
      console.log(
        JSON.stringify(
          exportAssessment(
            root,
            d.assertControllerLease(),
            source.worklist,
            source.history,
            options["--batch"],
            source.anchor_relative,
            undefined,
            input("--approval"),
          ),
        ),
      );
      return;
    }
    if (command === "memory-assessment-reserve") {
      console.log(
        JSON.stringify(
          reserveAssessment(
            root,
            d.assertControllerLease(),
            options["--batch"],
            input("--source"),
            input("--approval"),
          ),
        ),
      );
      return;
    }
    if (command === "memory-assessment-send") {
      console.log(
        JSON.stringify(
          sendAssessment(
            root,
            d.assertControllerLease(),
            options["--batch"],
            options["--attempt"],
          ),
        ),
      );
      return;
    }
    if (command === "memory-assessment-no-response") {
      console.log(
        JSON.stringify(
          assessmentNoResponse(
            root,
            d.assertControllerLease(),
            options["--batch"],
            options["--attempt"],
            input("--source"),
          ),
        ),
      );
      return;
    }
    if (
      command === "memory-assessment-import" ||
      command === "memory-grade-batch-import"
    ) {
      requireThat(
        options["--verdict"] && options["--batch"] && options["--attempt"],
        "ASSESSMENT_IMPORT_ARGUMENTS_REQUIRED",
      );
      console.log(
        JSON.stringify(
          importAssessment(
            root,
            d.assertControllerLease(),
            options["--batch"],
            options["--attempt"],
            path.resolve(options["--verdict"]),
            input("--source"),
          ),
        ),
      );
      return;
    }
    if (command === "memory-assessment-snapshot") {
      const source = input("--source");
      const manifest = createAssessmentReplayManifest(
        source.worklist,
        source.locations,
      );
      const destination = path.join(
        repository,
        ".local/reviews",
        `assessment-replay-${sha(gradeJSONBytes(manifest))}.json`,
      );
      if (!fs.existsSync(destination)) writeJSON(destination, manifest);
      console.log(
        JSON.stringify({
          file: destination,
          sha256: sha(gradeJSONBytes(manifest)),
        }),
      );
      return;
    }
    if (command === "memory-judge-export") {
      const proof = input("--approval");
      assertReviewedMigrationHead(proof);
      const expected = proof.export_preparation_sha256?.[options["--batch"]];
      requireThat(
        typeof expected === "string" && /^[0-9a-f]{64}$/.test(expected),
        "MIGRATION_COPY_COMPARISON_REQUIRED",
      );
      console.log(
        JSON.stringify(
          exportJudgeMigration(
            root,
            d.assertControllerLease(),
            input("--source"),
            options["--batch"],
            undefined,
            expected,
          ),
        ),
      );
      return;
    }
    if (command === "memory-judge-reserve") {
      console.log(
        JSON.stringify(
          reserveMigrationAttempt(
            root,
            d.assertControllerLease(),
            options["--batch"],
            input("--source"),
          ),
        ),
      );
      return;
    }
    if (command === "memory-judge-send") {
      console.log(
        JSON.stringify(
          recordMigrationSend(
            root,
            d.assertControllerLease(),
            options["--attempt"],
          ),
        ),
      );
      return;
    }
    if (command === "memory-judge-no-response") {
      console.log(
        JSON.stringify(
          recordMigrationNoResponse(
            root,
            d.assertControllerLease(),
            options["--attempt"],
            input("--source"),
          ),
        ),
      );
      return;
    }
    if (command === "memory-judge-import") {
      requireThat(options["--verdict"], "GRADE_SUBMISSION_REQUIRED");
      console.log(
        JSON.stringify(
          importMigrationResponse(
            root,
            d.assertControllerLease(),
            options["--attempt"],
            path.resolve(options["--verdict"]),
            input("--source"),
          ),
        ),
      );
      return;
    }
    if (command === "memory-judge-inspect") {
      const id = options["--transaction"];
      requireThat(gradeUUID(id), "GRADE_RECONCILE_INVALID");
      const name = `oracles/.grading-transactions/${id}/prepare.json`;
      const result = fs.existsSync(path.join(root, name))
        ? {
            transaction_id: id,
            kind: "PREPARED",
            sha256: sha(readOwnedGradeFile(root, name)),
          }
        : {
            transaction_id: id,
            kind: "INCOMPLETE_PREPARATION",
            ...incompleteGradePreparation(root, id),
          };
      console.log(JSON.stringify(result));
      return;
    }
    if (command === "memory-judge-reconcile") {
      console.log(
        JSON.stringify(
          reconcileGradeTransaction(
            root,
            d.assertControllerLease(),
            options["--transaction"],
            options["--sha256"],
          ),
        ),
      );
      return;
    }

    if (command === "memory-campaign-close") {
      requireThat(
        options["--root"] && Object.keys(options).every((k) => k === "--root"),
        "CAMPAIGN_CLOSE_EXPLICIT_ROOT_REQUIRED",
      );
      console.log(JSON.stringify(await d.closeStoppedCampaign()));
      return;
    }
    if (command === "memory-public-grade-export") {
      console.log(JSON.stringify(exportPublicGrades(d)));
      return;
    }
    if (command === "memory-public-grade-import") {
      requireThat(options["--verdict"], "GRADE_SUBMISSION_REQUIRED");
      console.log(
        JSON.stringify(
          importPublicGrades(d, path.resolve(options["--verdict"])),
        ),
      );
      return;
    }
    if (command === "memory-score") {
      console.log(JSON.stringify(scoreDevelopment(d), null, 2));
      return;
    }
    if (command === "memory-repository-prepare") {
      requireThat(
        options["--source"] && options["--provenance"],
        "REPOSITORY_SOURCE_AND_PIN_REQUIRED",
      );
      console.log(
        JSON.stringify(
          prepareRepository(
            d,
            path.resolve(options["--source"]),
            path.resolve(options["--provenance"]),
          ),
        ),
      );
      return;
    }
    if (
      command === "memory-lifecycle" ||
      command === "memory-repository" ||
      command === "memory-world"
    ) {
      requireThat(options["--approval"], "CAMPAIGN_APPROVAL_ID_REQUIRED");
      const models = (options["--models"]?.split(",") ?? [
        ...modelIDs,
      ]) as ModelID[];
      requireThat(
        models.length > 0 &&
          new Set(models).size === models.length &&
          models.every((m) => modelIDs.includes(m)),
        "MODEL_NOT_APPROVED",
      );
      const report =
        command === "memory-lifecycle"
          ? await lifecyclePilot(d, options["--approval"], models)
          : command === "memory-world"
            ? await worldPilot(d, options["--approval"], models)
            : await repositoryPilot(d, options["--approval"], models);
      console.log(
        JSON.stringify(
          {
            report_id: report.run_id,
            cases: report.cases,
            first_failure: report.first_failure,
          },
          null,
          2,
        ),
      );
      return;
    }
    if (command === "memory-audit") {
      requireThat(options["--run"], "RUN_ID_REQUIRED");
      const { file, audit } = auditEpisode(d.load(options["--run"]));
      console.log(
        JSON.stringify({
          file,
          maintenance: audit.maintenance.status,
          first_failure: audit.maintenance.first_failure,
        }),
      );
      return;
    }
    if (command === "memory-private-prepare") {
      requireThat(
        options["--source"] && options["--provenance"],
        "PRIVATE_SOURCE_AND_PROVENANCE_REQUIRED",
      );
      console.log(
        JSON.stringify(
          await preparePrivate(
            d,
            path.resolve(options["--source"]),
            path.resolve(options["--provenance"]),
          ),
        ),
      );
      return;
    }
    if (command === "memory-capacity-replay") {
      requireThat(options["--run"], "RUN_ID_REQUIRED");
      console.log(
        JSON.stringify(
          replaySummaryCapacity(d.load(options["--run"])),
          null,
          2,
        ),
      );
      return;
    }
    if (command === "memory-pilot" || command === "memory-public") {
      requireThat(options["--approval"], "CAMPAIGN_APPROVAL_ID_REQUIRED");
      const subset =
        options["--subset"] ?? (command === "memory-public" ? "dev" : "smoke");
      requireThat(
        command === "memory-public"
          ? subset === "dev" || subset === "smoke"
          : subset === "smoke" ||
              subset === "synthetic" ||
              subset === "private",
        "UNKNOWN_PILOT_SUBSET",
      );
      const models = (options["--models"]?.split(",") ?? [
        ...modelIDs,
      ]) as ModelID[];
      requireThat(
        models.length > 0 &&
          new Set(models).size === models.length &&
          models.every((m) => modelIDs.includes(m)),
        "MODEL_NOT_APPROVED",
      );
      if (command === "memory-public") {
        requireThat(
          subset === "dev" || subset === "smoke",
          "PUBLIC_SPLIT_INVALID",
        );
        const report = await publicPilot(
          d,
          options["--approval"],
          subset,
          models,
        );
        console.log(
          JSON.stringify(
            {
              report_id: report.run_id,
              cases: report.cases,
              first_failure: report.first_failure,
            },
            null,
            2,
          ),
        );
        return;
      }
      requireThat(
        subset === "smoke" || subset === "synthetic" || subset === "private",
        "UNKNOWN_PILOT_SUBSET",
      );
      const profiles = options["--profiles"]?.split(",") as
        ("RC" | "DEP")[] | undefined;
      requireThat(
        !profiles ||
          (profiles.length > 0 &&
            new Set(profiles).size === profiles.length &&
            profiles.every((p) => ["RC", "DEP"].includes(p))),
        "UNKNOWN_PROFILE",
      );
      const report = await pilot(
        d,
        options["--approval"],
        subset,
        models,
        profiles,
      );
      console.log(
        JSON.stringify(
          {
            report_id: report.run_id,
            cases: report.cases,
            first_failure: report.first_failure,
          },
          null,
          2,
        ),
      );
      return;
    }
    if (command === "memory-grade-disposition") {
      requireThat(
        options["--run"] && options["--verdict"],
        "GRADE_DISPOSITION_ARGUMENTS_REQUIRED",
      );
      d.load(options["--run"]);
      console.log(
        JSON.stringify(
          freezeGradeDisposition(
            root,
            options["--run"],
            path.resolve(options["--verdict"]),
          ),
        ),
      );
      return;
    }
    if (
      command === "memory-grade-export" ||
      command === "memory-grade-import"
    ) {
      requireThat(options["--run"], "RUN_ID_REQUIRED");
      d.load(options["--run"]);
      if (command === "memory-grade-export")
        console.log(
          JSON.stringify({
            source_packet: exportGradePacket(
              root,
              options["--run"],
              auditEpisode(d.load(options["--run"]), false).audit,
            ),
            sendable: false,
            next: "memory-assessment-prepare then memory-grade-batch-export",
          }),
        );
      else throw new Error("USE_OPUS_ASSESSMENT_IMPORT_WITH_BATCH_AND_ATTEMPT");
      return;
    }
    if (command === "memory-prepare") {
      const run = await d.create();
      await stopDatabase(run.database);
      console.log(
        JSON.stringify(
          await preparePublic(
            root,
            options["--source"] ? path.resolve(options["--source"]) : undefined,
          ),
        ),
      );
      return;
    }
    if (command === "memory-probe") {
      requireThat(options["--approval"], "CAMPAIGN_APPROVAL_ID_REQUIRED");
      const result = await probeModels(d, options["--approval"]);
      console.log(
        JSON.stringify(
          {
            run_id: result.run_id,
            evidence: result.evidence,
            results: result.results.map((r: any) => ({
              id: r.id,
              listed: r.listed,
              live_status: r.live_status,
            })),
          },
          null,
          2,
        ),
      );
      return;
    }
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
