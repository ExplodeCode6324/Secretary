总跟踪：#111。常规迭代，当前仅登记；对应完整 R5 计划 §5、§8–10。可独立实现，与 #112/#113 在同一最终版本做组合验收。

## 问题

未定义或未指定 Scope 也能执行任务，但用户不知道任务目录，容易误判文件丢失，与“未指定 Scope 落入 Shared”约定不一致。

## 预期行为

1. AGENT 和 PROGRAM 任务省略 scope_id 或显式 null 时，统一落到逻辑 Shared。Shared 是稳定的虚拟分组，保持 wire 上 scope_id=null；视图明确 kind/name，不凭空建一个普通 WorkScope 或改写历史 ID。
2. 显式给出不存在、退役或不可用 Scope 必须报错，不能静默降级 Shared。NONE 是明确的逻辑 Scope，与 Shared 区分；其任务仍使用独立目录。
3. 每个 Task 有稳定持久工作目录 `<data/core>/workspaces/<task_id>/work`，同一 Task 的后续 Execution 继续使用；多个 Shared Task 的同名文件互不覆盖。创建/使用遵循现有目录安全边界，不引入 Scope 级共用 workspace。
4. 任务详情/结果、API 投影和必要 Main 工具回执展示真实绝对路径及归属，注明这是 Core 所在主机路径；区分计划路径和已创建/核实目录，不把推算路径说成已存在。
5. 历史任务、工作目录、CAS/附件/产物引用保持不动；不为规范化移动或删除旧文件。历史目录缺失必须给明确可诊断错误，不能新建空目录冒充恢复。Shared 路由/查找/排序与现有 Task TUI 语义一致。

## 验收

- [ ] 无任何 Scope 的新域：AGENT 与 PROGRAM 各覆盖省略/null，均明确显示 Shared。
- [ ] 显式错误 Scope 不降级；显式 NONE、DIRECTORY 与 Shared 的行为分别验证。
- [ ] 两个 Shared Task 写同名不同内容文件，路径不同且结果正确；同 Task 接续读取原文件。
- [ ] Core 受控重启后 Task/路径/文件/产物引用仍一致；历史缺目录出现具体错误且不生成伪恢复目录。
- [ ] 新任务 planned 路径与实际 verified 路径呈现准确，远程客户端不会误以为路径在本机。
- [ ] 原生 TUI 与 API 数据、任务分组/详情/打开产物回归；保留首次失败与 NOT_TESTED。
- [ ] 常规隔离测试、required checks、构建后实际启动以及 #111 组合验收完成。

## 数据与范围

不新增清理/归档/目录搬迁，不重写历史，不使用敏捷实例数据做破坏性测试。本次是常规功能分支实现；持久敏捷实例的升级和 main 合并分别另行授权。
