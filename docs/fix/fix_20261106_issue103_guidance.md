# Issue #103：持久执行引导实施计划

当前阶段：Master 已明确批准实施，正在按 R5 合同构建与验证；下文“仅计划／尚未实施”属于前期复核历史，不代表当前授权。合并仍需独立授权。实施证据见[验收记录](evidence/issue103-guidance/acceptance.md)。

状态：Claude Opus 5.5 Extra 第五轮 **PASS**，2026-11-06 19:00 HKT 读取；已落实 Master 产品裁定，尚未实施。[英文完整版本](fix_20261106_issue103_guidance.en.md)。

- 仓库：https://github.com/ExplodeCode6324/Secretary
- 目标：https://github.com/ExplodeCode6324/Secretary/issues/103
- 基线：`main@f22e85f01e2f8704c0b2e61ee5fb8504a5e6d7c2`，2026-11-06 与远端核对一致。PR #102 已合并 #84 成果，最终审计及合并后 CI 记录于 PR；#84 仍为行政上的 open，本计划不代关、不改写保留的原生验收边界。Master 已明确领取 #103 并要求计划。
- 本轮只做计划与复核，不修改产品代码、schema、测试，不调用真实模型验收、不部署、不合并。英文复核使用已打开的 Claude Opus 5.5 Extra，同一会话往返；原件放 Git 忽略的 `.demo-data/issue103/review/`。

## 1. 用户结果和现有接点

Master 或 Main 可以向明确、未结束的 AGENT Execution 发送引导。Core 先持久受理，再交付，分开保存已发送／已接收／已引导；旧工具计划和恢复的旧响应不能绕过新指令。引导可在原任务及既有权限内调整做法，但不批准操作、不回答待决问题、不扩权、不新建执行。

例如：写操作正在等待授权时，Master 发“先检查日志，暂时不要写”。此时引导可以持久达到 SENT，授权仍待决定。即使随后批准，旧写操作也须先让包含引导的新模型请求处理。授权获批本身不推翻新限制：过时的已批准操作退役，执行器重新规划，替代操作重新走普通授权。如果 Master 拒绝/撤销，则保留现有 FAILED 行为，引导按真实拒绝原因结清为 UNPROCESSED；一直不决定则继续等待。本项不引入“拒绝后继续”或自动撤回待授权请求。

| 接点 | 现状与修改方向 |
| --- | --- |
| `application-service.ts`、`api/routes.ts`、`main-loop.ts` | 已有请求指纹和同步 `Store.withAdmission`；复用同一 journal 事务绑定 ApiCommand 与业务受理。拆出 Input 准备，避免普通 Master Input 的恢复副作用。 |
| `main-tools.ts`、`main-loop.ts` | 为 task_control 增加 guide，来源绑定真实 Main loop、tool invocation 和持久响应，不相信模型自报身份。 |
| `execution-runner.ts` | resumeAuth 在 Agent 创建前执行 AUTHORIZED 写入/shell，必须提前处理新引导；绑定执行尝试和响应来源，保留 checkpoint。 |
| `transport.ts` | 恢复会替换为冻结请求，可能重播 RESPONSE_SAVED；新引导不改旧请求、预算、logical key 和响应，证据来自真正持久请求。 |
| `executor-tools.ts`、`effects.ts` | 增加结构化采用回执；旧工具开始前及真正副作用启动前检查；成功门禁放入领域 finish，不只挡工具封装。 |
| 固定 Pi Agent | 复用 steer、prepareRequest、beforeToolCall、finishTurn 和顺序工具；beforeToolCall 可返回不终止循环的阻断结果。不修改/升级 Pi，不重写循环。 |
| `store.ts`、`sync-service.ts`、任务查询 | 增加窄范围可重建索引、有界查询与公共投影，前端不能用 preview 推断回执。 |

## 2. 合同、身份与原子受理

新增小型共享 `guidance.ts` 领域服务，两个入口共用。

