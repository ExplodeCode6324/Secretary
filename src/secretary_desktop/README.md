# Secretary desktop · FE-00 / FE-01

macOS Tauri 2 / Svelte desktop. Normal launch opens the FE-01 Core bridge described below. The FE-00 study (`SECRETARY_STUDY=1`) uses synthetic messages and does not connect to Core. Linux is deferred by Master and is not a gate for this frontend roadmap. Existing Core Linux checks are independent.

## Run

Requires macOS, Xcode command-line tools, Node 22.22+, and Rust 1.97.1 (`rustup`, see rust-toolchain.toml). From this directory:

```sh
export PATH="$HOME/.cargo/bin:$PATH"
npm ci
npm run check
npm test
npm run tauri -- build
open 'src-tauri/target/release/bundle/macos/Secretary Study.app'
```

`npm run tauri -- dev` uses a local Vite development server. Ordinary Release embeds static assets and opens no listening server. In study mode, Rust exposes a whitelisted study configuration, a one-time ready marker, and bounded JSON metrics to its own stdout when explicitly launched by the measurement harness. The ordinary UI has no recurring frame sampler or telemetry IPC; instrumented streaming and the native-test build enable frame sampling. No Core tokens, file access, shell execution, external navigation or remote assets are available to the page. Capability permissions are scoped to `main`: zoom those three measurement commands, and the restricted FE-01 bridge commands.

Use **验证工具** at the bottom of the directory for fixtures, streaming, frame-by-frame replay, reduced motion, full-DOM baseline, and native WebView zoom. The default reading view recycles offscreen message contents. Starting text selection retains document contents until selection clears; this intentionally trades selection-time memory for native cross-message selection. Full-DOM baseline is a separate comparison mode. It is not evidence that recycling passed.

Code blocks are plain pre/code without syntax highlighting. Markdown disables raw HTML, images, and clickable links. The stream updates the growing message rather than rebuilding historical messages. During document selection its displayed projection freezes while data continues arriving; clearing selection catches up. Closing the window affects only this spike.

## Native automation and evidence

The `native-test` Rust feature and separate Tauri configuration add the embedded WDIO server only to a test binary in `target/native-test`. Never use that binary for resource baselines or distribution. Build with `npm run build:native` (Rust on PATH), then run `npm run test:native`. `npm run test:native` tests WKWebView, not Chrome. Synthetic keyboard/composition tests are labeled as such and never replace system IME tests.

`npm run evidence -- window|selection|phase|motion|security` creates an immutable run directory under repository `.demo-data/issue58/runs/`. `npm run evidence -- ime` creates a NOT_TESTED record until the native manual cases below are performed. The window/selection/phase/motion aliases run the complete native suite, with the requested focus recorded separately in invocation.json; they do not claim an isolated manual case. A successful script is not automatically a product GO; read the case status and the acceptance report.

## Manual Mac acceptance

Run the ordinary Release, record binary SHA and native window owner PID. Capture only the study window, not personal desktop contents. Screen capture may require the existing macOS screen-recording permission.

- Window: close/reopen, minimize/restore, drag, narrow/wide resize. Tab/Shift-Tab and mouse must reach the input and buttons. At 100/125/150/200% WebView zoom, paragraphs and controls remain usable; code can scroll horizontally.
- Real IME: select the system Pinyin input source, use the fixed text `中文，English。` and repeat each case three times: Enter confirms a candidate, Space selects, Escape cancels, click Send during composition, switch windows during composition, confirm then quickly press an independent Enter, compose while stream runs. Candidate confirmation/cancellation/focus loss must not send. A committed independent send must preserve the exact text and occur once. The recent-events panel records event order and decisions. Export/capture logs with only synthetic text.
- Selection: load 1,000 records, drag from message 10 to 900 and in reverse, including long code; copy/paste into a plain-text editor and compare with the document text. Test body Cmd+A separately from textarea Cmd+A, selection during 5 seconds of streaming, and selection across insertion of 200 previous messages. No silent truncation or focus/scroll takeover.
- Phase: capture frame 0 and frames 1/2/3, plus natural playback. The three horizontal slices use the same path and move independently. Input text, caret and hit areas stay fixed. Master evaluates the actual window.
- Reduced motion: while paused at frame 2 or playing, enable the application switch and then separately the system Reduce Motion option. Both restore the intact neutral icon, with stable focus/layout.

For an observing-only recorder, use `STUDY_MANUAL=1 npm run test:native`; operate the real system IME and window yourself. It records native events without synthesizing composition and stops after ten minutes. Confirm the input source by observing Chinese candidate commit before counting a run; English autocorrection is not IME evidence.

A missing manual result stays NOT_TESTED. Master visual approval cannot be supplied by automation.

## Measure ordinary Release

```sh
npm run measure -- --scenario startup --rounds 10
npm run measure -- --scenario idle
npm run measure -- --scenario stream
npm run measure -- --scenario idle --uninstrumented
npm run measure -- --scenario stream --baseline
```

