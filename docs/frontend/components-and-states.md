# 组件与状态

[Current Frontend Spec](README.md) · [Visual source map](phaseui-design.md)

显示状态与业务状态正交：stable/hover/pressed/focus/disabled 描述交互；idle/pending/succeeded/failed/offline/stale 描述业务。只应用组件需要的状态。pending 保留阅读和导航；真实成功来自回执/业务对象，不能由动效结束推断。offline/stale 保留可读缓存并标明状态，不伪装新鲜数据。

## 组件行为

**目录项与图标。** 使用原生链接/按钮，aria-current 表示当前页。hover/focus 触发同次三帧，pressed 立即反馈、释放延续该次效果；点击只执行一次。selected 是持续的底色与接边状态，不能等动画结束才选中。每种图标固定源几何，裁片来自本体；辅助路径不能当常显图标。

**输入与发送。** 原生 textarea 保持 DOM、选择、光标及候选位置稳定；聚焦时单一外边框为2px蓝色，不叠加内部轮廓。聚焦/提交时仅重构该边框的局部短段，140ms三帧；键入和光标点击不重播。Cmd+Enter 或发送按钮立即进入持久发送流程，Enter 换行，IME期间不发送。发送方块160ms三帧、箭头420ms。输入框下方独立一行 aria-live 提示本机入队，Core接收结果看待处理命令记录；人工数据明确标注模拟队列。保存/入队失败保留草稿，在上方错误区显示并清空等待提示；视觉复位不等于发送成功。disabled不播放故障。

**任务行。** 任务名称/目标、状态、更新时间、展开操作构成表格行；展开在同一表格插入详情，aria-expanded 同步，收起保留该行焦点。loading/pending、失败、空列表用明确文字；任务状态和 Execution/审批状态分别读取，不从人工示例推导状态机。取消任务或执行是独立业务命令，不与取消动画混用。

**产物行与弹层。** 默认文件名入口加类型/时间/来源，降低外框与独立底色；对照卡片只在诊断画廊。真实保存走原生对话框与完整性校验，区分保存中、取消、失败、完成。弹层使用原生 dialog 或等效焦点管理：打开定位焦点、Tab 留在弹层、Escape 关闭、回到触发控件；危险操作需要明确确认，装饰不改变授权状态。

**头像、分隔线与左栏扩展。** Master/助手头像均使用180ms三帧；不改变头像语义。结构分隔线随机触发且全页最多一处，随机未命中即不播放。#62 画廊额外试验左栏文字和按钮间已有分隔线：仅改变临时显示层，不增无用横线，不移动字排或命中范围；与基础三帧对照后交 Master 评估。

[conversation / tasks / artifacts](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/prototype.js#L268) · [dialog](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/prototype.js#L355) · [identity](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/signal-motion.js#L537) · [interaction gallery](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/prototype.js#L334)

## 中断与降级

每控件最多一个效果记录，新操作替换旧效果，同次接触不重复启动。移出、拖离取消、失焦、禁用、卸载或关闭动效时恢复源显示并清理 animation、timer 与临时节点；分隔线还在滚动/尺寸变化时清理。临时层 pointer-events:none、aria-hidden，不重复朗读。

reduced-motion、减弱、关闭和线稿模式不播放故障，也不补播积压事件；选中、焦点、禁用、成功/失败仍清楚。测试冻结第一/二/三帧只验证几何，关闭冻结后必须检查自然播放、快速打断和恢复。稳定显示不限制勾选、展开方向或真实数值变化。

[controller / cleanup](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/signal-motion.js#L312) · [event entries](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/signal-motion.js#L822) · [lifecycle tests](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/tests/signal-motion.test.cjs) · [acceptance matrix](acceptance.md)

## 主对话与统一时间线（FE-04）

思考默认开启，思考正文和工具调用详情默认折叠，可展开查看；折叠时仅显示摘要。关闭思考会立即清除其展示与内存缓存，按数据域保存显示偏好。

历史支持双向翻页、消息或事件 ID 定位和已加载窗口搜索；最多驻留 3 页、150 行，正文与思考共 8 MiB，单条续读最多 2 MiB。只有已在尾部且没有文本选择时才跟随；发送不会强制跳转，可主动选择“转到最新消息”。

长回复完成时保留此前已显示的正文，按最终版本和当前思考偏好自动补读至原有长度，不会缩回首段。补读失败仍保留正文并提供重试；核对完成前明确标为保留预览，最终分片到达 EOF 才确认全文完整。

已加载正文到达 EOF 才提供完整复制，否则明确复制已加载部分。链接需主动检查地址并确认打开，仅允许 HTTP/HTTPS；远程图片仅显示替代文字。

关联栏仅随显式选择改变范围，读取不会发送 viewed/presented/read 命令。待处理页可分页读取未完成或失败消息的完整原文；复制或恢复不自动重发，恢复不会覆盖已有草稿。失败消息受本机配额和清理保护，仅确认失败且已恢复的记录可显式丢弃。

会话进入 RECOVERY_BLOCKED 时，客户端显示“恢复会话”确认入口，使用现有 session/resume 命令与原请求回执协议继续未完成回合；不会重新发送已受理消息。

消息投影可附带来源、原事件 ID、直接关联 ID、结果与预览可用性；字段只来自已有记录。saved 预览不等于持久成功，过期预览显示无最终记录。
