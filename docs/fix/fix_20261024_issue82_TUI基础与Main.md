# Issue #82 — R7 完整编辑器与恢复合同

日期：2026-10-25（Asia/Hong_Kong）。**仅计划**，正式实施仍等精确计划Claude PASS及协调批准。协调已选定最小本地browser命令界面、plain-DOM/ws8.21.3范围。R7解决R6四项歧义和三条非阻塞注记，冲突历史条款以本轮为准；下方原文逐字保留，不追溯改测试结果。

## R7.1 唯一编辑器：input sink 加 canonical draft

textarea**只作input sink**，不保存draft，最多容纳当前native composition preview。Node canonical typed runs/paste nodes用textContent/style枚举渲染可见draft、collapsed paste chips、app caret和app selection。sink定位于app caret，以使IME候选窗口正确锚定；保留focus/accessibility label，不设display:none。只有一套editor model，不用textarea.value与Node双模型竞争。仅在input/composition事务结束后清sink，render不能顺便清掉active composition。

collapsed paste chip作为atomic caret/selection单位：click或明确keyboard activation只切换展开显示，不改内容/发送。expanded可暴露精确字符range，编辑创建新的immutable paste-derived nodes/blobs并保留paste来源，不改原blob、不把保留文字重标typed。partial cut剩余片段仍paste-derived，undo恢复旧node引用，copy原文而非chip label。应用以精确canonical revision管理caret/selection offset及range转换；Arrow/Home/End/Backspace/Delete和受支持selection/word-edit转为明确editor operation，不从textarea native offset/targetRange猜draft选区。insertion/composition开始时冻结app selection/revision，验证后一次提交，只按规定operation rebase。autocorrect/replacement/dictation range若指向active事务外sink文字或无法映射app selection，保留draft并锁/resync。sink关闭autocomplete/autocorrect/spellcheck；typed/composition仍按R6表。未知Ctrl-letter编辑（含平台yank/transposition）在非composition期间prevent并显示unsupported，不允许隐形修改sink。native browser copy/paste/undo与应用显式绑定分别处理，composition优先于此抑制。

draft copy/cut使用app selection及明确app clipboard操作，不假设sink有native选区。复制精确canonical选中文字，必要时展开所选paste node；cut仅在明确clipboard write成功且revision/range仍有效后修改canonical model。失败或stale selection保留draft，复制成功不授权删除新revision；cut是单次可undo编辑。browser API拒绝显示UNSUPPORTED/error，无native/OSC fallback。transcript native选区复制仍native，不改draft；Ctrl+C/Cmd+C不退出。paste block经copy/edit/undo/reload保留data来源，不把拷贝的label误当paste ID。browser event text到canonical/frozen只做既定CR归一化；source-to-browser clipboard转换单独测量，不宣称应用保证该外部链路无损。

## R7.2 仅 restart 取得 fresh bootstrap

无有效per-tab reconnect secret时选**restart only**。R7删除R6未定义的“通过调用CLI请求fresh URL”机制。launch进程不读取terminal stdin、key bytes或readline；不加`--new-url`、第二writer或control socket。普通reconnect/reload在60秒窗口内用轮换secret。bootstrap消费/丢失或握手丢失新secret时，必须等当前TUI窗口结束退出，再fresh CLI launch；page/terminal明确说明，不复用旧token。已有writer占用时第二次launch明确报already-running/恢复指引并退出，不另抢writer、不撤销active browser session。可显式OS关闭已确认的TUI进程，按bounded flush再重启；不停止Core或无关进程。

初次launch无人认证时，bootstrap60秒过期；完成owned初始化flush、释放writer并退出，显示expired/no-client。不自动重发、不允许未认证流量延长deadline。消费后握手失败同样采用无active-client有界期限，不无限持锁。有效重连按R6原子消费/轮换secret并撤销旧generation；握手ACK/state sync/必要Resume之前无动作。

明确duplicate-tab行为：若browser复制sessionStorage且duplicate用当前secret认证，最多一个新generation胜出；旧tab立即只读/replaced、后续event拒绝，显著保留/报告未ACK本地编辑为unsaved，不暗中合并或抹除。新tab只接canonical/durable snapshot并须Resume旧outbox。丢失/重复/旧secret不能造第二writer。实测browser复制行为，不凭假设。

## R7.3 Resume barrier 与 profile 所有权

已有frozen entries等Resume时，新明确submit经验证后**持久排队尾**，显示“queued — waiting for Resume”。new submit不等于Resume，不能越过前项或UNKNOWN/FIFO barrier。该队列准入按原合同仅在helper ACK后清精确来源draft revision，不是HTTP receipt。single dispatcher仅在明确Resume解除session barrier且binding/reconcile/identity条件满足后开始处理；无旧resume barrier时，新明确submit按当前generation正常分发。disconnect在下一个POST前撤权，已开始HTTP按R6处理。异步durable attempt-marker ACK之后、真正开始HTTP之前再次检查generation/authorization；若fsync期间断连则不POST，保守保留已durable attempted/unknown记录供后续对账/明确Resume，不能错误清除或回滚。

协调已从#82彻底删除可选`--app`/专用browser profile功能，覆盖R6提案；**不创建、读取、修改或清理任何browser profile目录**。主入口只打印localhost URL，可用fixed argv打开已安装browser。无cookie导入/登录、browser安装、安全变更或profile所有权/清理子系统。client filesystem仍限core-endpoint.json读取及自身tui-v1状态，沿用helper writer。extensions/同用户进程仍为已披露残余风险，不靠新增profile功能声称闭合。

## R7.4 复核证据与实施测试

R6复核`60d166f8cc77f990ae7b7861523cf08265996297`认可设计及全部六项R5修订，确认附件/runbook/历史一致，最终CHANGES_REQUIRED四歧义现已处理。其自写Chromium153/Xvfb原型用协议key输入：Ctrl+Shift+S零动作，Ctrl+S一次，repeat忽略，physical-S配模拟非Latin key值一次。Chromium自有X11clipboard/selection实测Shift+Insert、中键、文字drag/drop；保留layout-overlap首败。**待reviewer确认的证据更正：**R6最终文字称U+009B丢失，但同包`logs/p2-v2-xvfb.json`的Shift+Insert step在paste event及node均有码点155。Codex已将driver CLIP与全部event码点及归一化node比较：source/event精确一致，source经CR归一化后与node一致，newActions=0。JSON SHA256 `f19b5cadd492c8e1284d41114fd8804b0a6c62d9b4a4da8cf63c1a97aa6dbc6a`；driver SHA256 `ca5b80ba4fbd924a9034062db778e0f44ec4c923f4828477984a48fa81ee05e7`。不得把未成立的丢失当已知限制或禁用Shift+Insert；请Claude撤回该说法，或指定其他失败run/hash及精确输入输出码点。保留原报告及更正。CapsLock、browser保留键拦截、真实OS IME、Mac/Chrome155、WS/Node writer、undo/reload/reconnect未测。产品须测实际adapter，并区分各外部交付路径局限与event到frozen payload保真。

ignored原始包SHA256 `b9bd3e312c3fc14a3e4b06acc93daf7a74f757319e96340f4ada022244169190`，16项/48,378解包字节，含首败及reviewer自写原型。没有再次尝试external xterm构建；历史G0 FAIL_PROTOCOL_PROVENANCE及native/IME延期不变。

增补产品测试：sink composition/caret定位/range映射；collapsed nodes cut/copy/undo；clipboard拒绝及cut途中编辑；首次no-client过期；bootstrap消费/secret丢失后restart；duplicate-tab撤销及旧unsaved；new-submit-tail等Resume；无browser-profile读写/cleanup。补充而不替代既有durability/input/transport/identity/CI测试。本计划不再留下核心架构选择；同Claude给PASS或具体功能修订后交协调正式释放，本文不批准产品代码/PR/合并。

---

## 历史 R6 计划 — 以下原文逐字保留


# Issue #82 — R6 提交实施批准的 structured input 路径

日期：2026-10-25（Asia/Hong_Kong）。**仅计划。**本轮采纳R5独立建议及六项修订；协调已选定P2和plain-DOM surface/依赖范围作为Mac/Linux动作路径。产品正式实施仍须精确计划通过Claude及协调后续释放。下方R5/R4/R3逐字保留历史；输入、renderer、browser键位、重连冲突处以R6为准。其余Core/draft/outbox/sync/限额及准确HEAD验证要求不变。

## R6.1 选择的提案与范围

采用最小本地browser承载TUI，三段header/transcript/固定input-status footer，既有深蓝/浅蓝/故障红及命令registry。**仅structured producer交付R3粘贴作为数据合同。**新产品CLI默认进入可用的browser命令界面，准确称为“本地浏览器承载的命令式界面”，不是Terminal.app原生运行。Terminal.app、raw/unlocked xterm只属未验证降级；既有isolated G0无Core连接，保留研究证据，不另开发第二套完整raw terminal client。任何保留的诊断raw adapter须明显标识，不能POST或命令分发，不算Main交付。将xterm构建、Reset锁定、native terminal attestation研究移出#82实施范围，保留其证据/失败，不再尝试执行被拒external build。

browser renderer选plain DOM文字行和style-enum spans；全部Core/model/draft文字使用`textContent`，绝不`innerHTML`、解释ANSI、执行HTML/Markdown或URL。无browser xterm依赖/`onData`路径；必要处复用width/text helpers，独立验证browser字体/grid几何。唯一拟新增direct runtime依赖为exact `ws@8.21.3`（现有lock/官方npm）；Node内置HTTP和plain JS/CSS在严格CSP下serve打包资源。dev headless renderer仅保留证据工具及已知Unicode宽度局限，无退休GUI/framework/CDN/provider/browser extension/native clipboard backend。

初始验证目标仍Chrome/Chromium153与Chrome155，feature gate及unsupported只读。可用既有browser，不要求专用profile。extensions和同用户恶意本地进程不属paste-origin威胁模型，明确为残余风险；CSP不宣称阻挡特权扩展。可显式选择`--app`/专用profile启动，仅在所选profile目录下与`tui-v1/`并列的`tui-browser-v1/`中新建TUI-owned browser profile；profile/cache ownership单独记录，不混入保护draft blob及其配额。不读改default profile、不导cookies/登录、不关闭browser安全、不自动删除非launcher明确拥有的profile/cache。仅在browser退出后显式清理owned profile，不删除draft state。

