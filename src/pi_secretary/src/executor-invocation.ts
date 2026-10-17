export function invocation(value: string) {
  return {
    invocationId: value,
    operationId: value,
    turnId: value,
    getMemo: async () => undefined,
    setMemo: async () => {
      throw Error("This adapter does not support replay memos");
    },
  };
}
