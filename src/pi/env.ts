export function createPiEnv(
  agentDir: string,
  extraEnv: Record<string, string> = {},
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    // Action inputs such as private keys should not reach the agent's shell.
    if (value !== undefined && !key.startsWith("INPUT_")) {
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
