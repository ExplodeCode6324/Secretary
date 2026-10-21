# PhaseUI 视觉规范

[Current Frontend Spec](README.md)

唯一视觉来源为冻结 v1.0（`8cdb9219bed9493147ba10f7d47423df56cbcc44`）。以下规则将源码、真实原型与 Master R1 裁定对应；没有确定的细节先按 v1.0，不另造“现代化”替代设计。内容优先，目录、段落、表格和表单建立秩序；静态安静，交互局部显影。

## 布局与边界

以网页版为比例基准：正常三栏为左196px、中央 `minmax(0,1fr)`、右270px；1100px及以下切换左166px/右230px；右栏收起48px；850px及以下右栏默认收起，展开覆盖而不挤正文；600px及以下左栏64px、品牌竖排。连续调整窗口宽度时，中部吸收变化，两侧在同一档位保持不变；窄屏按上述断点适配。

左右侧栏通顶通底，以色块分隔，不套卡片。左栏选中行使用中央主体底色，并实际中断对应竖边线，使目录融入正文。右栏的正在进行、近期产物、快捷操作组成一个整体；未实现内容保留空位。结构线尽量接到所属模块边缘，文字靠内边距对齐，少用内缩短线；不跨越无关栏目。

[layout + breakpoints](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/style.css#L2221) · [selected row](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/style.css#L1997) · [edge rules](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/style.css#L2308)

标题块底部全宽横线与左栏“对话”行底边对齐：共享顶部总高188px，≤600px为183px，工具栏76/64px；适用于所有断点及14–18px字号。非发送错误和阅读提示放在横线下方，发送提示在输入框下方。应用设置 light/dark color-scheme，滚动条轨道使用正文背景。

## 颜色与文字

以下数值来自 v1.0 最终主题规则。状态颜色直接沿用 v1.0 选择器和语义，不能只读文件头 token 后另配状态色；颜色伴随文字，装饰双色不表示业务完成。

| Token / surface | Light | Dark |
| --- | --- | --- |
| document | `#fffcf6` | `#000000` |
| sidebar | `#f5f2ea` | `#141414` |
| `--ink` | `#262b31` | `#e0e4e8` |
| `--muted` | `#686b6e` | `#a1a9b2` |
| `--line` | `#cec9bf` | `#363636` |
| `--blue` | `#285ea6` | `#79acd9` |
| `--light-blue` | `#8bbde0` | `#b1d5ec` |
| `--red` | `#b84550` | `#ed8791` |
| `--green` | `#42715a` | `#92bfa3` |

按 Master 2026-10-22 裁定：UI、品牌和时间使用 Noto Sans，会话正文与编辑器使用 Noto Serif；中文回退 Noto Sans SC（Noto Sans CJK 简体成员），再回退 PingFang SC、Apple Color Emoji 与通用字体。代码块和行内代码保持系统等宽字体。基准14px、行高1.65。字体及 OFL 随应用离线打包，不运行时下载；拉丁字体 normal/italic 与 CJK normal 使用100–900可变字重，禁止合成字体。品牌为普通黑色文字，深色模式使用浅色语义文字色，静态和动效均无彩色错边；无容器框。助手名来自配置，空白回退 `Secretary`，长名截断保留全文访问。头像尺寸与语义不变。

[base tokens](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/style.css#L1) · [dark theme](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/style.css#L1679) · [brand](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/style.css#L2350) · [identity()](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/signal-motion.js#L537)

## 动效与页面来源

三层是显示组成：带真实缺口的重构底层、局部裁片、少量双色残像；三帧是时间上的不同离散状态。移走的源片段原位置必须留空，不能以完整图标叠彩边替代。第二帧反向换区，第三帧收窄减量；0%、26.67%、53.33%显影，80%恢复。源几何、排版、命中范围固定；禁止全屏 RGB、伪日志、弹跳或泛化缩放旋转。

| Object | v1.0 duration |
| --- | --- |
| Icon A / B / C | 160 / 180 / 200 ms |
| Small icon | 140 ms |
| Brand / avatar | 180 ms |
| Send square / arrow | 160 / 420 ms |
| Composer boundary / separator | 140 / 150 ms |

发送箭头420ms投射是指定例外。按 Master 2026-10-22 裁定，分隔线150ms三帧分别重构2/2/3个短段，每段 min(14px, 可见线长×0.035)，位置依次22%/62%、42%/76%、15%/55%/61%，方向依次下/上、上/下、下/上/下，幅度1.5px。竖线对应左右错位并避开选中行留白。源段移走留真缺口，不画彩色残影；参数集中定义。每次接触25%概率、700ms冷却、全页最多一处，不后台循环。

[geometry](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/prototype.js#L1) · [plan / mask](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/signal-motion.js#L5) · [three frames](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/signal-motion.js#L204) · [controller](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/signal-motion.js#L312) · [separators](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/signal-motion.js#L694) · [gallery](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/prototype.js#L334)

对话采用日期线、头像/姓名/时间与段落；任务采用表格和行内展开；产物采用文件名与相邻元信息；记忆采用摘要与记录分组；待处理分开决定和授权；设置先草稿再复核。以下冻结代码和图片是具体构造/分镜来源，概念图不覆盖最终代码。

[conversation / pages](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/prototype.js#L268) · [activity rail](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/prototype.js#L247) · [dialog](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/prototype.js#L355) · [dark screenshot](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/preview/v1.0/dark.png) · [release evidence](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/preview/v1.0/VALIDATION.md) · [component behavior](components-and-states.md)
