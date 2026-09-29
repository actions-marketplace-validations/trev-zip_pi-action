import { chmodSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function createPiAgentDir(): string {
  const base = process.env.RUNNER_TEMP ?? tmpdir();
  mkdirSync(base, { recursive: true });
  const agentDir = mkdtempSync(path.join(base, "pi-action-"));
  chmodSync(agentDir, 0o700);
  return agentDir;
}
