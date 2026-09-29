import { writeFileSync } from "node:fs";
import path from "node:path";

import * as core from "@actions/core";

import { MCP_CONFIG_ENV } from "./pi/extension.ts";
import { getServerUrl } from "./platforms/context.ts";
import { getPlatformMcp } from "./platforms/index.ts";
import { findArchiveExecutable, resolveCachedExecutable } from "./tool-archive.ts";
import type {
  McpReleaseAsset,
  McpServerConfig,
  Platform,
  PlatformClient,
  PlatformMcp,
} from "./types.ts";

export async function setupPiMcp(
  agentDir: string,
  platformClient: PlatformClient,
): Promise<Record<string, string>> {
  const executable = await resolveMcpExecutable(platformClient.mcp);
  const server = platformClient.mcp.createServerConfig(executable, getServerUrl());

  const configPath = path.join(agentDir, "pi-action-mcp.json");

  core.setSecret(platformClient.token);
  writeFileSync(configPath, `${JSON.stringify(buildPiMcpConfig(server), null, 2)}\n`, {
    mode: 0o600,
  });
  core.info(`Configured ${server.name} MCP server for pi`);

  // The MCP server inherits the token from pi's environment, which keeps it
  // out of the config file.
  return {
    [MCP_CONFIG_ENV]: configPath,
    [server.tokenEnvVar]: platformClient.token,
  };
}

export async function resolveMcpExecutable(platformMcp: PlatformMcp): Promise<string> {
  const override = platformMcp.getExecutableOverride();

  if (override) {
    return override;
  }

  const asset = platformMcp.getReleaseAsset();
  return resolveCachedExecutable(asset, platformMcp.getReleaseAssetUrl());
}

export function createMcpServerConfig(
  platform: Platform,
  executable: string,
  serverUrl: string,
): McpServerConfig {
  return getPlatformMcp(platform).createServerConfig(executable, serverUrl);
}

export function getMcpReleaseAsset(
  platform: Platform,
  nodePlatform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): McpReleaseAsset {
  return getPlatformMcp(platform).getReleaseAsset(nodePlatform, arch);
}

export function getMcpReleaseAssetUrl(
  platform: Platform,
  nodePlatform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  return getPlatformMcp(platform).getReleaseAssetUrl(nodePlatform, arch);
}

export function findMcpExecutable(directory: string, asset: McpReleaseAsset): string {
  return findArchiveExecutable(directory, asset);
}

export type PiMcpServerConfig = {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
};

export function buildPiMcpConfig(server: McpServerConfig): PiMcpServerConfig {
  return {
    name: server.name,
    command: server.command,
    args: server.args,
    env: server.env,
  };
}
