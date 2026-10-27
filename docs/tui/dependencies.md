# Terminal client dependencies

The product uses the installed, lockfile-pinned `@earendil-works/pi-tui` **0.87.0** (MIT), from [earendil-works/pi](https://github.com/earendil-works/pi). The reference submodule `src/pi_resource` remains unchanged. The product imports `TuiAltScreen`, keybinding configuration, capability overrides, cursor marker and Unicode width/wrap/truncation utilities. It supplies its own `Terminal`, framing, clipboard, editor and lifecycle implementations; it never constructs `ProcessTerminal`, negotiates keyboard protocols, probes native modifiers or uses the library's OSC52 copy fallback. Mouse capture, image protocols and hyperlinks are disabled.

Node 22.19+ supplies fatal incremental UTF-8 decoding, grapheme segmentation, process streams and asynchronous clipboard subprocesses. `/usr/bin/python3` with `fcntl` runs the retained durable state writer. macOS clipboard uses fixed `/usr/bin/pbpaste` and `/usr/bin/pbcopy` with UTF-8 locale; Linux reports UNSUPPORTED. No new runtime dependency or Core API was introduced. Direct `ws` and `@types/ws` dependencies were removed with the browser listener.

`@xterm/headless` 5.5.0 is a test dependency only. PTY/headless evidence does not certify native IME, physical key delivery, fonts or emoji widths. See the [native acceptance runbook](terminal-acceptance.md).
