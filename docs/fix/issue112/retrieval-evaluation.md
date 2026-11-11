# #112 fixed retrieval evaluation

Tokenizer, lexical weights and threshold were frozen in `2daba9d5d60971e91419268971b55e71c755e107`. Codex then authored and committed the 40 held-out queries and expected/forbidden IDs in `140fb551e1fcf24a4d912e102bca311c13fbce59` before their first execution. The queries reuse a synthetic 15-fact corpus; this is not independent test authorship. No weights or threshold were tuned on these results.

| Category | Passed | Precision@K | Recall@K | Mean UTF-8 bytes |
|---|---:|---:|---:|---:|
| name | 10/10 | 0.417 | 1.000 | 316.2 |
| ambiguity | 4/4 | 0.500 | 1.000 | 491.0 |
| paraphrase | 1/3 | 1.000 | 0.333 | 55.7 |
| cross_language | 3/3 | 1.000 | 1.000 | 159.3 |
| negation | 2/2 | 0.286 | 1.000 | 441.5 |
| history | 3/3 | 0.429 | 1.000 | 302.3 |
| time | 3/3 | 0.500 | 1.000 | 275.0 |
| conflict | 2/2 | 1.000 | 1.000 | 300.0 |
| onehop | 2/2 | 0.286 | 1.000 | 441.5 |
| empty | 8/8 | — | — | 0.0 |

K is the actual returned row count (maximum 12), and precision uses only the fixed expected IDs as relevant. Related extra rows lower precision even when valid. All hard gates pass: names ≥9/10; ambiguity 4/4; negation/history/time/conflict/one-hop all pass; empty ≥7/8; zero forbidden IDs; complete conflict/staleness labels; all byte/row limits respected. The 38/40 total includes two non-gating no-name paraphrase misses. This is lexical recall with approved labels/keywords, not general semantic retrieval.

The separately prepared 10,015-assertion synthetic index measured approximately 92–94 ms to build and 15–17 ms warm p95 over 30 calls on local macOS arm64. Process RSS was approximately 200 MiB, including the test runner and corpus; this is not an index-only heap estimate. CI repeats the 50 ms p95 gate and prints its own platform, architecture, index time and RSS. Exact CI results belong to the corresponding commit run.

Additional checks cover oversized conflict groups, a profile authority filter hiding one disputed member, resident empty role identities, Unicode/query caps, current-time validity, withdrawn provenance, frozen Main snapshots and before/after-commit process death. Role-header rendering was subsequently corrected without changing tokenizer/weights/threshold; the fixed held-out set is rerun unchanged.

Automated fixture/API/CLI acceptance is separate from real-provider behavior. A usable credential path was unavailable during this evaluation, so real-model citation/use acceptance is NOT_TESTED until that prerequisite is supplied. Native terminal gestures and Master’s final inspection are also not implied by these automated results.