## R6.2 精确 browser 键位与 composition 合同

动作键用`KeyboardEvent.code`加**完整modifier集合**：Ctrl=true，Meta/Alt/Shift=false。CapsLock不影响physical code。submit/open-command/copy/quit/resume忽略auto-repeat。`key`可报告文字，不判断动作。Node不接收页面自报trusted作为信任依据，仍独立验证authenticated channel/schema/generation/sequence/revision/canonical model。

| 键/事件 | browser adapter行为 |
| --- | --- |
| Ctrl+S | prevent browser default，同步且非composing时明确提交一次 |
| Ctrl+G/P/O | prevent default，分别命令buffer/literal toggle/明确visible-text copy |
| Ctrl+U/D | prevent default，有界viewport滚动 |
| Enter | 仅换行，无动作，去重后续beforeinput |
| Tab | 应用补全/编辑；paste Tab留在paste-data node |
| Ctrl+C / Cmd+C | browser复制惯例，**绝不退出TUI**；只复制真实选区，不暗中执行其他命令 |
| Ctrl+V / Cmd+V、可用时Shift+Insert | 让native paste gesture产生paste event，再按数据处理 |
| Ctrl+Z/Y及平台undo/redo | 识别后路由应用自有undo/redo，不允许browser单独变更model |
| /quit | 明确命令submit，flush及durable ACK后关闭adapter/writer |
| 关闭tab/window、reload、browser保留键 | 不保证最后flush，按disconnect/saved-unsaved合同处理 |

Chrome常用Ctrl+S保存、G查找下一个、P打印、O打开、U源码、D书签；这些应用键必须在每个目标实测拦截。macOS对应browser快捷键通常用Meta；不拦Meta+L/T/W/Q等browser/app导航键，不假定跨平台保留/拦截行为相同。仅adapter焦点下对约定应用键同步preventDefault。若必要键不能拦截，明确禁用该绑定，并用固定footer小控件（Submit、Commands、Literal、Copy、scroll、Resume）提供同动作，经trusted click及同Node事件路径。缺失快捷键不能静默执行browser动作却声称TUI成功；控件留在三段布局，不扩展通用web导航。

composition仅由trusted序列开始。在isComposing、adapter composition transaction或keyCode229期间，**禁止全部动作键及Enter/Space/Tab编辑快捷键**，不prevent IME自身候选确认，不插入newline/completion。preview为transient，不是durable typed node；从trusted composition序列恰好commit一次，关联final beforeinput/input去重。untrusted/synthetic composition不能commit或解除动作锁。未知、不支持、取消或无法对齐的序列保留最后canonical draft、锁动作并明显resync。真实OS IME与CDP模拟分开。

## R6.3 明确 input-type 与来源规则

Node canonical editor只接收允许转换，不从内容或snapshot猜来源。不可变paste ID及app-owned undo在insert/delete/undo/redo/durable save/reconnect/reload中保留来源；编辑paste node不能把保留字符改成typed。另敲slash也不能追溯改变paste-origin前缀来源。

| trusted browser input | canonical转换 |
| --- | --- |
| paste / insertFromPaste / insertFromPasteAsQuotation | plain text恰好一个paste-data事务，prevent重复默认插入 |
| drop / insertFromDrop | plain-text paste-data，拒files/URL-as-action/default navigation |
| Linux middle-click selection paste | paste-data；拦auxiliary默认插入，若缺可靠text/source则明显拒绝此次插入并锁/resync，绝不当typed |
| composition外insertText | typed-text插入 |
| insertReplacementText / 平台dictation | 带明确validated range的typed edit；range缺失/歧义锁/resync，不改无关文字 |
| insertCompositionText及final commit | transient preview，按R6.2恰好一个typed事务 |
| insertLineBreak / insertParagraph | 非composition单个typed newline，与已处理key去重 |
| historyUndo / historyRedo | prevent browser mutation，app-owned undo/redo保留来源 |
| cut / deleteByCut | prevent无记录browser mutation；validated range单次可undo删除。经明确cut event允许的clipboard路径复制选区；复制失败保留选区/文字 |
| 已支持delete/edit range | 对canonical revision验证，执行规定编辑且保留来源tag |
| unknown inputType、untrusted event、错误range、重复companion event | untrusted忽略；未知/错误转换锁动作resync；识别重复为no-op |

paste/drop/middle-click中的`/quit`、tab、NUL、C0/C1、marker样式及newline始终为data。保留原明确CR/CRLF→LF归一化，无control stripping、command interpolation、HTML插入、字符转key。动作事件独立，data node payload不能制造action。Node仅在前序输入事务完成且revision一致后验证action资格；冻结payload测试须验精确文字，不只数动作。

## R6.4 Single-use bootstrap 与断连授权

launch fragment bootstrap为密码学随机**single-use** capability，60秒寿命。Host/Origin/握手有效后原子消费，从page history清除；URL打印到调用terminal是明确本地交接，不泄露Core owner token。Core凭据仅留Node，bootstrap绝不复用或写durable draft/log。

认证page取得独立可轮换per-tab reconnect secret，仅存该origin的sessionStorage，不存localStorage/cookie/profile配置/诊断文件；server只在内存保存verifier，绑定sole writer/tab session/generation/reconnect deadline。这明确覆盖R5仅内存/不存browser storage条款，仅此reconnect credential例外。每次reconnect/reload原子消费旧secret、废旧generation、生成新secret，经认证socket发送new generation/secret。page先存new secret再ACK握手；握手ACK和canonical state同步完成前禁止edit/action。旧/已消费secret不能造第二writer。若新secret存储前握手失败/响应丢失，回退CLI fresh bootstrap，不复用已消费credential、不猜结果。

authenticated channel断开立即禁止开始new/retry POST；当前reconnect verifier仅保留已有60秒窗口。窗口过期/process退出/显式quit完成后secret失效；显式quit/credential-invalid response清sessionStorage。browser可能恢复tab/sessionStorage，故有效性仅由live server deadline/generation决定，不能依赖browser storage生命周期。请求或恢复失败时由调用CLI提供fresh bootstrap；签发它先撤销旧reconnect session才允许新会话。不自动开新tab，不存owner凭据，不允许未认证socket延长deadline；限制socket数量/握手时限。窗口超时完成已收到write、关writer并退出，下次launch恢复durable并签新bootstrap。

新认证后先完整state/revision同步，再由明确Resume允许旧frozen outbox POST；保留bytes/ID/producer metadata/FIFO unknown barrier。已开始HTTP可完成并保存receipt/unknown，disconnect不能撤回已发请求。重连/reload/GET/composition完成不创建submit。single dispatcher在写durable attempt marker及开始POST前将new submit/Resume与disconnect/generation撤销串行化。Node不相信页面自报ACK；“已保存”仍需精确durable ACK到达page，关tab不能保证未送达/unsaved文字存活。

## R6.5 验证与独立证据

增补每个input-type行、physical code/exact modifiers/Shift/CapsLock/非Latin layout、repeat suppression、保留键拦截/fallback、IME确认不产生action/newline/completion、bootstrap reuse/expiry/lost handshake、seq/generation/revision负例、disconnect-dispatch竞态、编辑/undo/reload来源保持、C0/C1精确payload。受支持环境实测browser clipboard delivery及明确动作。六项修订只解决计划歧义，不声称产品测试已跑；完整repo验证、API清单、准确产品HEAD复核及实际Linux/macOS CI仍后续。真实OS IME/visual缺项可按Master授权延期。

R5独立复核`e645e6b06c317c4822258d391b279632f359f411`采纳全部R4修订，确认英文附件/runbook/历史字节一致、31relative links有效。source-model PTY区分filtered paste期间零自动动作与Reset来源丢失；其自写headed Chromium153/Xvfb原型用真实X11clipboard加CDP输入，paste零动作、paste `/quit`+明确submit仍message、typed `/quit`为command。首轮key大小写失败保留，次轮改physical code；原型代码未排除Shift，故不能作为完整modifier证据，R6必须补测。CDP composition不真实，非OS IME验收。原始包SHA256 `45d75b8bb2e3141f4620c6320235c237c8500062c9035834f8dc25d767f42304`，17项/44,460解包字节，ignored保留日志/原型/截图。

单次获准xterm configure再次**未执行**，被沙盒automatic classifier以`Code from External`拒绝，未重试/变形命令/换通道。REAL_LINUX_TERMINAL仍NOT_TESTED/DEFERRED。G0 raw-parser FAIL_PROTOCOL_PROVENANCE保留且可复现；P2是拟产品边界，不追溯把G0写成PASS。同Claude对精确计划给PASS/CHANGES_REQUIRED，再交协调明确scope/实施裁决。尚无产品实现、PR或合并。

---

## 历史 R5 计划 — 以下原文逐字保留


# Issue #82 — R5 输入来源合同与 R4 独立证据

日期：2026-10-25（Asia/Hong_Kong）。本轮**仅修订计划**，产品实现仍需受委托协调批准。R4 准备的独立复核提交为 `d6d47fdbde9067ba6a312236e125f952440b6120`。下方 R4 与原 R3 均逐字保留为历史；输入来源方案冲突处以 R5 为准，Master 的 R4 环境/视觉延期政策继续有效。

## R5.1 采纳 R4 四项修订

独立 reviewer 返回 CHANGES_REQUIRED，指出四项功能细节。全部采纳，并明确下列取舍。这些是拟实施合同，尚非产品行为，也未批准不安全的 G0 parser。

| 输入/操作 | 未验证生产者 | 仅在功能合同成立后可用的已验证生产者 |
| --- | --- | --- |
| 任意视图/模式 Ctrl+S、全部 slash 命令、替换确认 | 禁用、保留缓冲，显示 INPUT_UNVERIFIED | 明确动作事件通过持久化/domain 检查后可分发 |
| Ctrl+G、Ctrl+O、/copy、外部剪贴板写入 | 禁用 | 按命令/复制合同及真实剪贴板能力执行 |
| 文字/IME 结果、BS/DEL、方向/Home/End、Ctrl+Z/Y、Ctrl+P、Esc | 仅本地编辑，无隐藏动作处理器 | 相同编辑合同 |
| CR/LF、Tab，包含命令栏与确认提示 | 换行、仅编辑补全，绝不执行或确认 | 相同；仅已验证明确提交可执行 |
| 滚动与选区 | 可用，选区不自动复制 | 可用 |
| Ctrl+C | 只允许 flush 后本地退出；无 POST、丢弃、domain 切换或外部复制 | 相同安全退出例外 |
| 自动保存、HTTP GET、SSE/catch-up | 经正常绑定/验证可用 | 可用 |
| 新 POST 或 frozen POST 重试 | 禁用，包括 exact-byte 指纹重放 | 仅已验证当前会话且满足原 outbox 合同 |
| SIGHUP/SIGTERM/关闭窗口 | 有界安全关闭及 helper 完成写入 | 相同 |

