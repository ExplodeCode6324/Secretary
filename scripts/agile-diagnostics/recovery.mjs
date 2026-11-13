import { fail } from "./io.mjs";
/** Pure recovery policy; IO ports are supplied only by the capture CLI. */
export async function restoreUndeliveredStop(state, io) {
  if (await io.stopCommandsRunning()) fail("STOP_COMMAND_STILL_RUNNING");
  if (state.stop_command_outcome === "SUCCEEDED") return false;
  if (!(await io.originalCoreAlive()) || !(await io.originalEndpointAnswers()))
    return false;
  const marker = io.marker();
  if (
    !marker.owned ||
    !(marker.original || state.stop_command_outcome === "FAILED")
  )
    return false;
  io.removeOwnedMarker();
  state.stop_delivery = "STOP_NOT_DELIVERED";
  return true;
}