- Master：拟定 `POST /api/v1/executions/:id/guidance`，请求 `{request_id, task_id, text}`，要求准确执行和任务 ID。认证决定 MASTER；正文不能设置来源、时间、回执或模型调用身份。Main：`task_control(action=guide, id=execution_id, task_id, text)`，可信工具宿主导出 MAIN、session/loop/ModelCall/tool-call 来源。
- Guidance 保存稳定 ID、不可变原文对象及散列/UTF-8 长度、Task/Execution/Session、来源与真实引用、请求身份/指纹、执行内受理顺序和 revision。Master 引用真实认证命令与配对 Input；Main 引用真实调用上下文，不能伪造 Master 原话。
- 同 ID 同载荷返回原对象，即使执行之后已结束；改正文/目标/来源或跨命令占用身份报 REQUEST_CONFLICT。先判断原请求身份，再检查当前状态。Main 恢复也按原 loop/tool 身份去重。
- 一次同步 journal 事务提交 Guidance、Master 知情 Input 和命令绑定。Input 带原文、结构化 guidance_id、精确目标及“已受理，勿重复投递”。直接准备 Input，不让普通 accept() 清除 RECOVERY_BLOCKED 或恢复 Main；Main 设置暂停/模型不可用不能阻止引导受理与投递。Main 自己发起时不额外创建知情 Input。
- 查询：`GET /api/v1/guidance/:id`、`GET /api/v1/executions/:id/guidance?cursor=&limit=` 和既有原请求回执查询。默认 20、最多 100，按受理顺序与稳定 ID 分页。可查 MASTER/MAIN 来源、完整原文的有界详情、阶段、证据、处置/结束原因和 revision。增加 sync 映射/失效通知和任务历史条目，不产生普通 PROGRESS Feedback。
- **Master 已批准的硬性受理上限：** 每条最多 16,384 UTF-8 字节，每 Execution 最多受理 64 条、原文总计 65,536 字节。超限在受理前明确拒绝，不 trim、不截断、不把仅引用指针说成模型已消费。该界限约束有效引导集合，与无关历史无关；仍执行完整模型请求预算检查。范围内长文本/多行原样保留，#103 不新建大文件/附件系统。超限不允许发送：Core 在同一受理边界拒绝，不能创建 Guidance 或知情 Input，不截断、拆条、自动重试或部分接收。#106 客户端阻止已知超限提交并保留草稿；数量/总量并发仍以 Core 校验为准。

## 3. 状态与三阶段回执

按不可变有效 executor、真实归属和当前 Execution 检查。已有 AGENT Execution 的 CREATED、WAIT_PRECONDITION、READY、DISPATCHING、RUNNING、WAIT_AUTH、WAIT_DECISION 均可受理；只有排队请求、尚无 Execution 时不能投递。引导不解开暂停/归档 Scope。RESULT_UNKNOWN 可持久等待，标明 UNKNOWN_EFFECT，但不恢复或重放未知效果；既有对账若结束执行，结清为未处理。CANCEL_REQUESTED 或 cancel_requested=true 拒绝新引导；SUCCEEDED/FAILED/CANCELLED/EXPIRED 明确拒绝；PROGRAM 不支持。不得转投 Main、latest 或下一轮。

拟定错误：GUIDANCE_EMPTY、GUIDANCE_TOO_LARGE、GUIDANCE_LIMIT_REACHED、TARGET_NOT_FOUND、TARGET_MISMATCH、TARGET_ENDED、TARGET_CANCELLING、GUIDANCE_UNSUPPORTED_EXECUTOR，以及既有 REQUEST_CONFLICT。等待原因可查，不误报发送失败。

阶段是独立里程碑，处理结论是另一维度：

| 阶段 | 所需证据 |
| --- | --- |
| SENT 已发送 | Guidance 已受理事务和服务端时间；只有 HTTP 请求发出仍为客户端“结果待确认”。 |
| RECEIVED 已接收 | 宿主注入的准确 ID/散列/正文已进入 Agent 的持久上下文/checkpoint，绑定 execution/attempt。复用 message_end checkpoint 接点，并先核实 checkpoint 确实包含刚发出的消息，再记接收。取消独立 inbox 记录；steer 返回不够。等待态/尚无 Agent 时为 SENT 加等待原因。首个时间不变，重投追加证据。 |
| GUIDED 已引导 | 成功持久 ModelCall 的真实请求包含宿主注入的完整引导，同一持久响应含合法 ADOPTED 结构化回执，关联请求、响应、工具调用与受理证据。 |