raw 模式的 Ctrl+C 不产生 SIGINT，因此明确本地退出例外，避免无法退出；退出不丢弃持久草稿。未验证终端中的粘贴仍可能触发此退出，所以 UI 必须说明动作输入未经认证，不得宣称完整输入安全或受支持的 live 使用。未验证输入不得提交、重试、丢弃、切换 domain 或外部复制。C1 Unicode 字符 U+0080–U+009F 始终是文字数据，在 decoder 中绝不转成 CSI/OSC/控制命令；渲染时安全显示数据，不直接输出终端控制序列。专测 U+009B。

每个 frozen entry 在既有精确正文、binding、revision 之外，记录来源 producer class 与 policy version/hash。当前会话未验证时，可读取旧 entry 并用 GET 对账，但禁止全部自动/新建/重试 POST。GET 独立结果不能满足丢失 ACK 后的指纹检查，也不能释放唯一正文。仅在已验证当前会话重新核对 binding 后，才恢复 identical-byte replay；不能改写旧来源或新建 request ID。此前已持久化验证 POST receipt 的记录可完成已经授权的 handoff/cleanup。来源元数据及准入条件不替代 Core identity/idempotency 验证。

## R5.2 launcher 所有的候选生产者与精确粘贴策略

不能通过 TERM、XTVERSION、环境变量、自填 trust 开关、带内 nonce、时序或一次粘贴成功选定受支持生产者。launcher 必须控制精确终端二进制和进程局部资源配置，通过非 TTY 的私有认证通道联系 child，并验证 child controlling PTY 属于其启动的终端进程。候选实现为 inherited socket 的 fresh nonce 加 launcher/process/PTY 身份核对；跨 exec descriptor 的实际行为须先验证再定案。认证失败/断开或终端/配置异常一律降为未验证。记录 binary/source identity、UTF-8 设置、policy hash 和 attestation 机制。不改 Master 主机的全局 X resources，不安装主机软件。

xterm 研究候选通过进程局部 `-xrm` 使用以下精确资源：

```text
XTerm*allowPasteControls: false
XTerm*disallowedPasteControls: NUL,SOH,STX,ETX,EOT,ENQ,ACK,BEL,BS,VT,FF,SO,SI,DLE,DC1,DC2,DC3,DC4,NAK,SYN,ETB,CAN,EM,SUB,ESC,FS,GS,RS,US,DEL,STTY
```

必须 UTF-8；排除 HT/LF/CR 之外全部 C0、DEL 和 terminal special controls，不使用宽泛 C0 关键字。生产者将禁用控制字符替换为空格，将 LF 转成 CR；UI/help/测试明确此交付合同，应用的 CR/CRLF 归一化仍明确规定。C1 Unicode 数据不能取得 escape 语义。这只是源码审阅的候选行为，尚非真实终端验证。真实剪贴板、嵌套/分片 marker、控制键、Reset 后立即粘贴、进程归属/认证通道仍是功能验证任务。

**提交独立 reviewer 的剩余问题：**只过滤控制键不能在 Reset 关闭 bracketed framing 后保留 paste 来源。例如粘贴 `/quit` 不含禁用控制字符，稍后的真实 Ctrl+S 可能把它当手打命令；粘贴 Tab 可能触发编辑补全而非保留数据。这是来源/交互合同失败，不是无需后续真实submit即可自动执行的新实证；仅编辑补全也不等于命令执行。R3 要求粘贴永不变成命令且 tab 保真。“将执行”提示或第二次带内确认不能修复这一合同。在具体生产者能独立于 Reset 保留来源，或协调明确批准经复核的交互合同变更之前，不得宣布 P1 完成。要求 reviewer 实测并选择具体修复：生产者保证 framing/structured events，或明确说明粘贴语义变化、保留显式授权的有限 UX 提案。不得静默削弱 R3。

## R5.3 交付后果与下一裁决

现有证据没有证明 Terminal.app 的等价生产者。P1 下它仍未验证：只读/编辑及安全退出，不能 live send 或命令。协调已明确拒绝以此作为 #82 Main 最终交付或推进 #83 的依据。因此仅 P1 infrastructure 不能关闭 #82 交互退出项或 #84，不得写成 Mac Main 可用；Linux 候选也不证明 Mac 支持。若候选不满足合同，向协调提出具体受支持 Mac producer 或 P2 structured input transport；不擅自实施新 GUI、transport、终端切换或实质范围变更。真实 macOS/中文 IME 观察仍可按 Master 政策延期，已知输入功能缺陷不能延期冒充解决。

### 提交协调裁决的具体 P2：最小浏览器承载 TUI

若原生 producer 不能满足 provenance 合同，提议一个本地浏览器页面，沿用 terminal 风格 header/transcript/固定输入footer、配色及命令registry。这是启动界面的实质变更，**尚未批准实现**，不恢复 Tauri/Svelte 或任何退休桌面代码。CoreClient、持久 writer、outbox、sync 仍在 Node 进程；页面只做 structured input/output adapter。Mac/Linux 复用同一受支持浏览器 adapter，raw Terminal.app 保留安全降级 adapter。

依赖/范围：固定官方npm的 `@xterm/xterm@5.5.0`（与headless一致），将现有lock中的 `ws@8.21.3` 提升为exact direct dependency；Node内置HTTP加小型plain JavaScript页面，无bundler/framework。registry元数据和现有ws lock integrity本地保存，安装等待实施批准；确定性build复制package browser bundle/CSS，无外部CDN。无外部CDN、model/browser凭据、扩展、云服务、native clipboard backend 或通用web UI。renderer只显示输出，**绝不把 xterm.onData 接到 action dispatch**。普通输入面捕获 browser paste/composition/text events，交应用自有 structured editor；paste插入不可变数据node，不能产生key/action event。应用管理undo/redo和node来源；阻止默认paste重复插入。未知input类型作为数据，无法对齐buffer时禁用动作。Browser Reset/reload重连新session并恢复持久状态，不能把paste node重标为typed。

只有独立 trusted browser keydown/click handler 可发送 submit/open-command/copy/quit action message，并检查composition状态及adapter generation；paste控制字符及xterm escape bytes不进入这些handler。Ctrl+S仍明确提交、Enter换行、Tab仅编辑、Ctrl+G命令buffer。parser使用structured transport的typed/paste nodes，所以粘贴`/quit`在reload或后续真实Ctrl+S之后仍是数据。composition期间禁用动作键；自动browser composition事件只是协议测试，不能冒充真实IME。剪贴板读取只来自真实paste event；复制必须明确触发并报告能力。

transport/auth候选：仅bind随机127.0.0.1端口；只serve打包静态文件，严格CSP、无外部资源。每次launch随机capability放首次URL fragment，bootstrap后从可见history移除，仅用于初次WebSocket握手；不是Core token，不写持久draft/log。upgrade前验证Host和精确same-origin Origin，拒绝缺失/异常Origin；认证成功前不处理应用消息，Core owner token仅留Node。有界schema/message size、sequence/session generation、一个可写adapter；重连认证新channel并重新对齐状态，过期/重复/缺口事件不得派发动作。这隔离paste bytes及无关web origin，不承诺抵御同用户恶意本地进程。产品代码前须获协调批准surface/依赖范围。

验证：adapter paste/typed/unknown/composition单测；真实browser paste delivery及trusted动作；`/quit`、tab、全部C0/C1、嵌套marker、大量/多次粘贴、undo/reload、断连/过期/重复消息；paste零动作、非composition明确submit恰好一次；既有durability/sync/outbox全套；origin/capability/schema/replay负例和有界memory/backpressure；相同grid/footer检查。真实Mac/Linux IME/clipboard/visual能力分别记录，可延期。明确复核风险：browser composition/beforeinput差异、编辑时来源保持、本地launch/capability、新renderer/transport依赖、accessibility及terminal式布局。请Claude判断此有限P2是否可实施并给修订，或提出更简单具体producer，不能重新变成无限环境门槛。

### 提交复核的 P2 启动、传输与恢复细节

- 初始browser目标：Chrome/Chromium153（reviewer已观察环境）、Chrome155（本机bundle155.0.8059.85，只读元数据，不是测试）。feature gate要求paste/composition/beforeinput/WebSocket；未支持family/major仅显示保留草稿只读，待另行验证。实测可用Chrome155及独立Chromium153输入路径；真实OS IME另行延期。不宣称Safari/Firefox支持、不回退raw xterm input；版本字符串只判断兼容性，不是producer认证。
- 新TUI CLI显式browser-adapter选项启动，打印localhost bootstrap URL，可显式选择fixed argv的open-browser flag。不修改default browser、不启动Core、不安装browser。Node先取得唯一state writer再serve page。未认证页面不能读draft或POST；认证后先同步revision/sequence并显示最后durable state，再启用动作。
- `isTrusted`只过滤本地browser事件，Node不信任message里自报此标记。Node独立验证exact schema、capability、same-origin upgrade、当前generation、递增expected sequence、当前revision和single writer；Node保存canonical typed/paste node model，只应用规定insertion/edit/undo转换，由它解析命令。页面发typed-text、paste-data、edit、composition-state、明确action，不发可执行command object、任意node-kind改写或POST请求。未知转换、revision mismatch、缺seq、malformed event锁动作并要求snapshot resync；旧generation及重复seq拒绝且不分发。
- WebSocket `maxPayload`64KiB、关闭compression及optional native buffer/UTF-8 addon。paste按seq分片为有界事务（最多既有4MiB draft限制，未完成事务5秒timeout）；paste/composition事务未完成时禁动作，partial paste绝不算typed。server pending input最多8MiB，拒绝保留上个saved draft并明确报被拒编辑。render queue最多1MiB，替换完整viewport snapshot；history放Core/有界cache，不用无限browser scrollback。
- “已保存”仅指server writer对精确revision的durable ACK已回到页面。本地显示但未ACK的编辑属于unsaved；tab关闭/crash不能保证最后事件送达，不依赖unload callback保存。显式/quit先flush已接收revision、回ACK，再关adapter/writer。意外disconnect立即撤销此generation开始任何POST的权限，包括排队new intent、retry/fingerprint replay；已发HTTP可完成并记录receipt/unknown，不另造请求。保留frozen bytes/ID/FIFO barrier。重新认证+durable state sync后可读/对账；必须新的明确Resume动作才恢复旧frozen dispatcher，reload不触发提交。
- 无authenticated adapter时，Node保留自有lock及已收到save，提供有界60秒重连窗口，不新发POST；超时flush已收到工作并安全退出。restart从同state root恢复ACKed drafts/frozen outbox。socket heartbeat检测失活，新认证generation使旧会话失效，不能出现第二writer；flush失败明确显示/报告，不宣称成功。
- browser clipboard仅支持真实paste event的plain text，无环境剪贴板主动读取、图片导入、自动copy。明确copy只在browser clipboard API可用且允许时执行；拒绝返回UNSUPPORTED/error，不伪报成功、不fallback native/OSC。Mac/Linux native选区及clipboard promise差异单独记录；支持时保留exact-body /copy与visible-text Ctrl+O差别。

