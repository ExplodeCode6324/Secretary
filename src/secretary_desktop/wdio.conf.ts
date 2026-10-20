import { resolve } from "node:path";
if (!process.env.BRIDGE_TEST) process.env.SECRETARY_STUDY = "1";
export const config = {
  runner: "local",
  specs: [
    process.env.NATIVE_SPEC ??
      (process.env.BRIDGE_TEST
        ? "./tests/bridge.native.ts"
        : process.env.STUDY_MANUAL
          ? "./tests/manual.native.ts"
          : "./tests/native.e2e.ts"),
  ],
  maxInstances: 1,
  capabilities: [
    {
      browserName: "tauri",
      "tauri:options": {
        application: resolve(
          "src-tauri/target/native-test/release/bundle/macos/Secretary Study Test.app/Contents/MacOS/secretary-desktop-spike",
        ),
      },
    },
  ],
  services: [
    [
      "@wdio/tauri-service",
      {
        driverProvider: "embedded",
        appBinaryPath: resolve(
          "src-tauri/target/native-test/release/bundle/macos/Secretary Study Test.app/Contents/MacOS/secretary-desktop-spike",
        ),
      },
    ],
  ],
  framework: "mocha",
  reporters: ["spec"],
  logLevel: "warn",
  mochaOpts: { timeout: process.env.NATIVE_SPEC ? 700000 : 120000 },
  connectionRetryTimeout: 60000,
  connectionRetryCount: 0,
};
