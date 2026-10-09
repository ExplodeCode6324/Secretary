import type { CoreClient } from "../../../src/pi_secretary/src/core-client.ts";
export async function reconciled(
  client: CoreClient,
  requestID: string,
): Promise<any> {
  for (let i = 0; i < 500; i++) {
    const result: any = await client.query("requests/" + requestID);
    if (!["QUEUED", "RUNNING"].includes(result.receipt.state)) return result;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error("REQUEST_DID_NOT_SETTLE");
}