## R5.4 R4 独立证据及限制

Claude 独立获取精确 `d6d47fd…`，保持 Pi `16787ad5…`，在 Ubuntu 24.04.5 x86_64（Node 22.22.0、Python 3.13.17/fcntl）运行真实探针，并用 Chromium 153 查看全部十帧。首次 npm 安装因 registry 访问失败；后续使用预装 tsx 4.23.12（锁定4.23.15）、固定 submodule 源码编译 pi-tui、marked 18.0.10（锁定18.0.11）、源码构建 headless xterm tag5.5.0。因此属于替代环境证据，不是精确锁依赖验证。`npm run check` 因缺失依赖/types 和不同 compiler 返回2，属于 INVALID_ENV，既不是代码通过，也不能据此归因代码缺陷。

独立有限测试8/8、Linux无skip；PTY正常/hangup/parent-kill、writer lock重开通过；生成十个SVG并查看PNG。reviewer 独立复现 paste end 分片后 Ctrl+S 触发一次提交，以及无 bracket 文本加 Ctrl+S 触发提交。**FAIL_PROTOCOL_PROVENANCE 继续确认存在。**真实 Linux terminal/IME、真实 Mac/IME 仍 NOT_TESTED。headless 默认 Unicode6 的 emoji宽度与pi-tui不同，emoji行几何及其滚动条错位明确不具真实终端代表性；`footerPresent`只搜索“DRAFT”，不构成几何断言。真实视觉与完整 CI 另行记录。

R4 原始文件和下载包保持 Git ignored。包 SHA-256：`41860de029d6e28bf611f417846e75e32a32369790f8da7ed35d77ddb3f41430`；72项普通文件/目录，解包3,862,829字节。保留首次失败和替代构建命令。reviewer 报告其沙盒策略阻止执行私有 xterm/X库构建的外部 configure scripts。协调允许一次受限、无特权、固定公开xterm/xenocara源码的Claude临时沙盒构建，Xvfb、自写Xlib selection owner及XTEST paste，保持unsafe SendEvent禁用。这只是委托范围确认，不冒充人工批准、不豁免Claude沙盒策略；仅正常授权机制允许才执行，否则保留拒绝、标REAL_LINUX_TERMINAL NOT_TESTED/DEFERRED并继续source/plan复核。不安装系统路径、不访问Master主机/凭据、不改网络策略、不加权限。更新[英文runbook](evidence/issue82-tui/g0-cloud-run.en.md)区分离线替代与精确验证。

下一步：同一 Claude Opus5.5 Extra，完整英文计划与精确push SHA，首次及后续查看均五分钟；解决功能方案并获协调实施批准。本文件不授权 PR、产品实现或合并。

---

## 历史 R4 计划 — 以下原文逐字保留


# Issue #82 — R4 云端验收与 Linux 前置修订

日期：2026-10-25（Asia/Hong_Kong）。当前范围：修订计划和窄范围 G0/Linux 前置准备；产品实现待委托协调裁决本修订后释放。仓库：https://github.com/ExplodeCode6324/Secretary ，Issue：https://github.com/ExplodeCode6324/Secretary/issues/82 。继续现有 checkout/分支 `codex/issue82-tui-main`，从 `37f6ae3547dfe166ff747c9719461d89d61670bf` 准备，不创建会话/worktree，不访问 provider，不恢复退役 GUI，不部署主机。

## R4.1 当前授权与历史保留

Master 已通过协调直接更改政策：“视觉验收由claude在其独立云端沙盒环境完成，如果claude无法完成则延后，先合并并接着往下做”；Claude 首次等待改为**五分钟**，后续仍五分钟，并补齐云端所需 Linux 前置工作。这覆盖旧的 Mac 必须解锁/真实 IME 后才能实现以及 Linux TUI 一律延期的门槛，不豁免功能缺陷、必需验证、准确 HEAD 复核/CI，也不取消协调对准确 PR HEAD 的单独合并授权。账号/模型不可用仍由 Master 决定 Hermes fallback。#84 的本人日常体验保持待本人验收，顺序 #82→#83→#84，不启动 #70–74。

下方 R3 正文作为逐字保留的历史附录；其中范围、门禁、间隔和 Linux 陈述仅在本节明确覆盖的地方失效，其他业务合同继续作为实现合同。R3 在 `937f3031...` 的 PASS、G0 的 FAIL_PROTOCOL_PROVENANCE 和 Mac NOT_TESTED 均在审查记录与 [G0 交接](evidence/issue82-tui/g0-probe.md) 保留原貌，不追改历史。现有代码是隔离探针，不是产品实现。

## R4.2 证据与延期矩阵

| 层次 | 所需证据 | 环境不可用时的处置 |
| --- | --- | --- |
| 平台/runtime | 实际 OS/Node/Python/fcntl/locale/PTY、准确 SHA、命令与退出码 | 保存前置失败；云端不能执行如实记录，本机/CI 证据独立归属 |
| 功能合同 | 命令/草稿/outbox/同步/身份/有界读取/恢复；完整必需验证及实际 CI | 功能失败必须修复或可靠限制，不能归入视觉豁免 |
| PTY/headless 渲染 | 独立运行探针、raw bytes、尺寸网格、cells/SVG 哈希；能看图时实际审阅 | 无渲染/看图能力可 DEFERRED；生成 SVG 不等于视觉验收 |
| 真实 Linux terminal | 准确终端版本/配置/字体/剪贴板交付/Reset；确有 IME 才测 | 能力缺失记 DEFERRED/NOT_TESTED；不能证明 macOS |
| 真实 Mac Terminal/IME | 拼音按键、候选窗、Enter/Space、raw/动作轨迹、布局复制/Reset/窗口关闭 | 不重试解锁，记 DEFERRED/NOT_TESTED；环境原因本身不阻塞实现及获批合并 |
| 协议来源 | 反例和明确的生产安全边界/修复 | 继续 FAIL_PROTOCOL_PROVENANCE，不能用时间/分块或同通道二次确认伪造来源 |
| Master 日常体验 | #84 的实际本人使用 | 保持待本人验收，不阻塞其余可做工作 |

云端产物必须由 Claude 独立运行生成，Codex 的 PNG/日志只是参考。分别记录字体替代/缺字、截断、光标/底栏布局及实际操作。合并后在原 issue/交接保留延期项，不改写成验收通过；完整 API 清单/消费者文档、必需验证、同会话准确 HEAD 复核和实际 CI 仍是协调合并前条件。

## R4.3 当前获准的 Linux 窄范围前置

- 保留 pi-tui `0.87.0` 与 Pi 子模块；仅添加固定开发依赖 `@xterm/headless@5.5.0` 供隔离证据渲染，不给产品新增浏览器/GUI/xterm 程序依赖。
- macOS/Linux 均固定 `/usr/bin/python3`+fcntl；macOS 先做不触发安装的 CLT 检查，Linux 直接核实解释器。限时调用、明确错误、无自动安装。helper READY 前忽略终端进程组信号，只用管道，当前原子写完成/失败后处理 BrokenPipe，仅持有自己的锁；Python 显式 UTF-8并记录 locale。
- POSIX helper/renderer 测试不再仅在 Mac 执行，macOS/Linux 外的平台仍跳过；保留 raw mode、输出过滤和模式恢复，不加 native addon 或 OSC52/OSC8 fallback。
- 剪贴板是显式平台能力：Mac 保留有界 pbcopy，Linux 目前返回 UNSUPPORTED，不调用剪贴板子进程或更改剪贴板；不凭 DISPLAY/可执行文件存在等自动猜测后端，不能假报复制成功。
- 有界 PTY runner 运行实际探针，生成 ANSI→cells→SVG 和哈希/尺寸/text；覆盖 80/120/40×24/40/12 及低于最小尺寸、中文/emoji/组合字符、持续输出、raw 输入和 helper 生命周期。headless 宽度/字体可与真实终端不同，标明限制；鼠标/选择/IME/剪贴板分开验收。
- 现有 Core Linux CI 增加窄范围 environment/PTY/render 步骤，Mac 所选测试包含 G0，保留原 Core suites/services。后续仍须实际 CI 结果；Mac 跑 portable code 不等于 Linux 已运行。
- [英文独立运行说明](evidence/issue82-tui/g0-cloud-run.en.md) 提供复现命令和失败报告规则。协调已明确允许将本准备正常 push 到现有分支供 Claude 按完整 SHA 获取，当前不建 PR、不强推。

## R4.4 协议来源功能处置提案

保留的 parser 是刻意暴露缺陷的 witness，不能搬入产品编辑器。同块隔离不能认证下一 raw chunk；多等一段时间、同通道二次确认、TERM 检测或粘贴预览都不能区分相同字节流。Reset 还可能在下次 redraw 前丢失 bracketed framing。