处理结果为 PENDING、ADOPTED、CONFLICT、CANNOT_APPLY、UNPROCESSED；只有 ADOPTED 推进 GUIDED。后来冲突不抹掉历史 GUIDED，但改变当前有效结论并阻止成功，直至解决。结束原因包括取消、失败、过期、目标结束、未知效果收束、容量与强制消费失败。保留原文，追加证据事件；当前投影有界，不在每次记录中不断扩大历史数组。

## 4. 模型证据与有效要求

- Executor 增加 `guidance_receipt`，有界批量参数为 guidance_id、outcome、explanation、effective_requirements、conflicts_with、resolution_refs，随正常任务响应产生；不为单条回执专门调用模型。模型不能指定权威 ModelCall/attempt/source。
- 宿主把工具调用绑定到含其准确 tool ID/name/arguments 的持久响应和对应 ModelCall 真实请求，核对 execution、接收证据、可信注入 envelope 的 ID/散列/完整正文及幂等身份。onPrepared 不是采用；普通文字提到 ID、伪造工具 ID、checkpoint、message_end、preview 均不够。旧响应只能重现其旧请求中已有引导的回执。
- 工具排列顺序不代表是否处理：在成功/副作用门禁前，检查同一完整持久响应任意位置的 guidance_receipt，以实际生成请求和宿主来源校验。普通回执执行与整响应校验共用同一验证器，矛盾/非法回执不能伪造采用。排在 submit_result 或 write/bash 后面的合法回执仍有效。先准备回执变更，在领域成功边界与结果/结清原子提交；副作用则先提交合法回执，再检查当前引导/冲突并 dispatch。后续真实执行或重播回执工具均幂等。未解决冲突进入明确等待并挡住成功/副作用；同响应成功在前、ADOPTED 回执在后不能误判失败。
- 每份当前上下文仅保留一份引导原文：dispatch packet 带恢复上下文尚无的引导，运行中用可信 steer 消息。取消每请求重复注入的完整有效要求包，也不逐轮追加正文提醒。原 Master 引导和回执结论继续留在上下文，本项不新增 Task 历史截断/压缩；容量不足真实阻断。恢复先使用冻结请求，旧回合结束后仅补缺失 ID。transcript/checkpoint 证明接收，不证明模型消费，后者只依据持久 ModelCall 请求。去重识别宿主记录的注入位置/来源/散列，不能相信材料里的类似 JSON 或引用文字。通过 Prompt 与结构化 effective_requirements/冲突回执表达优先级，不用模型摘要替换原文。
- Prompt 要求执行器对照所有有效 Master 限制处理冲突，允许 Master 后续明确纠正，不能把 Main 当同等权威。采用回执要说明最终有效要求，不只确认读过最新 ID。宿主检查来源和证据，不能机械证明任意自然语言语义合规；GUIDED 是可归因的采用声明，行为另验。
- 已知 CONFLICT/CANNOT_APPLY 阻止成功及新冲突副作用；必须进入明确 WAIT_DECISION，创建一次去重 DecisionRequest 与协调事件；涉及 Master 限制时由宿主要求 MASTER 回答，否则走普通问题路径，不能让模型不断尝试成功直到 MODEL_CALL_LIMIT。后续回执必须引用本执行真实的新引导/已回答问题才能解决；改变 Master 明确限制只能凭新的 MASTER 引导或 MASTER 回答，不能凭 Main 回答。保留原结论与解决引用，已读不能解决冲突。Main 可澄清自己的建议，但不能推翻 Master。
- DecisionRequest 兼容增加可选 `required_answerer=MASTER` 和引导冲突引用；涉及 Master 限制时由宿主设置，缺省保留普通问题行为。在共享领域 answer() 中、任何 ANSWERED/READY 提交前强制检查 API/Main/恢复入口，Main 尝试返回 DECISION_MASTER_REQUIRED；模型不能降级。公共 decision/attention DTO 暴露该字段，#103 在既有问题/事项呈现中窄范围显示“须由 Master 回答”，不提前实现 #106 的 /guide 界面。Main 可以协调但不能解除此等待，后续引导也不会自动回答 WAIT_DECISION。
- Main Prompt 解释 guide 与 continue/cancel 的区别、仅本 Execution 生效、知情副本不重投/无须逐条回复。TaskResult detail 与既有 RESULT Feedback 附有界引导结论/引用摘要。续接材料中的历史引导只是来源，不自动成为新执行的活跃指令；不跨轮自动继承、不修改 TaskPlan。

