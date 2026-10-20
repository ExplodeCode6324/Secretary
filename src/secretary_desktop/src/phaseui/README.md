# PhaseUI component contract

Import presentation primitives from `./phaseui`; keep Core queries in Connected/Work and inject `BridgePort` for test fixtures. The geometry and masked SVG reconstruction originate from frozen `secretary-phase-ui-design` v1.0.0 (`8cdb921`). `tokens.css` is loaded only for production PhaseUI, never together with FE-00 study CSS.

| Primitive | Contract |
| --- | --- |
| Shell | name, page, navigate, connection, status snippet, children; owns theme, motion and responsive rail; page/state remains caller-owned |
| Button | native button attributes/callbacks; border/text/send variant, icon, primary; disabled is semantic; never waits for animation before callback |
| Icon / Avatar | static source plus an owned empty decoration layer; stable accessible identity, Unicode grapheme initial; no remote avatar requests |
| Field | native input/select/textarea children; real wrapper border, optional disabled; never inserts children into form controls |
| Divider | existing module edge or navigation separator; explicit lifecycle and orientation, no global DOM observer |
| Row / Filters | main content and metadata; selection via aria-pressed, no fabricated tab semantics |
| Dialog | native modal focus trap, Escape, close and origin focus restoration; caller owns open state |
| Status / Progress | idle/pending/success/error/offline/stale; determinate only when value exists; no infinite pending animation |

Connected keeps the editor and Work owner mounted while navigating. Conversation remains selectable; sender labels and role avatars use actual projections. Task results and approvals retain existing domain/revision guards. Empty destination slots are not fake business features.

Four consumer patterns are represented in the gallery: conversation identity + composer/send; task/status row + filters + detail dialog; settings fields/selects + confirmation; artifact metadata row + status banner. The gallery contains synthetic labels only and has no Core bridge.

## Motion ownership

Svelte owns semantic source DOM and each empty `[data-phase-layer]`. The controller may mutate only that layer plus reversible source visibility/classes. One effect record per control coalesces contact hover/focus/press, with no queued replay. Three discrete states start at 0%, 26.67%, 53.33%, and resolve at 80%. A/B/C durations are 160/180/200ms; small 140, identity 180, input/border 140, divider 150, send square 160 and arrow 420. Masks remove the original slice location. Cleanup cancels animations/timers and restores source on departure, blur, disable, mode change and unmount; scroll/resize cancel only divider effects.

BASE covers actual construction: glyphs, identity, real button/input boundaries, existing text-button underlines, selected navigation edges and structural separators. EXTENDED adds clipped left labels to the glyph record and keyboard/contact eligibility for the existing Attention/Settings separator. The separator shares a 0.25 gate, 700ms cooldown and global-one limit. Each approach/contact has one random attempt, including a miss. Production remains BASE. Reduced, OFF and outline restore intact sources and disable CSS animations/transitions; static focus/current/error states remain.

Tokens define document/sidebar surfaces, ink/muted/line/blue/light-blue/red/green, spacing, density and durations. Shell widths are 196/flex/270, 166/flex/230 at <=1100, collapsed rail48, overlay <=850, sidebar64/vertical brand <=600. Name truncation retains title/aria-label. The brand uses 22px for the longer Secretary default; narrow vertical uses20px. Right rail is a shared surface with three reserved groups.

## Diagnostics

`launch.rs` validates selectors before any real bridge is constructed. Gallery, normal-shell fixture harness and ordinary Connected are separate routes in the same Release. `phaseui_view` only accepts diagnostic launch and bounded width/zoom inputs. Native-test builds expose a controller test handle; ordinary Release does not. Reporting is opt-in and includes only synthetic metrics. Raw measurements and screenshots go under ignored `.demo-data/issue62`; the sanitized fix evidence records exact source/build provenance and untested limits.