The harness starts only its own binary and terminates only the process it created. It writes an immutable `index.json`, CPU/RSS samples and UI summaries. Startup: first launch plus ten warm launches, monotonic spawn-to-ready including marker delivery. Idle: 30 seconds settling + 60 seconds sampling. Stream: nominal 20 updates/s for 1,200 updates; wait for actual completion and queue drain, then observe 30 seconds recovery (180-second total deadline; insufficient recovery fails even if updates finish). The harness temporarily prevents sleep with caffeinate scoped to its app PID; it restores this condition on exit. Instrumented runs include 1Hz metrics IPC and streaming frame sampling; the reporting-off idle control disables both; input bookkeeping and a periodic callback remain. Full-DOM baseline retains all message markup with content-visibility; it is a separate comparison. CPU is cumulative user/kernel time difference; 100% means one logical CPU. PID identity uses launch time, with appearance/exit records; CPU deltas are discarded across identity changes. Sampler wall time and unavailable refresh/thermal fields are explicit. WebKit XPC candidates and preexisting shared processes are separate, not falsely attributed via the parent PID. RSS sums can double-count shared memory. Capture footage separately from performance sampling.

See the repository `docs/fix/` plan and `docs/fix/evidence/issue58-feasibility/summary.md` for exact results and remaining gates. No Linux desktop result is claimed.

## FE-01 原生 Core 桥（macOS）

正常启动显示真实连接界面；`SECRETARY_STUDY=1` 保留 FE-00 合成 study，二者证据分开。
WebView 只有具名 `bridge_*` 命令，无 Core token、通用文件、URL 或 shell IPC。

在 macOS 应用数据目录 `~/Library/Application Support/dev.secretary.study/` 创建 `profiles.json`，目录 0700、文件 0600。例如（替换为你的绝对路径）：

```json
[{"id":"local-fixture","data_dir":"/absolute/private/fixture-core","expected_mode":"fixture","node_abs":"/absolute/bin/node","core_root":"/absolute/Secretary","backend_entry":"/absolute/Secretary/src/pi_secretary/src/backend.ts"}]
```

先在 core_root 执行 `npm ci`。原生 start 固定启动 fixture backend，cwd/SECRETARY_DATA/SECRETARY_MODE 显式设置；Finder 启动不依赖 shell cwd/PATH。live 配置使用 `expected_mode: "live"`，先按 Core 运行手册启动 live wrapper，再附着。关闭客户端不会停止 Core，停止须单独确认。不存在配置或权限不符会显示错误；不会猜测其它数据目录。

更换 data_domain 时创建新的 profile ID 并重启客户端，旧 profile 库和未解决命令保留；不需删除旧库。

每个 profile 有独立 `client.sqlite`（WAL/FULL，schema version 1）。草稿、阅读锚点、原始命令与回执均保存在原生库，token 不落盘。一次事务完成“保存 outbox + 清除对应版本草稿”；发送失败先查 receipt，同 ID 同内容重投。`ACCEPTED` 只代表受理，业务结果继续看关联投影。UNKNOWN、已受理回执丢失、认证/数据域冲突阻断自动重发。stop 绑定当前实例且不自动补发。

缓存只保存最多 16 个订阅窗口，切换订阅原子清理旧投影；读取下一页的临时返回值不累计到持久缓存。每次 change 刷新当前订阅，数据和 applied cursor 同事务提交；串行刷新避免旧请求覆盖新状态。SSE 有界队列溢出断开，由同一 sync/changes 路径从持久水位追赶；transient 只在内存保留最新快照。预算：缓存 64 MiB/10,000 项，单响应 2 MiB，同步队列 512 KiB，命令 1 MiB，outbox 1,000 项/32 MiB，草稿 16 MiB，下载 256 MiB。达到意图配额保留草稿并报错；受理记录保留 30 天，未解决记录不自动删除。

类型/操作表由现有 API schema 生成：`npm run contracts:generate` / `npm run contracts:check`。固定白名单见 `scripts/bridge-operations.json`，默认排除 admin/push、设置与 scope 写操作；扩展桥需同时扩展明确操作子集与回归。

验证入口：

```sh
npm run contracts:check
npm run check && npm test
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
npm run build:native
node scripts/bridge-fixture.mjs
SECRETARY_DESKTOP_TEST_DATA=/absolute/Secretary/.demo-data/issue59-native BRIDGE_TEST=1 npm run test:native
```

Rust 集成测试启动真实 fixture Core、HTTP/SSE 和持久 Store；SIGKILL 子测试是父测试主动运行的 worker，单独标为 ignored 不表示强杀验收跳过。原生测试使用隔离 profiles；release 不识别测试配置覆盖、不包含 WDIO 插件。Linux 桌面仍为 NOT_TESTED；Core Linux CI 不变。

草稿落盘使用独立 SQLite 连接，不被网络同步锁阻塞。命令列表快照最多 50 项、正文只预览 2048 字符；完整原始意图仍在数据库中。每 profile 投递文件锁由 OS 在退出/崩溃时释放。

FE-01 当前边界：草稿写入独立于网络锁；发送和快照仍与同步串行，Core 无响应时可能等待一次请求超时（10 秒）。快照返回活动窗口完整投影，FE-02 应按页面选择窗口，避免大窗口频繁整体渲染。超过 64 KiB 的回执只持久保存摘要，完整信息可经统一桥查询 `requests/{id}`；当前验证界面没有专用完整回执视图。SYNCED 表示持久数据追平，不代表 transient 预览通道持续在线。
