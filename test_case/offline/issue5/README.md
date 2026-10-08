# Issue 5 offline regressions

Run from the repository root with `npm run test:issue5`.

Every case uses a fresh temporary Store and a synthetic stream adapter. No
database, network, paid provider, deployed data or helper-loss experiment is used.
These tests validate host behavior and actual main-stream request contents;
they do not evaluate model memory quality.

The suite covers:

- Empty extraction after prior compaction: settings apply, preserve the existing
  commitment and dispatch no duplicate extraction, including after restart.
- Original historical Master text survives settings, later context compaction,
  restart, repeated projection and two actual provider-bound stream calls. A
  deliberately generic fixture summary cannot supply the missing text.
- Actual multi-tool continuation remains paired and fits the request budget.
- Empty and nonempty mismatching extraction evidence fail before model dispatch.
- Tightened capacity after a same-configuration restart blocks main dispatch
  while retaining oversized history. Tightening the synthetic model object
  avoids confusing the separate runtime-settings migration gate with this gate.
- Existing unmarked history is authenticated, while a copied wrapper with a
  forged timestamp does not gain mandatory retention.
- Corrupted frozen anchor text or Input identity fails closed.
- A legacy persisted crop mapping that omitted authenticated history cannot
  silently drop it from an actual stream request after upgrade and restart.

Original failures, review iterations, environment limitations and hashes are
recorded under [the public review summary](../../reports/memory-review-20261008/README.md); original QA evidence stays in the local audit archive.
