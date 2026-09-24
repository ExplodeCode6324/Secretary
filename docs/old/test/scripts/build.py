#!/usr/bin/env python3
"""Render test design from its catalog. Does not run Secretary."""
import json
from collections import Counter
from pathlib import Path

TEST = Path(__file__).resolve().parents[1]
ROOT = TEST.parent


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def render():
    catalog = read_json(TEST / "catalog.json")
    machines = read_json(ROOT / "state_machine/catalog.json")["machines"]
    contracts = read_json(ROOT / "json/catalog.json")["contracts"]
    cases = catalog["cases"]
    outputs = {}
    group_files = {g["id"]: g["file"] for g in catalog["groups"]}

    def case_link(case, prefix=""):
        return f'[{case["id"]}]({prefix}cases/{group_files[case["group"]]}#{case["id"].lower()})'

    for group in catalog["groups"]:
        lines = [f'# {group["title"]}', '',
                 '由 [catalog.json](../catalog.json) 生成；修改唯一来源后运行 `python3 test/scripts/build.py`。', '',
                 '通用隔离设施、竞态排序和判定规则见 [执行协议](../PROTOCOL.md)。每个子情况独立执行和记录。evidence_level 是目标证据类型，不代表已经取得；真实模型场景中的确定性持久化子项可先以 OFFLINE_RUNTIME 单独报告。', '']
        for case in [c for c in cases if c["group"] == group["id"]]:
            lines += [f'<a id="{case["id"].lower()}"></a>',
                      f'## {case["id"]} {case["title"]}', '',
                      f'{case["priority"]} · 目标证据 `{case["evidence_level"]}` · `NOT_RUN`', '',
                      f'依据：BrainStorm {", ".join(case["baseline_sections"])}；语义约束 {", ".join(case["semantic_rules"])}。', '',
                      '规范：' + '、'.join(f'[{Path(s).name}](../../{s})' for s in case["sources"]) + '。', '',
                      f'前置：{case["preconditions"]}。', '', '步骤：', '']
            lines += [f'{i}. {step}。' for i, step in enumerate(case["steps"], 1)]
            lines += ['', '预期与禁止结果：', '']
            lines += [f'- {expected}。' for expected in case["expected"]]
            lines += ['', '证据：' + '；'.join(case["evidence"]) + '。', '']
        outputs['cases/' + group['file']] = '\n'.join(lines)

    lines = ['# 覆盖索引', '',
             f'共 **{len(cases)} 条场景设计**；全部 NOT_RUN。以下为需求到用例的追溯，不是运行覆盖率。', '',
             '| 场景组 | 数量 | 入口 |', '| --- | ---: | --- |']
    for group in catalog['groups']:
        count = sum(c['group'] == group['id'] for c in cases)
        lines.append(f'| {group["title"]} | {count} | [{group["id"]}](cases/{group["file"]}) |')
    lines += ['', '优先级：' + '、'.join(f'{p}={n}' for p, n in sorted(Counter(c['priority'] for c in cases).items())) + '。', '',
              '## J01–J21 语义规则', '', '| 规则 | 场景 |', '| --- | --- |']
    for i in range(1, 22):
        rule = f'J{i:02}'
        lines.append(f'| [{rule}](../json/SEMANTICS.md) | ' + '、'.join(case_link(c) for c in cases if rule in c['semantic_rules']) + ' |')
    lines += ['', '## 状态机及服务接线', '',
              '每个模块都有场景映射；另外逐边执行 [转换矩阵](TRANSITIONS.md)。模块映射并不表示这些场景穷尽该模块所有分支。', '',
              '| 模块 | 转换数 | 场景入口 |', '| --- | ---: | --- |']
    for name, machine in machines.items():
        lines.append(f'| [{name}](../state_machine/{name}.md) | {len(machine["transitions"])} | ' + '、'.join(case_link(c) for c in cases if name in c['modules']) + ' |')
    lines += ['', '## BrainStorm 追溯', '', '| 章节 | 场景 |', '| --- | --- |']
    for section in sorted({s for c in cases for s in c['baseline_sections']}, key=lambda s: tuple(map(int, s.split('.')))):
        lines.append(f'| {section} | ' + '、'.join(case_link(c) for c in cases if section in c['baseline_sections']) + ' |')
    lines += ['', '1 为结构图、6 为后续阶段说明，通过全链场景和能力清单审查；细分小节由对应父节与具体用例步骤承接。', '',
              '## 契约形状与运行语义', '',
              '以下根契约均套用 SYS-010/011 的逐字段边界。嵌套 `$defs` 同样遍历；引用/来源/权限/时间等运行语义另外由 J 映射场景验证。示例不是完整有效运行数据。', '',
              '| 契约 | 形状示例 | 测试设计 |', '| --- | --- | --- |']
    for contract in contracts:
        lines.append(f'| {contract} | [示例](../json/examples/valid/{contract}.json) | [SYS-010/011](cases/08-resilience.md#sys-010) |')
    lines += ['', 'World Model 主张投影的 ACTIVE/SUPPORTING/CONTESTED/SUPERSEDED/RETRACTED 另由 WLD-003/004/005 验证；它们不属于 14 组控制状态机。', '',
              '## 已有代码参考', '',
              '仅标出后续接线位置，不继承历史 PASS，不声称本次已执行。', '']
    paths = ['demo_pi/pi_secretary/test/runtime.test.ts', 'demo_pi/pi_secretary/test/world.test.ts']
    lines += [f'- [{p}](../{p})' for p in paths]
    outputs['COVERAGE.md'] = '\n'.join(lines) + '\n'

    # Each row carries canonical guard/commit semantics. These are obligations,
    # not fake runnable tests which merely check membership in the graph.
    obligations = []
    for name, machine in machines.items():
        related = [c['id'] for c in cases if name in c['modules']]
        for transition in machine['transitions']:
            obligations.append(dict(id='TR-' + transition['id'], machine=name,
                                    transition=transition, related_cases=related,
                                    subcases={k: 'NOT_RUN' for k in ('positive', 'guard_negative', 'commit_failure_recovery', 'redelivery')}))
    outputs['transition-obligations.json'] = json.dumps(dict(schema_version=1,kind='TEST_DESIGN_OBLIGATIONS',obligations=obligations),ensure_ascii=False,indent=2) + '\n'
    lines = ['# 状态转换测试矩阵', '',
             f'从 canonical catalog 生成 **{len(machines)} 组状态机、{len(obligations)} 条转换、{4 * len(obligations)} 个基础子项义务**。尚未实现应用测试驱动，全部 NOT_RUN；多条件守卫逐条件反例会进一步增加执行数。', '',
             '每行均执行以下四项，具体准备使用 [场景用例](COVERAGE.md) 与 [守卫定义](../state_machine/GUARDS.md)：', '',
             '1. positive：通过合法入口建立 from，满足 guard，发送 event，确认 to 及 commit 的领域内容已可靠保存，独立核对副作用。',
             '2. guard_negative：除被破坏的一个 guard 条件外均有效；发送同 event，不得非法提交本边。故障本身允许驱动其他明确的失败边，必须记录，不把失败诊断当违规。',
             '3. commit_failure_recovery：提交前/后注入相应故障，新进程重开；恢复到可靠前态或后态，未知作用保留，不半提交或重放动作。纯读/无新提交子项说明 N/A 原因。',
             '4. redelivery：同事件身份重复交付；命令返回旧回执或明确拒绝过时事件，定时/内部事件按对应去重键处理；不重复外部作用或非法迁移。', '',
             '同状态自环也必须检验 revision/事件/实际作用；纯状态值相同不是通过。未实现 fixture/入口/故障钩子的行记 BLOCKED_CAPABILITY，不因为图中有这条边就记 PASS。', '',
             '| 义务 ID | from → event → to | guard | 正向提交内容 |', '| --- | --- | --- | --- |']
    for item in obligations:
        t=item['transition']
        lines.append(f'| {item["id"]} | {t["from"]} → {t["event"]} → {t["to"]} | `{t["guard"]}` | {t["commit"].replace("|", "/")} |')
    outputs['TRANSITIONS.md'] = '\n'.join(lines) + '\n'
    return outputs


def main():
    outputs = render()
    for name, content in outputs.items():
        (TEST / name).write_text(content, encoding='utf-8')
    print(f'Rendered {len(outputs)} design files; no runtime tests executed.')


if __name__ == '__main__':
    main()
