/** Display-only settings that may survive the agile launcher's environment reset. */
export function visualEnvironment(env: NodeJS.ProcessEnv) {
  const allowed: NodeJS.ProcessEnv = {};
  for (const key of ["SECRETARY_TUI_SPLASH", "SECRETARY_TUI_MOTION"])
    if (env[key] === "on" || env[key] === "off") allowed[key] = env[key];
  if (["truecolor", "256", "none"].includes(env.SECRETARY_TUI_COLOR ?? ""))
    allowed.SECRETARY_TUI_COLOR = env.SECRETARY_TUI_COLOR;
  return allowed;
}

export function visualOptions(env: NodeJS.ProcessEnv = process.env) {
  return {
    splash: env.SECRETARY_TUI_SPLASH !== "off",
    motion: env.SECRETARY_TUI_MOTION !== "off",
  };
}
