# TUI 颜色参数来源

Master 于 2026-10-23 要求仅保留旧 Tauri 的蓝、浅蓝和故障红，供后续 TUI 设计使用。本项不保留旧实现，不预先决定终端调色映射、布局或动效。

| 角色 | 默认主题 `.phaseui` | 深色主题 `.phaseui[data-theme="dark"]` |
| --- | --- | --- |
| 蓝 | `#285ea6` | `#79acd9` |
| 浅蓝 | `#8bbde0` | `#b1d5ec` |
| 故障红 | `#b84550` | `#ed8791` |

直接来源：[tokens.css 默认主题](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src/phaseui/tokens.css#L44) 与[深色主题](https://github.com/ExplodeCode6324/Secretary/blob/1e450d4f4c32d2376cd0d4451078048549bc5c58/src/secretary_desktop/src/phaseui/tokens.css#L78)，来源提交 `1e450d4f4c32d2376cd0d4451078048549bc5c58`。上游设计来源：[PhaseUI v1.0](https://github.com/ExplodeCode6324/secretary-phase-ui-design/blob/8cdb9219bed9493147ba10f7d47423df56cbcc44/UI-DESIGN.md)。

Green/wash 等其他 token 有意不继承。后续 TUI 采用简洁排版、命令导航，可有简单加载动效；不据此恢复 PhaseUI 客户端或复杂图标系统。
