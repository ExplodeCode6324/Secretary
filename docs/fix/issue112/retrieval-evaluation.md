# #112 fixed retrieval evaluation

Tokenizer, lexical weights and threshold were frozen in `2daba9d5d60971e91419268971b55e71c755e107`. Codex then authored and committed the 40 held-out queries and expected/forbidden IDs in `140fb551e1fcf24a4d912e102bca311c13fbce59` before their first execution. The queries reuse a synthetic 15-fact corpus; this is not independent test authorship. No weights or threshold were tuned on these results.

| Category | Passed | Precision@K | Recall@K | Mean UTF-8 bytes |
|---|---:|---:|---:|---:|
| name | 10/10 | 0.417 | 1.000 | 328.2 |
| ambiguity | 4/4 | 0.500 | 1.000 | 581.0 |
| paraphrase | 1/3 | 1.000 | 0.333 | 57.3 |
| cross_language | 3/3 | 1.000 | 1.000 | 164.3 |
| negation | 2/2 | 0.286 | 1.000 | 459.0 |
| history | 3/3 | 0.429 | 1.000 | 314.0 |
| time | 3/3 | 0.500 | 1.000 | 285.0 |
| conflict | 2/2 | 1.000 | 1.000 | 310.0 |
| onehop | 2/2 | 0.286 | 1.000 | 459.0 |
| empty | 8/8 | — | — | 0.0 |

K is the actual returned row count (maximum 12), and precision uses only the fixed expected IDs as relevant. Related extra rows lower precision even when valid. All hard gates pass: names ≥9/10; ambiguity 4/4; negation/history/time/conflict/one-hop all pass; empty ≥7/8; zero forbidden IDs; complete conflict/staleness labels; all byte/row limits respected. The 38/40 total includes two non-gating no-name paraphrase misses. This is lexical recall with approved labels/keywords, not general semantic retrieval. The three cross_language probes match Chinese keywords already in the fixture; they do not demonstrate translation or cross-language semantic retrieval. Git verifies the freeze/commit/execution order, not independent authorship or unseen probe design.

The separately prepared 10,015-assertion synthetic index measured approximately 92–94 ms to build and 15–17 ms warm p95 over 30 calls on local macOS arm64. Process RSS was approximately 200 MiB, including the test runner and corpus; this is not an index-only heap estimate. CI repeats the 50 ms p95 gate and prints its own platform, architecture, index time and RSS. Exact CI results belong to the corresponding commit run.

Additional checks cover oversized conflict groups, a profile authority filter hiding one disputed member, resident empty role identities, Unicode/query caps, current-time validity, withdrawn provenance, frozen Main snapshots and before/after-commit process death. Role-header rendering, explicit status/ambiguity labels and cached entity matchers were subsequently corrected without changing tokenizer/weights/threshold; the fixed held-out set is rerun unchanged. The table includes the reviewed rendering changes. An additional 10,007-entity / 10,015-fact fixture measured 6.27 seconds to construct the index and 35.9 ms warm p95 locally; process RSS was about 406 MiB. This broader-entity measurement is reported separately from the original fixed 50 ms fact-scale gate; cold construction remains a limitation. Legacy scope descriptions remain preserved as notes and may add lexical search noise.

Automated fixture/API/CLI acceptance is separate from real-provider behavior. The subsequent bounded DeepSeek acceptance on `def25575` passed fact use, full fact-ID citations, publication negation and alias recall after restart (two calls). A second synthetic scenario used one approval for one person and two preference assertions, then confirmed COMMITTED, both fact IDs and the negative preference, with no automatic Main wake or Settings rebuild. It used 14 physical calls; the initial one-assertion harness assumption and 12-call ceiling failures remain recorded. The same pending query resumed under a one-time total ceiling of 24. Tool descriptions now explicitly show the dollar-prefixed local reference and predicate-catalog lookup discovered during that run; final-source evidence is linked from PR #115. Native Terminal access was refused by the computer-use tool, so native gestures remain NOT_TESTED. Master's final inspection remains pending.