## 5. 投递、旧工具和恢复

1. 持久受理即进入可靠引导队列，投递是必须履行的义务，不是尽力而为。API 与 Main 入口都在同一受理调用中、受理提交后立即同步调用合格运行中 Agent 的 steer，返回/await 前完成，不能延到 scheduler pump。等待或恢复暂存遵循独立阶段规则；提交后 steer 前崩溃则从持久队列补交。保留按 execution 的 active/pending 索引并从 journal 重建。RECEIVED 只保留历史接收事实；当前 attempt 是否需要交付，独立核对其真实请求/上下文来源，不能把历史接收当作当前模型消费。
2. 明确三种交付路径，设置 `steeringMode: "all"`：
   - 新派发或没有 recovery_call_id 的普通恢复：将保存上下文缺少的引导放入既有 dispatch packet，与 Operation 和回答证据并列，不再重复 steer。
   - 正常运行 Agent：每条新引导只入 steer 一次。在 Pi 构造下一个新请求的 steering poll 之前冻结受理序列快照：首个非冻结恢复派发，在创建 dispatch packet/调用 prompt 前同步截取；后续回合在 finishTurn 内、释放暂存指令并允许 Pi poll 前截取。这早于 message emit/prepareRequest 的 await，不能假设其他 Agent 的就绪微任务不会插入。prepareRequest 核对覆盖，发送前再核对真实请求；将固定快照作为元数据与该 logical key 首个 PREPARED ModelCall 一起提交，重试/重启继承而非重取。恢复首个冻结调用不套当前队列检查，使用原快照；旧记录以实际冻结请求界定覆盖，随后 finishTurn 才建立下一新回合快照。该边界前已受理且仍适用的指令必须以可信原文进入本次新请求，不重复追加完整正文包。快照只定义必须包含的最小集合，不决定模型实际是否看到稍晚到达的指令；快照后、poll 前到达的指导可能已经进入本次请求。逐条按实际持久请求是否包含来判定：已包含则走普通采用/副作用检查，缺少合法处理结论的成功尝试立即失败；只有未包含时才非终止挡住旧工具/成功，并必须进入下一合格新回合。恢复和重试不能向后挪快照或删除消费义务；冻结调用恢复仍走下述独立路径，不能证明消费新引导。
   - 冻结调用恢复：在恢复的响应及工具结果完成之前，新引导留在 Pi 队列和上下文之外。暴露 Agent 前设置恢复阶段标记，此阶段的新受理只持久保存；禁止在 agent.continue() 之前、初次 steering poll 或 prepareRequest 中 steer。finishTurn 在旧响应/工具批次已追加后，按序释放引导；执行仍可运行才继续。纯文本旧响应也须允许这个新回合；如果进入 WAIT_AUTH/WAIT_DECISION/UNKNOWN/终态，则保留到相应允许边界。error/abort 仍按 Pi 的硬退出处理，真实失败并结清未处理项。
   - 即使引导暂存在上下文外，旧工具门禁仍核对全部新受理指令；transcript 不能把新指令放在未见过它的旧响应之前。冻结请求/预算/logical key/响应不变，采用只看持久请求而非表面消息顺序。
