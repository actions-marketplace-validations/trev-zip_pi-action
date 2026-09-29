import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import * as core from "@actions/core";

import { errorMessage } from "../utils.ts";

export function loadPiAuth(auth: string | undefined, agentDir: string): void {
  if (!auth) {
    core.info("No pi auth was provided; using API keys from inputs and environment");
    return;
  }

  const authJson = formatPiAuthJson(decodeAuthSecret(auth));
  maskPiAuth(authJson);
  writePiAuthJson(agentDir, authJson);
  core.info(`Loaded pi auth for ${Object.keys(JSON.parse(authJson) as object).join(", ")}`);
}

export async function persistPiAuth(
  agentDir: string,
  previousAuth: string | undefined,
  updateAuthSecret: (value: string) => Promise<void>,
): Promise<void> {
  const authPath = path.join(agentDir, "auth.json");

  // Only persist credentials that came from the auth secret so a run never
  // stores keys that pi picked up some other way.
  if (!previousAuth || !existsSync(authPath)) {
    return;
  }

  try {
    const authJson = formatPiAuthJson(readFileSync(authPath, "utf8"));
    maskPiAuth(authJson);

    if (authJson === getPreviousAuthJson(previousAuth)) {
      core.info("pi auth did not change; repository secret update skipped");
      return;
    }

    await updateAuthSecret(encodeAuthSecret(authJson));
    core.info("Stored refreshed pi auth in repository secret");
  } catch (error) {
    core.warning(`Could not persist refreshed pi auth: ${errorMessage(error)}`);
  }
}

export function encodeAuthSecret(authJson: string): string {
  return Buffer.from(formatPiAuthJson(authJson), "utf8").toString("base64");
}

export function decodeAuthSecret(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error("auth secret is empty");
  }

  if (trimmed.startsWith("{")) {
    return trimmed;
  }

  return Buffer.from(trimmed, "base64").toString("utf8");
}

export function formatPiAuthJson(authJson: string): string {
  let parsed: unknown;

  try {
    parsed = JSON.parse(authJson);
  } catch {
    throw new Error("pi auth must be auth.json content or its base64 encoding");
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("pi auth.json must be a JSON object");
  }

  for (const [provider, credential] of Object.entries(parsed)) {
    const type = (credential as { type?: unknown } | null)?.type;

    if (type !== "api_key" && type !== "oauth") {
      throw new Error(`pi auth.json entry ${provider} must have type api_key or oauth`);
    }
  }

  return JSON.stringify(sortJsonValue(parsed));
}

function getPreviousAuthJson(auth: string): string | undefined {
  try {
    return formatPiAuthJson(decodeAuthSecret(auth));
  } catch {
    return undefined;
  }
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};

    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortJsonValue((value as Record<string, unknown>)[key]);
    }

    return sorted;
  }

  return value;
}

function maskPiAuth(authJson: string): void {
  core.setSecret(authJson);
  maskStrings(JSON.parse(authJson) as unknown);
}

function maskStrings(value: unknown): void {
  if (typeof value === "string") {
    // Short values such as "oauth" are metadata, and masking them would
    // redact unrelated log output.
    if (value.length >= 8) {
      core.setSecret(value);
    }
  } else if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) {
      maskStrings(child);
    }
  }
}

function writePiAuthJson(agentDir: string, authJson: string): void {
  mkdirSync(agentDir, { recursive: true });
  chmodSync(agentDir, 0o700);
  const authPath = path.join(agentDir, "auth.json");
  writeFileSync(authPath, authJson, { mode: 0o600 });
  chmodSync(authPath, 0o600);
}