**推荐分阶段边界 P1，待 reviewer/协调裁决：** 产品命令/持久状态/Core 路径置于带类型的输入来源边界之后。**未验证的原始终端只允许读/编辑字面数据，不派发动作**：文字不能授权发送、执行命令、丢弃、切换草稿、对外复制或退出；OS 信号仍可进行有界安全退出。live POST 和这些动作须来自已支持的输入生产者，其粘贴路径必须独立于分块/Reset 排除动作控制字节注入。不得添加用户自行声明的 `--trust-terminal` 绕过，也不能以一次样本证明完整安全。功能测试可用受控合成事件验证该类型边界，但不是终端认证。

候选生产者是准确 Linux xterm build 加进程局部资源策略，始终排除 paste 控制字节，不依赖 bracketed mode。[xterm 官方手册](https://invisible-island.net/xterm/manpage/xterm.html) 记载 `allowPasteControls` 及排除集合；这里只是研究候选，**没有批准换终端，也没有声称 Terminal.app 如此**。采用前必须完成源码/配置分析和独立真实剪贴板/Reset 证据，保留“终端交付文本”的合同并记录生产者拒绝了什么。`TERM=xterm` 或 headless xterm.js 都不是这个生产者。本提案不授权修改 Master 机器的全局资源或安装软件。

若云端无法建立这样的生产者，P1 可继续实现/复核基础功能并让原始终端动作保持锁定，**但只有协调明确接受这项交付缩减才可据此合并**；不得描述成已可用的完整 live terminal client，也不关闭 #82 的交互验收条件。P2 是另行明确复核的结构化输入传输，把 key/paste 来源分开；属于实质范围/UX 变化，须先交协调再编码。本前置没有实现 P1/P2；请 Claude 给出具体选择/修正及仍应阻止的命令/动作，不能把功能裁决混入非阻塞视觉延期。

## R4.5 后续执行与当前证据

1. 验证窄范围准备、push 准确提交；向同一 Claude Opus 5.5 Extra 会话提交**完整英文 R4+历史 R3 正文**、repo/issue、准确 SHA、原 G0 证据与 runbook；核实模型。首次与后续均五分钟，不提前轮询。
2. Claude 先报告独立沙盒 OS/runtime/GUI/渲染能力，再真实执行可行检查，返回命令、退出码、产物/截图和限制；分别判定计划可实施性、协议处置与视觉环境状态。
3. 交协调修订差异、原始复核结论和独立证据后释放产品实现。仅视觉能力缺失不能恢复旧的无限 Mac 门禁，不要求 Master 重批相同授权；账号/模型失败仍单独处理 fallback。
4. 获批后实现范围内 C1 合同，更新全部 API 行/消费者，完整必需测试/docs/formatting、实际 CI、准确 PR HEAD 代码/功能复核，再取协调明确合并授权；原 issue/交接保留延期验收。

历史 Mac G0 的7项有限检查、PTY生命周期、36字节剪贴板往返通过，但协议来源失败、真实 Mac UI/IME不可用。R4 portable 准备目前仅本机 macOS 已验证，Linux/Claude 执行以其实际结果为准。当前 npm audit 还报告原有 transitive fast-uri advisories（锁条目未改）；本次不进行无关 audit-fix 升级，另交协调处置。

---

## 历史 R3 计划 — 以下保留原始正文

# Issue #82 — macOS TUI 基础与可靠 Main（R3）

日期：2026-10-24（Asia/Hong_Kong）。范围：**仅计划**，实施待协调批准。仓库 [Secretary](https://github.com/ExplodeCode6324/Secretary)，[Issue #82](https://github.com/ExplodeCode6324/Secretary/issues/82)。基线 `f2f3c1929bfb3e2f40e67868861f41f7e94e781a`，分支 `codex/issue82-tui-main`，使用现有 secretary-core checkout。[完整英文计划](fix_20261024_issue82_TUI基础与Main.en.md)与本计划共同约束实施。浏览器 Claude **Opus 5.5 Extra** 使用本项独立会话复核；协调代 Master 审批计划，合并仍需准确 PR HEAD 的单独授权。

## 1. 范围与核实事实

交付从零实现的 TypeScript TUI：固定底部输入、默认 Main、Task 明确占位及独立草稿、确定性命令、可靠 outbox、顺序粘贴、CoT/历史有界读取、重连与冷启动一致性、客户端独立退出。复用 CoreClient、生成 DTO 和本机 HTTP/SSE。不重写 Core 业务/恢复策略，不迁移旧客户端，不提前实施 #83 的 Task 操作、图片/剪贴板导入及外部查看器，不做结构化引用、一次性业务 CLI、Linux TUI 或 #70–74 优化。#84 承接真实 provider 准备和 Master 日常体验。

已核实 main/origin/main 均为基线，tracked clean；393 个继承未跟踪报告已列清单并保留。#79/#80/#81 经 PR85/86/87 合并。现有 Core 进程、数据、分支、日志以及 Portable/Band 均不动，只管理本项创建且可确认归属的测试资源。API 当前 86 项（GET 52、POST 34），新 TUI 消费者 0；#81 fixture/loopback 结果不能算真实 provider 成功。

源码依据位于 `src/pi_secretary/src/`：`core-client.ts`、`api-v1.ts`、`api/contracts.ts`、`application-service.ts`、`sync-service.ts`、`sync-stream.ts`、`timeline.ts`、`conversation.ts`、`thinking-preview.ts`。需求依据为 `docs/tui/requirements-and-backend-plan.md` 的 IN/CMD/PASTE/REL/VIEW/RUN/AUTH 规则。

固定历史行为参考：[conversation.rs@1e450d4](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src-tauri/tests/conversation.rs)。4–50 行保护失败/未知原文、超出前 50 项仍可访问并拒绝跨域；52–85 行容量满拒绝新意图但保住草稿；87–103 行拒绝危险 URL。前两项写入 AC11/AC12 与 PASTE-04 可靠性用例，PASTE-03 另验证完整文本展开，第三项在 C1 无外部导航及 #83 后续 URL/argv 约束中保留。不复制或恢复 Rust 实现，不把旧测试当新产品证据。

## 2. 框架、终端与首个实施门槛 G0

只读盘点发现 Terminal.app **2.14**、Node **22.22.0**；/Applications 未发现 iTerm/Ghostty。首个支持目标选择系统 Terminal.app，实际 macOS、终端 profile/字体/尺寸/输入源在 G0 记录。当前 CUA 报告 Mac 锁屏，真实终端与 IME 为 **NOT_TESTED**；Chrome 扩展仍可操作。不以安装存在替代可用验收，无法解锁或真实输入时交协调裁决，不越过 G0。

首选固定 `@earendil-works/pi-tui@0.87.0`，已只读核对 npm 版本/integrity；尚未安装。Pi 子模块 `16787ad5b2dc748047f314ca1bfe7708f30f54f3` 含对应源码，TuiAltScreen/VStack/ScrollView 提供固定视口、宽字符与粘贴基础。G0 先核实实际 npm exports。对比候选 [Ink 上游](https://github.com/vadimdemedes/ink)：可行但多一层 React，可靠编辑器仍需自建。子模块不改；首选不能过门槛时带失败与替代方案交协调，不自行重大换框架。

stock Editor 的粘贴会归一化/过滤、展开 tab，并用可编辑 marker 字符串查正文，不能直接作为可靠草稿模型。新建小型结构化编辑器，复用渲染/按键/字符宽度原语；节点保存正文或不可变 paste ID，文字标签不拥有数据。不得引入 coding-agent 运行时或模型路由。

批准后首先做隔离输入/布局小验证，无真实 provider：Terminal.app 中启动退出、底部固定、80/120/40 列与 24/40/12 行、持续模拟输出中编辑、中文/emoji/组合字符、选择复制、多段/分片 bracketed paste。真实系统中文 IME 必须通过按键拼音输入、可见候选窗、Enter/Space 候选确认、不误发计数、显式提交一次的动作链验证。直接插入已合成中文、PTY 或单张截图都不是 IME 验收。留时间、终端/输入法身份、动作与输入事件/提交计数、必要截图；仅用合成数据。工具无法生成真实 composition 时，把就绪探针与步骤交协调安排真人操作。

具体键位：**Enter 换行，Ctrl+S 提交，Ctrl+G 命令栏，Ctrl+P 强制纯文本开关，Tab 仅补全，Esc 退出候选/命令栏，Ctrl+C 或 /quit 退出 TUI**。G0 必须验证 raw mode 下 Ctrl+S 不被流控吞掉；不依赖 Cmd+Enter/Shift+Enter。可配置键位必须唯一且目标终端可区分。命令栏与当前草稿分离，导航不会抹掉草稿；普通编辑区整次键入命令也可解析，纯文本开关是直接动作。只以 bracketed paste 作为原子粘贴；不支持时不能用可误执行的启发式冒充通过。

布局：顶部一行视图/Core 模式/域后缀/连接；中部滚动正文；底部固定 3–6 行编辑器与一行状态/键位。小于 40×12 显示 resize 提示，保留草稿并禁止提交。Task 明示“操作在 #83 提供”，允许 /M、/help 和显式 /send。可加可关闭的节流加载动效，不代表成功。

颜色沿用 `docs/tui/color-provenance.md` 精确来源：浅主题蓝 `#285ea6`、浅蓝 `#8bbde0`、故障红 `#b84550`；深主题 `#79acd9`、`#b1d5ec`、`#ed8791`。默认深色，可配浅色；truecolor 原值、256 色记录最近色映射、16 色/无色保留文字状态与对比。选择复制可读性纳入 G0。不渲染任意 ANSI 或 OSC 链接。

## 3. 确定性输入/命令

单一声明式注册表覆盖大小写敏感名称、别名、作用域、参数、帮助、补全、handler。全局 `/M`、`/T`、`/help [command]`、`/send [literal text]`、`/quit`；Main `/cotvisible [message_id] [on|off]`（别名 `/cotv`）、`/more <message_id>`、`/latest`、`/history [before|after]`；两视图的本地草稿/outbox 操作 `/pasteblock <id> <expand|collapse|edit|remove|copy>`、`/outbox [request_id]`、`/retry <request_id>`、`/discard <request_id>`。discard 仅限安全拒绝或从未发出的项，未知态拒绝删除。名称若微调须在实现复核前记录，语义不得变。Task `/cancel` 与 #83 的 `/attach`、`/paste`、`/open` 保留明确 NOT_IMPLEMENTED 帮助与错误，不能伪装完成。

只解析非纯文本模式、从键入斜杠开始的整次独立提交。粘贴节点、/send 字面载荷、消息中间、模型/工具输出均不递归解析。未知斜杠报错且保留，不自动转消息。除 /send 外：ASCII 空白分词，单双引号及引号/反斜杠转义；拒绝未闭合引号、错误/重复/多余参数、控制字符、换行串联和 shell 操作符。无 eval、shell、插值、管道、模糊目标或命令串联。/send 后余文全部字面化，包括分号、斜杠、引号与换行。

Main 普通提交冻结当前草稿发出；功能页普通文本/纯文本提交只保存并提示 /send。命令栏单独 `/send` 发送当前页草稿；带正文时是显式替换候选，若会覆盖已有非空草稿，显示新载荷并要求第二次显式提交，取消保留原稿，不能拼入隐藏旧草稿。普通编辑区 `/send 正文` 仅去前缀并发送显式正文/已加入附件 ID。无文字无附件拒绝。切页/选择/粘贴/补全不发送。冻结后继续输入形成新 revision，迟到回执不能清掉新稿。

别名只做固定名称映射，不带参数、不冲突、不扩大权限/作用域。补全覆盖适用命令、枚举、当前可见稳定 message/paste/outbox ID，最多 20 项并显示辨识信息；短 ID 唯一解析后固定目标并可见。C1 无路径参数，路径补全留 #83 复用注册表。Tab 即使补全 /quit 也不执行。

## 4. 持久状态、outbox 与清理

状态放所选 Core data/profile 下独立 `tui-v1/`，不写 Core Store。检查所有权和 symlink，目录 0700、文件 0600，不将 token 写草稿或日志。状态根采用内核 flock 与唯一写者 helper，进程死亡后释放；具体见 R2 实施约束。不得用遗留 PID 文件阻止正常崩溃恢复。按 `data_domain_id`、API version、mode 分区；instance_id 只表示连接世代。端点替换/重连/对账/发送前重新 attach 校验。跨域/API/mode 保留隔离草稿/outbox/cache/清理凭据，不自动迁移、重放或依新域删除；同域重启换 instance/token 可重新连接。

采用小型 fs 原子 manifest + 不可变正文/paste blobs。先 exclusive create 写 blob 并 fsync，再把完整带版本 manifest 写临时文件、fsync、rename、目录 fsync。串行写者一次提交草稿引用、outbox 和该精确 revision 的草稿交接；只有持久完成才允许 POST。写失败保留旧已提交状态并提示未保存/禁止发送。输入可先显示，但保存完成前明确未持久；不声称未刷盘按键抗掉电，正常退出等待保存。损坏文件保留报错，不自动 reset；启动检查 schema/hash/大小/引用/归属。逐一注入 blob、manifest、rename、清理崩溃，要求恢复旧或新完整状态且不丢唯一正文。

冻结 method、route、完整 JSON（request_id、原文、有序 attachment_ids）、序列化字节/hash、绑定、视图/revision。请求体全 JSON **1,048,576 UTF-8 字节**上限，同时检查 schema/text 限制，超限保留原稿不截断。C1 产品为文本发送；结构预留有序附件 ID/input 状态，不静默丢未来非空附件引用，不假装已有图片 UI。

状态：saved draft → durable PREPARED → SENT/UNKNOWN → RECEIVED（权威回执）→ 最小交接记录。断线/超时/崩溃不等于拒绝；未知项在原绑定 GET `/requests/{id}`。匹配回执证明接收，先持久回执/交接再释放正文；只有原绑定真正 NOT_FOUND 才可相同 ID/相同冻结请求重试。鉴权/网络/版本/域错误不是 NOT_FOUND。不得自动换 ID。明确前置拒绝保留可修改原文，原拒绝已确认后用户修改并显式提交才能成为新意图。冲突保留报错。重试串行，1–30 秒有界退避，每项至多一个在途，总并发 1；启动未知项自动对账，明确失败需显式重试/修改。

接收与业务终态分别展示。POST/动画不代表完成；显示 Input/message/session 权威排队/运行/完成/失败/未知。acceptance=ACCEPTED 即使 receipt.state=FAILED 仍是可靠接收，持久最小审计后可释放重复正文，历史留 Core；未知交接原文通过分页 /outbox 始终可达，不限首 50 项。

只删除已确认本 TUI 创建且处于受管根的 blobs，绝不删源文件；扫描所有草稿/outbox/域引用。回执持久后幂等清理，清理前 crash 重做。用户明确删除的无引用草稿片段可立即删；未知/在途 outbox 不可丢弃。其他孤儿/暂存默认从持久 created_at 起 **三个日历年**，记录时区（默认 Asia/Hong_Kong），2 月 29 日对应周年夹到 2 月 28 日，不用 1095 天。活跃/未知引用优先保护。中断 blob 有 created_at envelope；缺失/损坏来源保留待显式检查。不扩 Core 历史 GC。

默认容量：受管暂存总计 256 MiB、outbox 1,000 个未解决项、manifest 2 MiB、单编辑草稿 4 MiB；配置有限正值。计入旧新原子写入与 crash 残留，预留 manifest 替换和交接元数据空间。满额拒绝新编辑/粘贴/入队，保住旧稿，显示用量与显式清理方式；不驱逐受保护/保留期内孤儿。可丢读缓存独立 8 MiB，不含草稿/outbox 唯一正文。配额、磁盘满均实测。

## 5. 粘贴与显示安全

先按明确规则将终端交付的 CRLF/孤立 CR 转为 LF，其余正文包括 tab 保序，不 trim、不展开 tab、不补路径空格。行数与冻结载荷均使用该可见规范形式；不能宣称恢复 Terminal 已过滤的原剪贴板字节。多行折叠为带 opaque UUID/字节数/行数的 UI 节点；标签不进入正文，手打同标签只是文字。多次粘贴、插入、撤销、编辑/删除保序；展开编辑形成新持久 revision，copy/remove 绑定稳定 ID。必要时显式 copy 用固定 macOS 程序加独立参数/stdin，不经 shell；若原生复制足够则避免助手程序。不自动读取剪贴板或支持图片。只展开一次成为冻结正文，重试不重新读可变外部来源。

存储/请求正文与显示分开；显示时去除/中和不可信 C0/C1/ESC/CSI/OSC、双向控制字符，newline/tab 用受控布局。禁止文字改变标题/光标/剪贴板/链接；不修改冻结正文、不触发解析。测试转义分片、CJK、ZWJ emoji、marker 仿冒。

## 6. 同步、阅读与 CoT

SSE 流式 UTF-8 framing 支持分片码点/行、LF/CRLF、多行 data、注释、event/id、空行 dispatch。解码/单帧缓冲最多 512 KiB；异常/超限重新连接和持久追赶，不推进 cursor 或猜测跳过。校验 DTO/事件身份；只有 change 推进持久水位，transient/heartbeat 不推进。单一重连循环有界退避，退出可取消。

初始化/重建：绑定 → GET sync/cursor C0 → 读有界 Main snapshot/session → 从 C0 按 100 tx/页追赶，应用 invalidation 并刷新窗口 → 一致提交视图/水位 → 从已提交 cursor 开 SSE。异步 fetch 标记 generation，切页/域/instance 后忽略旧响应。快照重叠变化按权威刷新或稳定 revision 合并，不能倒退。事务整批应用，水位仅与相应 snapshot 或持久 pending invalidation/rebuild 标记一起落盘；刷新失败不能丢标记后推进。内存/已驱逐窗口冷启动必须重建，旧 cursor 不能代表缓存还在。RESYNC_REQUIRED 只重建派生缓存，保护草稿/outbox；具体 marker/snapshot 机制写测试。

transient 按 message_id/call_id 替换；durable 同身份接管，保留 event/message 锚点，不叠重复。expired/missing 不能证明没有 durable event：脱敏空 stop/tool-only 可有意省略。不虚构失败，不改 Core recovery policy。空失败/截断/部分回复沿用 #80 身份，不能污染上一条回答。

默认 thinking=false，显示服务端 20 grapheme thinking_preview；服务端已有 U+2026，可合法以换行+省略号结尾，客户端不重复附加或按 code unit 重截。`/cotvisible [message_id] [on|off]` 操作显式/选中稳定 ID，无选择报错；展开才 thinking=true，当前 transient 才 streaming=true。每次至多 4 片或 128 KiB，明确更多提示；/more 有界继续并让出输入；收起取消并隐藏全文。无内容/脱敏不虚构，不后台补全、不改模型参数。

最多 200 timeline rows / 2 MiB 可见正文、8 MiB LRU fragments；首屏 30、历史每页 50、单 loader，不无界串读。cache key 含绑定、instance、ID、revision、thinking/streaming、fragment cursor。instance 改变或 CURSOR_EXPIRED 失效分页 cursor，按 message_id/event_id `/timeline/around` 定位再有界读取。永久书签是视图+稳定 ID+grapheme/行偏移，不能是 cursor。流中保持阅读位置，显示新消息数，/latest 显式转最新；resize 从相同锚点重算。锚点缺失明确提示降级。

#80 graceful-stop fixture reopen RECOVERY_BLOCKED 是已记录事实；length 持久后 finish 前 crash 导致 replay Agent.continue 失败仍是未验证源码推断，留 #84。若实际阻塞 #82 硬 gate，保存首败交协调裁决窄范围增修，不擅自豁免或扩改。

## 7. 文件/API 与交付

新模块 `src/pi_secretary/src/tui/` 包括 entry/app、terminal/editor、commands、state/outbox、paste、sync、history/render/theme；测试 `test_case/offline/issue82/`；G0 探针在 `src/pi_secretary/scripts/`。增加交互 TTY-only `npm run tui`，无一次性 send 参数。C1 两种模式都只 attach，禁止自动调用 startCore，具体身份/错误/退出策略见 R2；不注册 core/stop，不向 Task child 传 owner token，不声称同账号强隔离。CoreClient 必须补 typed error/status、abort/bounds 与直接发送冻结 UTF-8 字节的 commandFrozen，保持既有调用兼容。

预计消费 10 项：GET core、session、requests/{id}、timeline、timeline/around、messages/{id}/content、sync/cursor、sync/changes、sync/stream；POST messages。活动基本信息来自 timeline/transient；仅实际有详情交互才加 activities/{id}。无新增 Core operation。`docs/tui/api-coverage.md` 保留当前全部 86 method/path，已用列实际 file/function，未用按原因明确；fixture 不算产品消费。更新需求状态、操作/键位说明；生成/本地化遵循既有脚本。

保留 #81 约束：K=0，后续 loop 只有认证元数据，再看像素要显式重发 ready attachment ID；预留有序 ID/input/withdraw 状态，不声称相邻自动看图或 #83 命令已完成。仅 PNG/标准 JPEG，MPF/HDR gain-map JPEG、HEIC 不支持，不静默转换。R1 已完成 docs/fix README 的 #81 PR87 已合并/main CI 通过与最终评论跟进，历史证据未改。

## 8. 顺序与验收矩阵

1. 双语计划、源码证据、同会话 Claude PASS、协调批准。
2. **G0 真实 Terminal.app/中文 IME 优先；不可执行/失败就停在门槛交协调，不铺开产品。**
3. 命令/草稿/paste、原子持久/outbox，先故障测试再 API 写入。
4. 接收对账、snapshot/SSE/cold start、有界历史/CoT。
5. 真实终端连接隔离 fixture Core，保留首败、修复和复验；维护 API/docs。
6. check、issue82 针对测试、相关 API/process/80/81 回归、docs/format、完整 npm run verify；必要 PostgreSQL 使用本项独有实例。平台无关测试纳入 Linux 全套，macOS workflow 纳入相关用例；Core Linux/macOS/verify 保留，Linux TUI NOT_TESTED。
7. PR 发布附本会话，同一 Claude 准确 HEAD 复核、实际 CI、协调单独准确 HEAD 合并授权；HEAD/base 变化重查。获准合并后核实 main CI 与实际退出条件。IME/终端未过不能以合并替代结项。

| 门槛 | 必要证据 |
| --- | --- |
| 输入/路由 | 真实 IME 候选确认不发送；换行/提交/宽字符/resize/选择/流中编辑；Main/Task/literal/send；独立草稿；大小写/作用域/参数/Tab 不执行；占位明确 |
| 粘贴/容量 | 多段、tabs/newlines、marker 仿冒/命令粘贴、edit/undo/remove/copy、JSON UTF-8/转义实际上限；超限保稿；三日历年/闰日、活跃未知引用、磁盘满拒收不驱逐 |
| outbox | POST 前后中断/丢回执、fsync/rename/交接/unlink crash、同 ID/同 bytes、冲突、无重复 Input、失败未知原文跨分页可达、源文件不删 |
| 身份 | 同域重启允许；跨域/API/mode 隔离；auth/unavailable 不当 NOT_FOUND；迟到回执不清新稿 |
| 同步/阅读 | SSE 分片/多行/合并/错误/超限；快照/追赶/事务应用中断；RESYNC_REQUIRED/缓存丢失；预览接管与省略边界；空失败归属；resize/restart/cursor expiry 锚点 |
| CoT/边界 | 默认 HTTP spy 无 thinking=true/隐藏全文；emoji/newline/ellipsis/control；显式限额展开/收起/more；取消旧响应；缓存/页数/输入响应 |
| 生命周期 | fixture Core PID/任务在 TUI 退出或 crash 后继续，无 core/stop；再 attach 恢复；既有 Core 不受影响 |
| 报告 | API 逐项消费/未用与位置；完整验证/CI/Claude 原始限制；源码、fixture、真实终端、provider、Master 体验分开 |

计划阶段未改业务、未装依赖、未跑 Core 测试/终端探针，只做源码/配置/库存读取及后续 docs-only 校验。原始英文请求、回复、截图、时间在 Git 忽略 `.demo-data/issue82-tui/review/`；脱敏结论在 [复核记录](evidence/issue82-tui/plan-review.md)。每次提交首次 10 分钟、后续每 5 分钟查看。账号或模型异常交 Master 决定是否 fallback Hermes，不能自行切换。

## 9. R2 明确实施约束（替代 R1 中未定机制）

Claude 对精确 R1 `78f9aa00fd3e8ef9a3982f4027a9daaa355ecc76` 给出 CHANGES_REQUIRED。以下九项全部采纳，并与英文 R2 对齐；依然仅计划，不能当 G0 或产品已通过。

1. **启动/连接**：C1 在 fixture/live 均只 attach，无自动启动。必填绝对 `--data` 与 `--mode fixture|live`，或显式绝对--config文件（位于Core data外，owner-owned/非symlink/0600）的同等配置；不取 cwd/.demo-data 默认值、不以进程环境猜 mode。头部/help 显示实际 profile/mode。结果区分 ATTACHED、STOPPED（仅端点缺席的非权威提示，显示“未运行或正在启动”）、UNREACHABLE（拒绝/超时/启动未完成）、IDENTITY_MISMATCH、MODE_MISMATCH、UNSAFE；TUI绝不打开/探测/获取Core owner.lock或其他Core数据文件，只读core-endpoint.json与自己的tui-v1子目录；缺端点本身不代表可启动。所有错误/wrong-mode 均测试零 spawn。提示独立 Core 生命周期命令，live 指向 npm run start:live；TUI 不读取 provider keys/DB URL，不调用 startCore。未来显式 fixture bootstrap 需另行批准。
2. **传输结果**：保留 HTTP status/code/v1 envelope/route/network failure，响应有界，支持 AbortSignal。commandFrozen 校验 hash 与 request_id 后逐字节发送冻结 JSON，不重新 stringify。有效 v1 202 且 ID/command=messages 匹配方可认证 POST 接收；GET requests 返回嵌套 receipt/result/resources，不能当裸 Receipt。原绑定重新 GET core 校验且路由可用的 GET requests/{id} 404+v1 JSON NOT_FOUND 才允许同 ID/bytes 重试。INVALID_REQUEST/INVALID_INPUT/INVALID_JSON/REQUEST_TOO_LARGE/UNSUPPORTED_MEDIA_TYPE 的预期 400/413/415，且没有更早未知尝试，才判明确前置拒绝；否则先对账。409 REQUEST_CONFLICT 保留隔离；401 重 attach 再对账；版本/mode/域/安全错误隔离；其余4xx、5xx、非JSON、abort/timeout/断线全部 UNKNOWN，不删正文。GET 回执无指纹：若原成功 POST ACK 丢失，先查询，再以相同冻结 bytes/ID 重入让 Core 校验指纹，成功匹配后才交接清理；“冲突响应丢失+GET同ID不同正文”必须负向测试。
3. **outbox**：每次 POST 前必须先 fsync attempted=true；只有 attempted=false 的 PREPARED 才可与 dispatcher 串行 discard，已经尝试且仍UNKNOWN的项即使 NOT_FOUND 也不据此删除可能仍在途的请求。每绑定持久 enqueue sequence FIFO，UNKNOWN 头阻塞后续。确定前置拒绝移为 NEEDS_EDIT 并保正文，可显式discard，明确提示后后续可继续；用户显式编辑提交才形成队尾新意图。1,000 上限只计未解决状态；完成最小回执移入 manifest 外分页归档，manifest 只留有界最近索引，归档字节仍计256MiB。created_at 三周年且清理已完成/无引用才可回收，未完成清理票据受保护，不能1000条成功后永久卡住。
4. **粘贴**：CRLF/CR→LF 是唯一预先规范化，tab等保留。G0 必须粘贴 ESC[201~+Ctrl+S/G/C、重复/嵌套结束标记、含控制码内容，记录真实字节和零动作。自有 Terminal adapter 在原始 stdin 进入 key dispatch 前处理粘贴；含结束标记同一raw chunk的后续控制码隔离，不执行。但这不是对任意分片的完备证明；若 Terminal 把嵌入结束标记/控制码作为可执行输入交付，**G0失败，停止产品实施**，交协调选择有证据的安全终端/协议或经审查的独立提交方案，不用时间启发式伪称解决。
5. **导航/复制/状态**：Ctrl+U/D 半屏滚动，PageUp/Down（Mac实际对应键）在G0验证，方向键编辑；/select <message_id> 明确选择，供无参CoT使用；Ctrl+Z/Y撤销/重做，Ctrl+O通过公开copyActiveSelectionToClipboard与固定callback显式复制当前app选区；无选区只提示不改剪贴板。固定输入状态始终显示视图、NORMAL/LITERAL/COMMAND、Main或“本地草稿；/send→Main”目标、SAVED/SAVING/ERROR。TuiAltScreen 固定 mouse=true、copyOnSelect=false、openUrl未设、无右键粘贴、无OSC52/OSC8。显式 /copy <message_id> [loaded] 通过固定 /usr/bin/pbcopy stdin复制，LANG/LC_CTYPE=en_US.UTF-8，不经shell；默认最多四片/128KiB且正文完整，否则不改剪贴板，解释显式loaded仅复制标识清楚的已加载片段。pasteblock copy最多4MiB。G0比较alt/main screen复制，布局仍须固定底部；重大renderer改变交协调。
6. **锁与退出**：参考既有 lock.py 模式新建小TUI helper，只有它持flock并写全部blobs/manifest/清理，不触Core journal/lock协议；Node父进程不越过helper写。固定路径/argv、最小环境、限长请求ACK pipe；解释器固定/usr/bin/python3（只读盘点3.9.6），G0记录路径/版本与fcntl可用，缺失明确报前置失败不自动装；helper在READY/持锁前忽略SIGHUP/SIGINT/SIGTERM/SIGTSTP，普通生命周期仅由stdinEOF或显式close结束；SIGKILL仍释放内核锁。父死stdinEOF，helper完成或失败当前事务后退出释放；helper死立即阻止后续写/POST。测试双开、父SIGKILL、helper kill、重启。ambiguous仅指unsafe路径/归属或不响应活锁持有者，不杀其进程。/quit、Ctrl+C、SIGINT、SIGHUP、SIGTERM、uncaught exception、unhandled rejection统一幂等关闭：停止接入/发送、abort网络、最多2秒flush、finally恢复bracketed paste/mouse/modifyOtherKeys/alt-screen/cursor/raw模式、关pipe。stop({preserveScreen:true})避免退出倾倒聊天；终端消失尽力恢复，未保存不冒称保存，SIGKILL仅恢复最后持久状态。窗口关闭纳入G0/Core继续运行测试。
7. **同步**：采用独立于draft/outbox manifest的view-checkpoint.json（≤64KiB），含≤2MiB body-only Main/session snapshot引用、binding/instance/timeline generation、最后完整应用cursor、dirty keys并集及各键dirty generation。唯一helper优先attempt/handoff和draft，checkpoint仅一个在途+一个可替换合并待办槽，500ms合并而非每SSE事务fsync。内存应用完整事务并保存最新cursor/dirty并集，不阻塞SSEreader/编辑；cursor+dirty原子持久后才准把刷新结果durably清dirty，fetch可先运行但ACK后按generation发布，更新失效保留。snapshot先fsync再small checkpoint，两者属独立8MiB可丢缓存。失败保持旧durable checkpoint/dirty义务并标stale；输入不等view进度，最多遇到已在途单次有界I/O。重连从durable checkpoint重放未落盘变化。接收队列最多256事务或2MiB，溢出断流并标stale，从durable水位追赶，不跳水位。必须测200tx/s持续30秒同时编辑发送、每fsync注入20ms：draft/attempt ACK从请求起≤500ms（不含autosave debounce），输入到render p95≤100ms/max≤250ms，checkpoint待办至多一个。真实Terminal fixture burst另记录延迟；失败属C1响应问题，不弃持久性或借机启动#70–74，不承诺任意坏盘/阻塞下时限。冷启动缓存只作stale/offline显示，始终新C0重建；逐出先持久标记absent/dirty再删除，RESYNC_REQUIRED只重建派生状态。timeline revision/generation仅同instance/generation内可比，绝不与SyncChange record revision比较。处理TIMELINE_RESET_REQUIRED 409、CURSOR_EXPIRED、TIMELINE_ITEM_NOT_FOUND 404，重定位或明确降级；不是请求NOT_FOUND。15秒无字节watchdog标stale重连，503 BUSY退避。SSEPreview.id映射message:<call_id>，但保留服务端实际ID/source_event_id，异常历史可为event_id；本地pending按request_id与durable行替换。
8. **草稿持续性补强**：typed body存blob，2MiB manifest只存元数据。150ms idle合并保存，连续输入最多1秒触发，仅一项在途；send/切页/quit前flush。undo最多20操作/512KiB替换文字；更大替换在应用前明确不可撤销提示。新revision持久且无draft/outbox/undo引用后，记录superseded_by票据，才可删除被用户编辑替换的旧逻辑draft存储副本；它不是每个按键新建的三年档案。无明确replacement/discard/handoff票据的真实孤儿仍三年，不因配额删。测试大稿反复编辑、undo引用、supersession前后crash。CoT/content每动作最多四片/128KiB已解码内容，单response另设1MiB wire cap且流式计数；实际baseline每text/thinking字段截为28,000 JSON bytes，导出FRAGMENT_BYTES不是实际字段cut；合并片调度前最多预留56,000解码UTF-8 bytes并计实际量，不能跨128KiB剩余预算。
9. **真实输入补充**：G0增加marked text/候选中Ctrl+S/G/C、Enter/Tab及LF/CRLF原始字节、鼠标滚轮/选择、窗口关闭。优先自有Terminal adapter实现pi-tui公开接口与raw输入framing，避开ProcessTerminal每个CR触发AppKit Shift探测/可选native clipboard；published renderer若不能适配则记录依赖交协调，不能悄悄加载。CR/LF/协商Shift+Enter都按换行。真实IME规则仍不降级。

其他采纳：/send必须精确为命令结束或后接单个ASCII空格，只剥离该一个分隔空格，其后空白保留；/sendx未知，/send后立即换行不作有效命令前缀。/cotvisible的on/off按枚举区分，其余必须稳定ID，可再跟on/off。空白预检遵守JS trim（含U+3000），只是本地建议，Core仍权威。InputState为ACCEPTED/CLAIMED/HANDLED/WITHDRAWN，与Receipt状态、Message.outcome独立标记，HANDLED不是回答成功。

跨域UNKNOWN保持保护，提供手工export/relocate文档而非自动丢弃：关闭TUI确认无锁持有者，复制整个自有client状态根至用户选定私有备份，校验hash/manifest/引用，然后把整个profile归档移出活跃配额目录。保留原ID/绑定/正文供未来对账，不标拒绝、不换ID重发、不动Core/源文件；C1不另做in-app abandon命令。

## 10. R3 复核修订与剩余门槛

Claude R2 精确复核7330c920d2d1ad1963969a9c38e2df9df7aa3e18，确认九项R1已解决，另提四项窄CHANGES_REQUIRED。R3全部采纳：STOPPED非权威且不碰Core锁；helper忽略终端进程组信号；独立small checkpoint合并低优先级写/有界reader队列/具体响应测试；Ctrl+O显式选区copy。上节对应机制已替换。

补充非阻塞意见亦采纳：G0用合成CJK/emoji验证pbcopy→pbpaste UTF-8往返；禁用内置altScreen search/next/previous/close、prompt-jump/top/bottom，仅配置约定page/half-page，Home/End回归editor、Ctrl+G不被search截走并实测有效键图。PTY hangup+queued save验证helper与ACK/未保存状态，不能当IME证据。Terminal Reset后立即输入/粘贴纳入G0，focus-in/redraw重设bracketed-paste等模式；若Reset后仍丢控制码来源，同样G0硬失败。真实G0仍NOT_TESTED。

有界内存undo在崩溃后可能留下其有界正文作真实孤儿，保留三年，除非存在明确持久supersession/discard票据。fixture/live均attach-only是协调待批准的RUN-01范围取舍，C1落地时明确写入requirements状态，不称已实现startCore复用。未扩业务或Core恢复范围，待R3复核与协调批准。

## 实施复核补充约定 — 2026-10-25

协调会话在产品 R1 对 `99f254f` 给出 CHANGES_REQUIRED 后，批准以下 R7 范围内修正。它们不改变 Core 生命周期、持久化所有权或以上历史证据。

- 字素边界使用完整文本 ICU 索引缓存与定位查询，可见窗口遍历不得截断 Unicode 上下文；RI 奇偶、任意长 combining/ZWJ 序列仍按全文处理。编辑、撤销/重做和鼠标选择都落在合法字素边界及折叠粘贴块之外。恢复仅能在正文、节点和哈希验证完成后，确定性修正旧版合法数值范围内的选择位置；不得放宽损坏正文、outbox 或 UNKNOWN 校验。
- canonical 状态未变的 paste begin/chunk ACK 不附带重复全量 snapshot。commit 保持冻结 revision/selection、5 秒事务期限与总草稿 4 MiB 上限。前后端空 paste/drop 均无操作；补全只能替换全部 typed-origin 的 token，触及 paste-origin 即无变更并提示，覆盖混合 token 和补全循环。
- 低优先级 checkpoint 先让出一轮调度，让已经排队的 ClientStore 事务进入 writer high 队列。合并 checkpoint 时保留最初入队时间；等待达到 250 ms 后，在下一操作边界获得一次派发，防止持续 high 导致饥饿。不打断当前操作，不改变 fsync→ACK 或 dirty obligation 先持久化的语义。测试同时验证业务优先顺序、checkpoint 进展、6000 个事务及最终 cursor/dirty 收敛。
- 仅 Darwin 的专用 writer helper 当前线程请求 `QOS_CLASS_USER_INITIATED`（0x19、相对优先级 0），对应用户正在等待持久化结果的工作；记录继承值、API 返回值与实际回读，失败明确报前置条件错误，不能伪报应用。Linux 不调用 Darwin API；不修改 Core、父进程或全机优先级。不允许 busy-wait、减少负载/注入延迟或放宽延迟和样本断言。该调度取舍针对已测得的 timer coalescing，最终仍以准确 CI 测量为准。
- 补充 combining/ZWJ/VS/RI/Hangul 编辑后的持久化重开、完整 Unicode 上下文边界比对、非空草稿经分块 ACK 粘贴至总量 4 MiB、1 MiB/近 4 MiB 按键耗时、补全来源和空粘贴的选择/undo 保留。每个已用 API 必须标明消费文件与函数。原生 OS/实体快捷键/Master 本人体验仍分别记录。


### Darwin 测试延迟校准 — 2026-10-25

第五轮 macOS 失败后，协调批准仅校准测试注入。该轮 emitted/current/durable 均到 6000、dirty 为空，但仅 17 次 attempt，draft/attempt ACK 最大 1299.18/1571.81 ms。真实 fsync 平均 0.209 ms，要求的 20 ms sleep 实际平均 89.522 ms、p95 166.350 ms。QoS 请求/回读成功不保证调度时限；原失败仍记为失败。

独立本机每组 60 样本对照表明，Python sleep、nanosleep、mach_wait_until 均有相似合并延迟。utility QoS 下普通 kqueue timer 平均 165.907 ms；单次 NOTE_CRITICAL timer 平均 20.110 ms、最小 20.030、最大 22.110 ms，总 CPU 3.291 ms。这支持校准注入方式，尚不证明 hosted runner 的性能，也不代表已归因全部 runner 延迟。

仅 responsiveness 测试生成的 Darwin helper 使用 `select.kqueue`、`EVFILT_TIMER`、`EV_ADD | EV_ONESHOT`、`NOTE_CRITICAL`（0x20）和 `data=20` 毫秒。阻塞等待单个事件，校验 ident/filter/数量/EV_ERROR，正常关闭队列，异常明确失败。Linux 仍为 `time.sleep(.020)`。生产 writer、既有 QoS 范围、真实 fsync、父进程和全局调度不变；禁止忙等、静默回退、重试取优、跳过、扣除超额时间或放宽断言。

每次注入以 monotonic_ns 测量，必须至少 20 ms；样本非空且与真实 fsync 一一对应。保留全部原始值和 method/platform/Python/CPU、min/mean/p95/max，CI 输出摘要。既有 6000/30 秒负载、至少 20 attempt、两项 ACK 500 ms、publication 100/250 ms、checkpoint 单槽、最终 cursor/durable 6000、dirty 为空及超时要求全部不变。新准确 HEAD 仍须通过真实 Linux/macOS CI 和同一 Claude 终审。

探针 SHA256：常规等待 `cf224f474fa26a5adac8bee701cd8e53fd2c9e96b6b930d38faf9772c5a652a2`；kqueue 对照 `8bc05384e32481531b2dd09cf2f0a5e6c0d2227c0d43c6ebf56d3822fdca9ae1`。依据：[Apple timer 标志及默认毫秒单位](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/event.h)、[filt_timerarm](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_event.c)。