3. 工具批次绑定真实 ModelCall 快照。每个工具前拒绝不含新受理引导的旧计划，以不终止循环的 GUIDANCE_PENDING 返回，待队列消费后重新规划。包含引导的新请求可以执行合法回执、必要读取和提问；新副作用须已有有效采用且无未解决适用冲突。FAILED 提交、取消、过期允许未采用即结清，避免全工具死锁。
4. 异步准备后在真正副作用起点再检查：文件写入 dispatch/start 前，shell launcher 的 start barrier 前。最后同步检查与 start/commit 确立受理先后；已启动动作不能追溯撤销。给未完成 Operation 保存请求来源，旧记录保守处理。保留未知效果、进程停止、授权及资源版本检查。shell barrier 被新引导阻挡时请求 STOP，复用既有明确 not_started→NOT_APPLIED 路径，等实际未启动/进程停止证据后区分“引导延后”与取消，再规划；缺少未启动证明仍为 UNKNOWN。文件写在 auth.dispatch/start 前最后检查，不能事后声称阻止。
5. WAIT_AUTH 保留 issue 的等待语义，不自动撤回：
   - 授权 PENDING 时，引导为 SENT/held，Operation/授权继续 pending，Execution 仍 WAIT_AUTH；引导不批准、不拒绝、不设 READY。
   - 真正拒绝/撤销仍走现有 CANCELLED_OPERATION_ON_RESUME，Execution FAILED，保留决定证据并结清未处理引导。不能改成 supersession 原因或被恢复忽略。用户始终可以取消；“拒绝后继续工作”不在本项。
   - 合法批准解除等待后，在任何 apply 之前检查全部从未启动的 AUTHORIZED Operation，并在恢复循环内每一个操作边界、write/shell 的 auth.dispatch 紧前同步重查。引导可能在等待上一操作完成时提交；命中则用既有 AUTHORIZED→CANCELLED 转移退役当前及其余过时且从未启动的已批准操作，保存不可变 SUPERSEDED_BY_GUIDANCE 来源和宿主证明的未派发证据，停止 apply 并转入再规划。向恢复调用方返回明确的引导延后结果，绝不抛入 dispatch 的 FAILED catch，也不把循环前检查当成后续放行凭据。只有异步 shell launch 窗口中新到引导，使用第 4 条单独的 not_started→NOT_APPLIED 路径。取消恢复分支仅忽略有宿主证据的此类退役；真实拒绝/撤销/规则失败仍正常失败，不新增 Operation 状态。旧 grant 可审计，但 CANCELLED Operation 无法 dispatch。
   - 新 Agent/恢复回合同时带旧操作/批准证据和引导，再规划。不复用批准，即使重新提出完全相同参数也作为新 Operation 走普通授权（含已有适用规则）。不得为重播旧响应伪造新 tool intent，旧 intent 重试只返回原退役操作。全部过时且未启动的已批准操作使用同一规则；真实包含当前引导的新请求产生的操作走正常采用/副作用门禁。
   - 既有授权/事项详情窄范围提示：有更新引导时，批准会退役过时操作并再规划，而非执行该操作；拒绝仍失败。公共投影将派发前取消和有证明的 launcher-window NOT_APPLIED 统一呈现为“被引导退役”，底层证据保持区分。此项属于 #103 的必要提示，不提前做 #106 命令界面。
   - 不能因没有 receipt 就把 DISPATCHED/UNKNOWN 当成从未启动；shell barrier 只用其单独的实测 not_started 路径。无新引导时保留原行为。
