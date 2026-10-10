import { EXCLUDE_TOOLS_ENV, FILE_ROOT_ENV, SECRET_ENV_ENV } from "./extension.ts";

export function createPiEnv(
  agentDir: string,
  extraEnv: Record<string, string> = {},
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    // Action inputs such as private keys, and the runner's own credentials
    // such as ACTIONS_RUNTIME_TOKEN, should not reach the agent's shell.
    if (value !== undefined && !key.startsWith("INPUT_") && !key.startsWith("ACTIONS_")) {
      env[key] = value;
    }
  }

  env.PI_CODING_AGENT_DIR = agentDir;
  env.PI_SKIP_VERSION_CHECK = "1";
  env.PI_TELEMETRY = "0";
  env.NO_COLOR = "1";
  env.npm_config_loglevel = "error";
  Object.assign(env, extraEnv);
  return env;
}

export function createPiToolEnv(
  workspace: string,
  excludeTools: string[],
  secretEnv: Record<string, string>,
): Record<string, string> {
  return {
    ...secretEnv,
    [SECRET_ENV_ENV]: Object.keys(secretEnv).join(","),
    [FILE_ROOT_ENV]: workspace,
    [EXCLUDE_TOOLS_ENV]: excludeTools.join(","),
  };
}
