# #121 真实记忆场景脱敏问卷（空白模板）

Master，可稍后填写，先提供 2–4 个您最在意的例子即可。可以只描述场景，不交原始对话；不知道的填“待定”，没有填写不视为同意。请把答案保存在私有位置或直接回复，**不要把填写后的个人内容提交到 Git**。本文件只保留空模板。

模型候选为 gpt6.1 sol、deepseek-flash、gpt 6 luna。数据交给我整理与允许外发是两件事：整理完成后，会列出具体脱敏内容及模型/评分端点供您决定；批准前不发送真实材料到 API/Claude。

## A. 先选重要问题（可多选）

- [ ] 忘记以前说过的偏好/事实，必须提醒才检索。
- [ ] 已纠正的信息又说回旧版；或旧但有效的限制被误删。
- [ ] 助手猜测被摘要反复引用，后来当成我的话。
- [ ] 久未提及、重启、恢复或信息多了以后失忆。
- [ ] 未做完的承诺丢失、任务虚假完成或恢复后重复动作。
- [ ] 把第三方文字当命令，忽略我的授权/拒绝或来源权威。
- [ ] 其他：________

最不可接受的一种失败：________
哪类小错误可以容忍、最多几次：________

## B. 每个场景复制一份（事实与答案分开）

1. 场景编号/标题（使用假名）：________
2. 这是亲历事件、根据亲历改编，还是纯假设：________
3. 背景/我的目标（1–3句）：________
4. 最早说过什么、何时说的（可用 D0/上午，无需真实日期）：________
5. 后来怎样纠正/补充/拒绝/授权（按 D1、D2 顺序）：________
6. 中间发生了哪些无关对话、任务、退出/重启（若记得）：________
7. 最后我会怎么问/要求行动，请写自然措辞：________
8. **应该记住的事实/限制/未完成承诺**：________
9. **正确答案/正确动作**（包含可接受的其他表述）：________
10. **绝不应该说/做的事**，例如用旧地址、声称已完成、未经批准写入：________
11. 哪些动作必须先问我，哪些可直接做：________
12. 如何客观确认成功（文件内容、效果次数、保持未完成等）：________
13. 当证据不够时，应该拒答、追问还是检索：________
14. 是否有原始材料？只填私有来源编号/范围，不填密钥或私密 URL：________
15. 这个场景/答案是否已被用于调试模型或看过失败后修订：________

## C. 替换与时间边界

- 可替换哪些姓名、单位、地点、项目、数值：________
- 哪些关系/先后顺序必须保留才能测对问题：________
- 日期可否平移成 D0/D1 或统一虚构日期；是否需保留周末/间隔/时区：________
- 不得使用的字段/第三方信息/主题：________
- 可供调试的场景编号：________
- 希望您保留答案、最后再交的独立场景编号：________

无需先提供所有答案。可先交 dev 场景；保留集应使用不同真实事件，不能只改姓名或换问法。已经参与调参的场景可以保留为回归，不冒称未见样本。

## D. 数据使用意向（仅询问，不预选授权）

- 是否只允许手工描述/受控衍生，禁止使用原文：________
- 是否允许整理后再由您逐项确认：________
- 拟允许的被测模型：Sol / DeepSeek Flash / Luna / 待定：________
- 拟允许的数据目的地：OpenAI `https://api.openai.com/v1` / DeepSeek `https://api.deepseek.com` / 待定：________
- 是否允许独立模型评分；若不允许则人工评分：________
- 如允许模型评分，具体模型/端点（可待方案列出后决定）：________
- 是否允许完整私有运行证据归档到您指定 NAS；保留期限、访问限制：________
- 可接受的费用上限及时间上限（可先不填）：________

最终授权单将引用您确认的具体数据版本/哈希、字段、端点、用途与保留方式。这里空白或“待定”的项目不会被当作许可；没有数据时 Track R 如实记为 NOT_TESTED，公共 P 和合成 S 的计划仍继续。

## English field guide

This is an empty redacted-scenario template, not consent to transmit personal data. Supply 2–4 priority examples when convenient, using aliases and relative dates. For each: origin (real/derived/hypothetical), goal, chronological source events and corrections, intervening tasks/restarts, natural final request, required facts/constraints/open obligations, acceptable answers/effects, forbidden effects, authorization boundaries, objective success checks, abstention behavior, private source reference and prior tuning exposure. State permitted substitutions, chronology constraints, exclusions and dev versus independently held-out episodes. Separately approve exact sanitized content/version, SUT and grader endpoints, fields, retention/NAS access and budget before dispatch. Keep completed answers private; never commit them or send them to the plan reviewer. Silence is not consent; absent R data is NOT_TESTED.