6. WAIT_DECISION：持久接收但不回答、不设 READY；合法回答后同时带入回答与引导。RESULT_UNKNOWN 保持等待既有对账，不自动重放。取消优先。
7. 成功与受理的顺序：`finish(SUCCEEDED)` 最后同步检查当前受理序列、全部有效结论、取消状态，与结果/引导结清一起 journal 提交。先受理则旧成功拒绝；先成功则新引导拒绝。任何 await 的产物/副作用准备后重新检查，不能检查和提交分离。
8. 失败/取消/过期与未完成引导原子结清，保留历史 RECEIVED/GUIDED 和未知效果规则；包括 Agent 已无 submit_result 而结束循环、此时新引导才受理/steer 的竞态：MISSING_STRUCTURED_RESULT 的 FAILED 提交必须同时把它结清为 UNPROCESSED。恢复补齐旧/中断终态结清，不复活取消工作。
9. **Master 确认：强制消费，取消三次容忍和拒绝计数。** 已受理引导必须进入上述固定准备快照定义的下一次允许的新请求。核对实际持久请求覆盖；仅 steer/checkpoint/PREPARED 不代表模型已成功消费。不得发送漏掉本边界应消费指令的新请求；宿主无法满足该不变量时以 GUIDANCE_NOT_PROCESSED 失败，保留遗漏 ID 和根因，并服从进程/未知效果安全。相同冻结调用的正常 provider 重试仍保留消费义务与既有重试规则，不能借重试遗漏指导。
   - 包含指导的成功模型调用可以先做必要读取，在仍包含原指导的后续正常响应中提交合法结构化处理结论。Master 已明确选择完成边界，不要求首个新响应就给结论；不额外安排专门确认模型调用。
   - submit_result(SUCCEEDED) 尝试结束时，若其生成请求已包含某条指导，但经过整响应回执校验（含同响应后面的回执）仍无合法持久处理结论，立即 GUIDANCE_NOT_PROCESSED 失败，同事务结清未完成项，去重报告一次。没有三次计数、清零或宽限重试。逐条判定：新到指导不能掩盖旧的已包含但未处理指导。
   - 未见新指导的旧在途/冻结响应，以非终止 GUIDANCE_PENDING 挡住，允许下一个合格新回合消费；不能成功，也不因为生成时间早于受理就自动失败。快照后新到的指令也看实际请求覆盖，而非只看快照；若已被后续 poll 带入本次请求，成功时未处理就立即失败。最终领域成功门禁仍重查所有受理/处理证据后才提交。
   - 合法 CONFLICT/CANNOT_APPLY 是处理结论，但不是 GUIDED 或成功；继续走明确协调/Master 问题路径，未解决前不能成功。已读标记不算处理结论。
   - 合法授权等待仍等待；主动取消仍 CANCELLED，过期仍 EXPIRED，并真实结清 UNPROCESSED。不能为消费而取消后又调用模型，也不把取消改成失败。provider/容量/MODEL_CALL_LIMIT 失败保留原始主因，同时显式结清全部未处理义务。未知效果保留 RESULT_UNKNOWN/进程安全到对账，不能掩盖或重放。队列项不能消失，更不能在未处理时让执行成功结束。
   - 保留每 dispatch 20 次模型调用及既有有界 provider 重试，补临界到达测试；不新增超时、无限 steer 或放宽容量。失败保留原文，不伪造 GUIDED。

## 6. 实施顺序与验证

内部源合同修改 `src/contracts/contracts.schema.json`，必要时更新状态目录，兼容增加 Operation 退役来源、DecisionRequest.required_answerer 和结果/ModelCall 证据，复用既有 Operation 状态。无引导的旧记录行为不变；旧待执行操作遇到新引导视作旧计划。公共合同从 `docs/api/v1/schema.json`、`operations.json` 生成；复用脚本生成 types、API/OpenAPI、docs，不手改生成文件。

建立按执行的 active/pending Guidance 索引、来源请求索引和稳定分页历史。热路径不全扫历史/过去 ModelCall；证据追加、当前投影有界。固定工作量增加无关历史，观测查询成本。不扩成 #70 全仓治理。

批准后的顺序：（1）schema/领域/原子 API 与 Main 入口；（2）结构化回执及可信上下文/响应绑定；（3）恢复、WAIT_AUTH/问题、副作用/成功门禁与终态收束；（4）查询/sync、Prompt、正式运行/API 文档；（5）定向回归、完整验证、受控真实模型及精确提交复核。拆分提交不意味着可遗漏恢复交付。

确定性测试复用真实 Store/App/HTTP 和脚本模型：

