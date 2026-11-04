import type { Session } from "./contracts.ts";
import type { Session as SessionView } from "./api/contracts.ts";

/** A bounded, allowlisted notice; never expose arbitrary provider/local error text. */
export function sessionRecovery(
  session: Session,
): Pick<SessionView, "recovery_mode" | "recovery_message"> {
  if (session.state === "CAPACITY_BLOCKED")
    return {
      recovery_mode: "CAPACITY_COMPACTION_REQUIRED",
      recovery_message:
        "Main 已暂停：上下文容量不足，需要压缩；本次界面不提供压缩，/resume 不适用。",
    };
  if (session.state !== "RECOVERY_BLOCKED")
    return { recovery_mode: "NONE", recovery_message: "" };
  if (session.model_blocked_call)
    return {
      recovery_mode: "NEXT_MASTER_INPUT",
      recovery_message:
        "Main 已暂停：模型请求失败。下一条 Main 输入（包括重做或移除）会恢复原批次，也可手动 /resume；将继续调用模型。",
    };
  const reason = /CORE_STOPPING|CANCELLED|AbortError/.test(
    session.recovery_error ?? "",
  )
    ? "关闭或取消后停止"
    : /BUDGET_|MODEL_CALL_LIMIT/.test(session.recovery_error ?? "")
      ? "达到运行保护上限"
      : "本地处理中断";
  return {
    recovery_mode: "EXPLICIT_REQUIRED",
    recovery_message: `Main 已暂停：${reason}。已接收操作尚未执行；手动输入 /resume 后按 Shift+Enter 恢复原批次及排队输入，将继续调用模型。`,
  };
}
