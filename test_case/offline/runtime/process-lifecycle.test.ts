import test from "node:test";
import assert from "node:assert/strict";
import { processHasExited } from "./helpers/process-lifecycle.ts";

const error = (code: string) => Object.assign(new Error(code), { code });
const present = () => true;

test("cleanup recognizes an exited Linux backend whose PID is still a zombie", () => {
  assert.equal(
    processHasExited(123, {
      platform: "linux",
      signal: present,
      // comm may contain both spaces and closing parentheses.
      readStat: () => "123 (node ) worker) Z 1 123 123 0",
    }),
    true,
  );
});

test("cleanup keeps waiting for live and stopped Linux backends", () => {
  for (const state of ["R", "S", "D", "T", "t", "I"])
    assert.equal(
      processHasExited(123, {
        platform: "linux",
        signal: present,
        readStat: () => `123 (node) ${state} 1 123 123 0`,
      }),
      false,
    );
});

test("cleanup accepts a PID disappearing between the signal probe and proc read", () => {
  assert.equal(
    processHasExited(123, {
      platform: "linux",
      signal: present,
      readStat: () => {
        throw error("ENOENT");
      },
    }),
    true,
  );
});

test("cleanup does not mistake permission failures for process exit", () => {
  assert.throws(
    () =>
      processHasExited(123, {
        signal: () => {
          throw error("EPERM");
        },
      }),
    { code: "EPERM" },
  );
  assert.throws(
    () =>
      processHasExited(123, {
        platform: "linux",
        signal: present,
        readStat: () => {
          throw error("EACCES");
        },
      }),
    { code: "EACCES" },
  );
});

test("cleanup uses signal existence on non-Linux hosts without reading proc", () => {
  const readStat = () => {
    throw new Error("proc must not be read");
  };
  assert.equal(
    processHasExited(123, { platform: "darwin", signal: present, readStat }),
    false,
  );
  assert.equal(
    processHasExited(123, {
      platform: "darwin",
      signal: () => {
        throw error("ESRCH");
      },
      readStat,
    }),
    true,
  );
});