- API/Main 同入口、来源伪造拒绝、Unicode/多行逐字与硬限额（拒绝时 Guidance/Input 均零写入）、跨命令身份、目标结束后原请求查询、改参拒绝；单事务前后故障；Main 暂停/设置/模型不可用时，独立运行 Task 的 SENT→RECEIVED 能推进；无 Agent 的等待 Task 仍为 SENT 加等待原因。
- steer/checkpoint/纯文本/旧响应不能 GUIDED；真实请求+匹配持久结构化响应才可推进；重复回执/恢复稳定，别的调用/执行不能伪造；普通阶段无额外 Main Input。覆盖 [submit_result, guidance_receipt(ADOPTED)]、[write/bash, guidance_receipt(ADOPTED)] 排序，非法/矛盾回执及重播/崩溃原子性；合法 CONFLICT/CANNOT_APPLY 进入去重明确等待。
- 受理后、内存投递后、持久接收未发新请求、响应保存未提交回执、回执提交未存 checkpoint、终态提交未发反馈等断点恢复，分别检查历史接收和当前上下文覆盖。
- PREPARED/IN_FLIGHT/RESPONSE_SAVED 冻结请求/响应不变，新引导进入新请求，旧 submit_result 被挡；多条引导、乱序/重复尝试、Main 与 Master 冲突及重启。
- 顺序工具间插入引导、shell 准备/启动竞态；WAIT_AUTH 批准前后引导、改参重新检查、旧写不执行、真实拒绝仍失败、获批旧操作退役且批准不复用，只有真正宿主退役可绕过取消失败；等待恢复循环首个已批准效果时插入引导，分别检查后续 write/shell 在 dispatch 前退役、不启动旧效果且不误判执行失败；WAIT_DECISION 不解锁，MAIN 不能回答 MASTER 专属问题，UNKNOWN 不重放，全部状态与不可变有效 PROGRAM 拒绝。
- 成功/受理双向竞态、Agent 循环结束后到 MISSING_STRUCTURED_RESULT 失败前的新引导原子 UNPROCESSED 结清、取消/过期、不复活、冲突解决来源、跨重启/重试/多条队列的下一允许新请求完整覆盖、遗漏应消费指令时不发 provider 并明确失败、API/Main 同步受理后 steer/中间崩溃/其他就绪微任务在 poll 到 message_end/prepareRequest 之间插入受理不得误判失败或丢失下一回合义务、PREPARED 快照跨重试恢复固定、快照后/poll 前到达且实际入请求的指导不走旧请求阻断（普通采用/副作用检查仍保留），成功时未处理立即失败、包含却未处理时首个成功尝试立即失败、旧在途成功先阻挡再给消费回合、允许先必要读取后续正常响应给结论、合法冲突走协调且无拒绝计数、20 次调用上限临界到达保留 MODEL_CALL_LIMIT、容量原文/结论真实、结果摘要包含引导。
- 窄索引/分页及固定可见工作量增长测试；相关 #93 失败/取消/恢复、#84 记忆、授权、进程/效果、任务历史/sync 回归；不重跑无关真实验收。

运行定向测试、`npm run verify`、生成一致性和精确候选 Linux/macOS CI。保留首次失败、源散列、真实请求/响应与调用账本。在新隔离真实模型任务中中途加入限制，逐项核对三阶段证据和后续行为，并检查 Main 不可用时直投；保留用量、配置和首败。本轮计划不调用 provider。真实 TUI /guide 验收属于 #106；源码复核、fixture、真实模型行为、Master 产品决定分别记录。本阶段实施/测试/真实模型/原生门槛均为 NOT_RUN。

## 7. 顺推至 #106（路线推演，不是实施授权）

- **#103**：精确 execution_id 投递、可信来源、持久回执与恢复；只建立统一后端，不解析标题、不做流式界面、不换框架。
- **#104**：Task transport observe 生成有界瞬态 preview，以 Task/Execution/ModelCall/attempt 归属，最终合入持久消息。明确开启跟随，主动阅读停止，可取得超过 50 条后的真正最新窗口。普通进展与正常引导回执不唤醒 Main；WAIT_AUTH 按 authorization_id、其他控制事件按真实身份去重，共用 #103 的稳定 Feedback-ID 约定。preview 不是消费证据。
- **#105**：原子分配稳定唯一 Task 标题和永久的 Task 内 execution_round，确定性持久回填；UUID 仍为真实身份。保留 Master 已定含空格/双引号与 `_1` 合同，不用“全部转下划线”删掉约定语法。共用 #103 的 TARGET_* 错误词汇，标题+轮次一次解析成准确 ID；复用固定 Pi 命中测试、稳定渲染 ID，完成最小点击/Esc，保留选择/锚点/草稿。
- **#106**：只在 Task 普通输入态执行 `/guide <task_name> <execution_round> <body>`，仅解析两个定位参数，其余展开正文在 #103 明示界限内逐字保留；冻结真实 IDs/request/body，响应丢失按原身份对账，展示后端阶段/原因。保留 Main/Task 草稿，不重投 latest。联调流式阅读、命名导航、权威回执及受控真实模型/macOS 终端。

