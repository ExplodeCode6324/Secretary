"""Summarize the retained 2026-09-22 evidence; never calls a model or the demos.

Catalog verdicts are conservative: a passing subset is INCONCLUSIVE, and a
reproduced required-invariant violation is FAIL. No whole-case PASS is inferred.
"""
from collections import Counter
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "test/reports/comparison-20260922"


def read(name):
    return json.loads((OUT / name).read_text())


def write(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def go_counts(name):
    rows = [json.loads(line) for line in (OUT / name).read_text().splitlines()]
    return dict(Counter(row["Action"] for row in rows
                        if row.get("Test") and "/" not in row["Test"]
                        and row["Action"] in {"pass", "fail", "skip"}))


def tap_counts(name):
    text = (OUT / name).read_text()
    return {key: int(re.findall(r"^# " + key + r" (\d+)$", text, re.M)[-1])
            for key in ["pass", "fail", "skipped"]}


AUDITS = [
    ("AUD01", "批准后文件改变", ["AUT-008", "SYS-009"], "PASS", "FAIL"),
    ("AUD02", "普通决定 deadline 已过", ["EXE-003", "SCH-007"], "FAIL", "FAIL"),
    ("AUD03", "相同普通决定重投", ["EXE-002"], "PASS", "FAIL"),
    ("AUD04", "缺失引用必须在落盘前拒绝", ["STO-002", "STO-005"], "PASS", "FAIL"),
    ("AUD05", "Context 记录不可原位修改", ["STA-007"], "FAIL", "FAIL"),
    ("AUD06", "拒绝 Input 非法跨状态迁移", ["STA-010"], "PASS", "FAIL"),
    ("AUD07", "拒绝不存在的 Session 引用", ["STO-002"], "PASS", "FAIL"),
    ("AUD08", "拒绝 journal 外帧未知字段", ["STO-004", "SYS-010"], "PASS", "FAIL"),
    ("AUD09", "拒绝非法 base64", ["STO-004"], "PASS", "FAIL"),
    ("AUD10", "拒绝全局事件序列断裂", ["STO-010"], "PASS", "FAIL"),
    ("AUD11", "无通道回执不得标记通知 SENT", ["EXE-017"], "PASS", "FAIL"),
    ("AUD12", "final gate 验证 epoch/attempt", ["STO-007", "AUT-004"], "FAIL", "FAIL"),
    ("AUD13", "等待中的前次执行不吞 QUEUE occurrence", ["SCH-005"], "PASS", "FAIL"),
    ("AUD14", "Context 保存实际工具定义", ["STA-007"], "PASS", "FAIL"),
    ("AUD15", "原始字节、同键重投、同键异内容", ["STO-003"], "PASS", "PASS"),
]


def memory_score():
    result = {}
    for impl in ["go", "pi"]:
        data = read(f"{impl}-memory.json")
        if impl == "go":
            answer = json.loads(next(m["text"] for m in reversed(data["messages"]) if m["text"]))
        else:
            last = next(m for m in reversed(data["messages"]) if m["role"] == "assistant")
            answer = json.loads("".join(c["text"] for c in last["content"] if c["type"] == "text"))
        # Narrow, visible rubric for these Chinese synthetic answers, not an LLM judge.
        checks = {
            "default_language": (answer["default_language"] == "中文", "当前默认中文"),
            "orion_external_language": (answer["orion_external_language"] == "英文", "Orion 对外英文"),
            "person_a_role": (all(t in answer["person_a_role"] for t in ["Orion", "设计"]), "P-A = Orion 设计"),
            "person_b_role": (all(t in answer["person_b_role"] for t in ["Lyra", "财务"]), "P-B = Lyra 财务"),
            "contract_status": (all(t in answer["contract_status"] for t in ["7", "未", "草稿", "等待"]), "第7条未履行且等待草稿；本题未询问 Scheduler 转交字段"),
            "height_d0_cm": (answer["height_d0_cm"] == 173.4, "历史173.4厘米"),
            "height_d30_cm": (answer["height_d30_cm"] == 173.5, "新值173.5厘米"),
            "release_day_status": (all(t in answer["release_day_status"] for t in ["D20", "D22", "未确定"]), "两个候选且未确定"),
            "device_now": (all(t in answer["device_now"] for t in ["不能确定", "D365", "在线"]), "不把过期观测外推"),
            "birthday": ("不知道" in answer["birthday"], "缺失资料明确未知"),
            "write_scope": ("工作目录" in answer["write_scope"] and any(t in answer["write_scope"] for t in ["自己", "自身"]), "仅自身任务工作目录"),
        }
        scored = [{"field": k, "answer": answer[k], "rubric": rubric,
                   "verdict": "PASS" if ok else "FAIL"} for k, (ok, rubric) in checks.items()]
        phases = []
        for phase in data["phase"]:
            cs = phase["consciousness"]
            if isinstance(cs, list):
                cs = cs[0]
            identities = [item for item in cs["items"] if "P-A" in json.dumps(item, ensure_ascii=False)]
            phases.append({"after_input": phase["after"], "error": phase.get("error"),
                           "committed_jobs_so_far": sum(j["state"] == "COMMITTED" for j in phase["jobs"]),
                           "identity_item_present": bool(identities)})
        result[impl] = {"evidence_level": "LIVE_MODEL", "calls": data["calls"],
                        "pass": sum(v[0] for v in checks.values()), "fail": sum(not v[0] for v in checks.values()),
                        "items": scored, "phases": phases,
                        "limitation": "单次8输入/3摘要/同进程关闭后重新打开；无未重启对照，无统计准确率结论"}
    write("memory-scores.json", result)
    return result


def catalog_mapping():
    catalog = json.loads((ROOT / "test/catalog.json").read_text())["cases"]
    evidence = {c["id"]: {impl: [] for impl in ["go", "pi"]} for c in catalog}

    def add(ids, impl, verdict, label, file):
        for case_id in ids.split():
            evidence[case_id][impl].append({"subcase_verdict": verdict, "label": label, "evidence": file})

    # Existing suites are mapped only to their observed subset, never to all variants.
    partial = [
        ("STA-001 STA-002 SYS-001", "TestMainDurableInboxDuringCall", "new input arriving during a Pi call"),
        ("STA-004", None, "crash after claiming a new input"),
        ("STA-005 SYS-002", "TestResponsesKeysAndPartialResponse", None),
        ("STA-007", "TestTaskApprovalRestartNoReplay", "separate processes restore exact Pi context"),
        ("STA-012 MEM-006", "TestCapacityRetainsInput", None),
        ("STO-001", "TestKillAfterDurableACK", "recover an ACK after SIGKILL"),
        ("STO-002 STO-005", "TestRollbackCASAndMissingObject", "missing original context object blocks recovery"),
        ("STO-004 STO-007", "TestJournalRecoveryAndOwnership", "OS owner lock excludes second writer"),
        ("STO-006 EXE-005", "TestUnknownCannotBeReissued", "restart reconstructs pending input and preserves unknown operation"),
        ("MEM-001 MEM-002 MEM-008", "TestCompactionCoverageAndCommitments; TestCompactionFailureRetainsPendingRawThenAtomicHandoff", "Consciousness compaction preserves originals"),
        ("SCH-001 EXE-001", "TestProgramRegistrationAndAuthorization", "separate role models and Scheduler packet preserve task materials and criteria"),
        ("SCH-003 SCH-004 SCH-006", "TestSchedulingAndUnknownPrecondition", "precondition waits stay outside idle retirement"),
        ("AUT-001 AUT-002 AUT-003 SYS-012", "TestTerminalConversationApprovalAndResult; TestSnapshotSelectionAndFrozenApproval", "TUI requires explicit viewed approval and rejects stale displays"),
        ("AUT-007 SYS-007", "TestPathAndRoleBoundaries", None),
        ("AUT-010 EXE-008", "TestProgramRegistrationAndAuthorization", "program launch waits for approval, captures real process output"),
        ("EXE-007", None, "later tool in same Pi batch is stopped"),
        ("EXE-009", "TestTaskApprovalRestartNoReplay", "plain completion text cannot mark agent task successful; incomplete criterion assessments"),
        ("EXE-010 EXE-014 EXE-016", "TestTerminalRetentionWaitsForFeedback", "short-term retirement keeps history and blocks pending feedback"),
        ("EXE-013", "TestSamePlanFollowupKeepsTerminalHistory", None),
        ("SYS-006", "TestIdentityOriginAndStrictIngress", None),
    ]
    for ids, go, pi in partial:
        for impl, label in [("go", go), ("pi", pi)]:
            if label:
                add(ids, impl, "PASS", label + "（仅已断言子项）", "go-tests.jsonl" if impl == "go" else "pi-tests.tap")
    for impl in ["go", "pi"]:
        add("WLD-001 WLD-002 WLD-004 WLD-008 WLD-009", impl, "PASS",
            "临时PG仓储/授权桥接：有限有效形状、冲突/CAS、outbox回放、change去重",
            "go-postgres-repository.jsonl;go-postgres-bridge.jsonl" if impl == "go" else "pi-postgres.tap")
        add("STO-003 SYS-003 SYS-013", impl, "PASS", "1000输入/2000请求，关闭后重新打开，逐条字节与状态核对", f"{impl}-load.json")
        add("MEM-008 MEM-010 MEM-011 MEM-015", impl, "PASS", "短记忆样本：承诺/更正/未知；没有完整长期及分支对照", f"{impl}-memory.json")
        add("MEM-012 MEM-014", impl, "FAIL" if impl == "go" else "PASS", "3次摘要后身份问题：Go丢2项；Pi本轮保留；未跑完整漂移矩阵", "memory-scores.json")
        add("E2E-001", impl, "PASS", "现有真实模型合成任务链；未覆盖全部拒绝后重建顺序", "go-live.json" if impl == "go" else "pi-live-chain.json;pi-live-reject.json")
        evidence["STO-008"][impl].append({"subcase_verdict": "BLOCKED_CAPABILITY", "label": "实现文档明确未提供恢复快照；未注入CURRENT故障", "evidence": "../../../demo_src_go/ARCHITECTURE.md" if impl == "go" else "../../../demo_pi/pi_secretary/REVIEW.md"})
    for aid, title, ids, go, pi in AUDITS:
        for impl, verdict in [("go", go), ("pi", pi)]:
            add(" ".join(ids), impl, verdict, f"{aid}: {title}", "go-audit.jsonl" if impl == "go" else "pi-audit.tap")
    rows = []
    for c in catalog:
        row = {"id": c["id"], "title": c["title"], "priority": c["priority"]}
        for impl in ["go", "pi"]:
            ev = evidence[c["id"]][impl]
            statuses = {e["subcase_verdict"] for e in ev}
            verdict = ("FAIL" if "FAIL" in statuses else "BLOCKED_CAPABILITY" if "BLOCKED_CAPABILITY" in statuses
                       else "INCONCLUSIVE" if ev else "NOT_RUN")
            row[impl] = {"verdict": verdict, "coverage": "PARTIAL" if ev else "NONE", "evidence": ev,
                         "limitation": "未覆盖catalog中所有前置、步骤、期望与参数排列；相关适配子项见证据"}
        rows.append(row)
    counts = {impl: dict(Counter(r[impl]["verdict"] for r in rows)) for impl in ["go", "pi"]}
    write("case-results.json", {"kind": "PARTIAL_RUNTIME_MAPPING", "catalog_total": len(rows),
                               "interpretation": "FAIL=至少一个相关义务有失败反例；INCONCLUSIVE=只有部分通过证据；不是120条已完整执行。关联探针包括契约扩展反例。",
                               "counts": counts, "cases": rows})
    lines = ["# 120条设计用例的本轮证据映射", "",
             "FAIL 表示发现相关义务的失败反例；INCONCLUSIVE 表示只有部分通过证据，整条尚未验收；NOT_RUN 表示本轮无直接执行证据。关联测试适配了 demo 的内部边界，不等于照抄完整用例步骤。完整断言、未执行部分及原始日志见 [JSON](case-results.json)。", "",
             "| 用例 | 场景 | Go | Pi | 已执行子项 |", "|---|---|---|---|---|"]
    for row in rows:
        labels = list(dict.fromkeys(e["label"] for impl in ["go", "pi"] for e in row[impl]["evidence"]))
        lines.append(f'| {row["id"]} | {row["title"]} | {row["go"]["verdict"]} | {row["pi"]["verdict"]} | ' + "; ".join(labels).replace("|", "/") + " |")
    (OUT / "case-results.md").write_text("\n".join(lines) + "\n")
    return counts


def main():
    scores = memory_score()
    counts = catalog_mapping()
    suites = {
        "existing_offline": {"go": go_counts("go-tests.jsonl"), "pi": tap_counts("pi-tests.tap")},
        "paired_boundaries_15": {"go": go_counts("go-audit.jsonl"), "pi": tap_counts("pi-audit.tap")},
        "postgres": {"go": {"pass": 2, "fail": 0}, "pi": tap_counts("pi-postgres.tap")},
        "gate_refinement": {"go": go_counts("go-gate-refinement.jsonl"), "pi": tap_counts("pi-gate-refinement.tap")},
        "live_existing": {"go": {"pass": 1, "fail": 0}, "pi": {"pass": 5, "fail": 0}},
        "short_load": {impl: read(f"{impl}-load.json")["verdict"] for impl in ["go", "pi"]},
        "memory_items": {impl: {k: scores[impl][k] for k in ["pass", "fail"]} for impl in ["go", "pi"]},
    }
    audits = [dict(id=a, title=t, related_cases=ids, go=g, pi=p) for a, t, ids, g, p in AUDITS]
    write("summary.json", {"run_id": "comparison-20260922", "recommendation": "GO_AS_DEVELOPMENT_BASE_WITH_BLOCKING_FIXES",
                           "release_verdict": {"go": "FAIL", "pi": "FAIL"}, "suites": suites,
                           "catalog_counts": counts, "paired_boundaries": audits,
                           "limitation": "Suites overlap and use unequal test granularity; do not sum into unique requirement coverage or general failure probability."})
    print(json.dumps({"suites": suites, "catalog_counts": counts}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
