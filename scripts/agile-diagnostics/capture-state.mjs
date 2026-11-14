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
    try {
      await save();
    } catch {
      state.state_write_failed = true;
    }
  }
  try {
    const prior = state.phase;
    state.recovering_from = prior;
    state.phase = "P4";
    try {
      await save();
    } catch {
      state.state_write_failed = true;
    }
    await a.recover(state);
    state.recovered = true;
    try {
      await save();
    } catch {
      state.state_write_failed = true;
    }
  } catch (e) {
    state.phase = "RECOVERY_FAILED";
    state.recovery_failure = /^[A-Z_]+$/.test(e.message)
      ? e.message
      : "RECOVERY_FAILED";
    try {
      await save();
    } catch {
      state.state_write_failed = true;
    }
    throw e;
  }
  if (error || state.state_write_failed) {
    state.phase = "FAILED";
    try {
      await save();
    } catch {
      state.state_write_failed = true;
    }
    throw error ?? Error("STATE_PERSISTENCE_FAILED");
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