最终路径示例：Master 打开一个具名 Task，阅读第 3 次执行的实时内容，发送“先分析，不要修改”；看到 SENT、RECEIVED，再看到关联真实采用调用的 GUIDED，核验后续行为及结果。断线后仍查同一目标和回执。普通流式/阶段变化不唤醒 Main；Master 原始指令使 Main 知情一次，冲突才明确升级协调。

建议先稳定 #103 合同，再让 #104、#105 分别基于该合同和最新 main 接线，独立复核；#106 依赖前三项，不造第二投递引擎。此后按实际使用迭代 TUI，只有 Master 明确确认 UI 稳定后进入 #70–#73；#74 数据驱动，Supervisor/Watchdog 和框架选择不纳入本批。

## 复核记录

2026-11-06 Master 解锁后，页面确认 R1 请求和回复已完成，显示约六小时前；此前未确认发送，准确提交时刻仍未核实。Claude 检查基线源码和固定 Pi 后返回 CHANGES_REQUIRED，未执行测试。R2 采纳明确恢复顺序、单份原文上下文、宿主强制 Master 专属回答、steeringMode=all、上下文接收证据、单一计数、调用上限及统一词汇。WAIT_AUTH 依 issue“引导不解除等待条件”保留 pending，不改真实拒绝的失败行为；仅在合法批准后、执行前退役过时未启动操作，再规划且不复用旧批准。将这个有依据的替代方案交回 reviewer，不静默采用自动撤回。实施仍须 Master 批准。

R2 认可上述 WAIT_AUTH 替代方案，仅因恢复循环中途到达引导的竞态返回 CHANGES_REQUIRED。R3 补齐每个操作前同步重查、非异常的恢复延后结果，同时采纳批准前提示、统一退役呈现与缺少结构化结果的终态竞态。未执行产品实施或验收。

R3 最终结论 **PASS**：按十分钟首次等待规则于 2026-11-06 18:18 HKT 读取，没有剩余具体计划阻断。reviewer 直接检查基线恢复/效果边界及固定上游 Pi 的 message_end 顺序，确认 Agent 先更新状态再等待 checkpoint 订阅者。该结论只代表源码/计划复核，不代表实现或行为验收。待 Master 批准的产品选择：WAIT_AUTH 语义及提示、单条/数量/累计文本上限、三次响应拒绝上限。实施复核重点：auth.prepare 时记录 Operation 与生成 ModelCall 的对应证据；引导延后必须继续 READY/dispatch，不能留在 DISPATCHING；取消失败只豁免宿主证明的引导退役。以上是已复核要求的落实检查点，不新增范围。

完整轮次与处置见[复核记录](evidence/issue103-guidance/plan-review.md)。尚未开始实施。

## Master 裁定 — R4

Master 同意 WAIT_AUTH 语义，要求超限直接不允许发送，将三次容忍改成“指导如果进入队列，则必须被消费，否则失败”。经澄清，Master 明确确认：已受理指导进入下一次允许的新模型请求；尝试成功结束时仍无有效处理结论则立即失败；等待授权继续等待，主动取消仍 CANCELLED。不要求首个新响应必须给处理结论。历史 R3 PASS 不覆盖该修订，实施前交回同一 reviewer 复核。

R4 返回 CHANGES_REQUIRED。R5 采纳同步受理后 steer、整响应回执校验、冲突明确等待及副作用前回执顺序无关。快照位置明确在 Pi steering poll 前（初始派发/finishTurn），与 PREPARED 原子保存，不依赖 reviewer 所述“await 回调间不会插入其他 Main/Task 就绪微任务”的宽泛假设。Master 的消费/失败边界不变。

R5 最终 **PASS**：按十分钟首次等待规则于 2026-11-06 19:00 HKT 读取。reviewer 纠正了 R4 的“不可插入微任务”假设，确认没有剩余具体阻断。采纳最后的非阻断澄清：快照决定必须包含的集合，实际持久请求是否包含决定逐条门禁；快照后但已入请求的指导不能获得旧响应宽限。中英文与对应竞态测试要求已同步明确。此为 reviewer 要求澄清的既定规则，不新增产品选择。产品代码、产品测试、真实模型/原生验收仍 NOT_RUN。
