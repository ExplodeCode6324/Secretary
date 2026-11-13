/** Pure orchestration: tests cannot construct real command adapters here. */
export async function captureFlow(a, state, save) {
  let error;
  try {
    state.phase = "PREPARING";
    await save();
    await a.prepare(state);
    state.phase = "P0";
    await save();
    await a.holdMaintenance(state);
    await save();
    await a.settle(state);
    await a.quiescence(state);
    state.phase = "P1";
    state.stop_requested_at = new Date().toISOString();
    await save();
    await a.stopAndLock(state);
    await save();
    state.phase = "P2";
    await save();
    await a.exportDatabase(state);
    state.phase = "P3";
    await save();
    await a.copyAndSeal(state);
    state.copied = true;
    await save();
  } catch (e) {
    error = e;
    state.failure =
      e.code ?? (/^[A-Z_]+$/.test(e.message) ? e.message : "CAPTURE_FAILED");
    await save();
  }
  try {
    const prior = state.phase;
    state.recovering_from = prior;
    state.phase = "P4";
    await save();
    await a.recover(state);
    state.recovered = true;
    await save();
  } catch (e) {
    state.phase = "RECOVERY_FAILED";
    state.recovery_failure = /^[A-Z_]+$/.test(e.message)
      ? e.message
      : "RECOVERY_FAILED";
    await save();
    throw e;
  }
  if (error) {
    state.phase = "FAILED";
    await save();
    throw error;
  }
  state.phase = "VERIFY";
  await save();
  try {
    await a.verify(state);
    state.phase = "COMPLETE";
    await save();
  } catch (e) {
    state.phase = "FAILED_VERIFICATION";
    state.failure = /^[A-Z_]+$/.test(e.message) ? e.message : "VERIFY_FAILED";
    await save();
    throw e;
  }
  return state;
}
