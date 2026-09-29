import { generateKeyPairSync, verify as verifySignature } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test, vi } from "vitest";

import { buildAuthenticatedRemoteUrl, buildCredentialIsolationGitArgs } from "../src/git.ts";
import {
  parseOptionalBoolean,
  parseOptionalString,
  parseThinkingLevel,
  resolvePromptInput,
  validateActionAuthentication,
  validateProviderInputs,
  validateSecretName,
} from "../src/inputs.ts";
import {
  buildPiMcpConfig,
  createMcpServerConfig,
  getMcpReleaseAsset,
  getMcpReleaseAssetUrl,
} from "../src/mcp.ts";
import {
  decodeAuthSecret,
  encodeAuthSecret,
  formatPiAuthJson,
  loadPiAuth,
  persistPiAuth,
} from "../src/pi/auth.ts";
import {
  findPiExecutable,
  getPiReleaseAsset,
  getPiReleaseAssetUrl,
  getPiTarget,
  getPiToolArchiveAsset,
  PI_VERSION,
} from "../src/pi/binary.ts";
import {
  buildPiModelsConfig,
  createPiProviderEnv,
  getPiModelSelection,
  PI_API_KEY_ENV,
  setupPiModels,
} from "../src/pi/config.ts";
import { createPiEnv } from "../src/pi/env.ts";
import { PI_ACTION_EXTENSION, SUBMIT_RESULT_TOOL } from "../src/pi/extension.ts";
import { buildPrompt, formatPiPullRequestComment } from "../src/pi/prompt.ts";
import {
  buildPiArgs,
  createPiStreamState,
  getPiRunMetadata,
  handlePiOutputLine,
} from "../src/pi/runner.ts";
import {
  buildGitHubNoreplyEmail,
  createGitHubAppJwt,
  detectPlatform,
  getGitHubAppBotLogin,
  getGitHubActionsBotUser,
  GITHUB_APP_INSTALLATION_PERMISSIONS,
  isGitHubAppInstallationUserError,
  normalizePrivateKey,
} from "../src/platforms/index.ts";
import { getToolArchiveCacheKey, getToolArchiveCachePaths } from "../src/tool-archive.ts";

describe("inputs", () => {
  test("validates auth secret names", () => {
    expect(validateSecretName("PI_ACTION_AUTH")).toBe("PI_ACTION_AUTH");
    expect(validateSecretName("pi_action_auth")).toBe("pi_action_auth");
    expect(() => validateSecretName("1PI")).toThrow(/auth-secret/);
    expect(() => validateSecretName("GITHUB_TOKEN")).toThrow(/GITHUB_/);
  });

  test("parses optional boolean inputs", () => {
    expect(parseOptionalBoolean("", "automerge")).toBeUndefined();
    expect(parseOptionalBoolean("true", "automerge")).toBe(true);
    expect(parseOptionalBoolean("yes", "dry-run")).toBe(true);
    expect(parseOptionalBoolean("OFF", "automerge")).toBe(false);
    expect(() => parseOptionalBoolean("maybe", "dry-run")).toThrow(/dry-run/);
  });

  test("parses optional string inputs", () => {
    expect(parseOptionalString("")).toBeUndefined();
    expect(parseOptionalString("  claude-sonnet-5  ")).toBe("claude-sonnet-5");
  });

  test("parses thinking levels", () => {
    expect(parseThinkingLevel("")).toBeUndefined();
    expect(parseThinkingLevel(" High ")).toBe("high");
    expect(() => parseThinkingLevel("extreme")).toThrow(/thinking must be one of/);
  });

  test("validates action authentication inputs", () => {
    expect(() => validateActionAuthentication("token", undefined, undefined)).not.toThrow();
    expect(() => validateActionAuthentication(undefined, "client", "key")).not.toThrow();
    expect(() => validateActionAuthentication(undefined, undefined, undefined)).toThrow(/token/);
    expect(() => validateActionAuthentication("token", "client", "key")).toThrow(/either token/);
    expect(() => validateActionAuthentication(undefined, "client", undefined)).toThrow(/together/);
  });

  test("validates provider inputs", () => {
    expect(() =>
      validateProviderInputs(undefined, "gpt-5", "http://localhost:8317/v1", undefined, "key"),
    ).not.toThrow();
    expect(() =>
      validateProviderInputs("anthropic", undefined, undefined, undefined, "key"),
    ).not.toThrow();
    expect(() =>
      validateProviderInputs(undefined, undefined, "http://localhost/v1", undefined, undefined),
    ).toThrow(/model is required/);
    expect(() =>
      validateProviderInputs(undefined, "gpt-5", undefined, "openai-completions", undefined),
    ).toThrow(/api requires base-url/);
    expect(() => validateProviderInputs(undefined, "gpt-5", undefined, undefined, "key")).toThrow(
      /provider is required/,
    );
  });

  test("resolves prompt file paths", () => {
    const directory = createTempDirectory();
    writeFileSync(path.join(directory, "prompt.txt"), "from file");

    expect(resolvePromptInput("prompt.txt", directory)).toBe("from file");
    expect(resolvePromptInput("literal prompt", directory)).toBe("literal prompt");
  });
});

describe("pi auth", () => {
  test("encodes and decodes auth secret values", () => {
    const authJson = JSON.stringify({ anthropic: { type: "api_key", key: "sk-ant-secret" } });
    const encoded = encodeAuthSecret(authJson);

    expect(decodeAuthSecret(encoded)).toBe(formatPiAuthJson(authJson));
    expect(decodeAuthSecret(authJson)).toBe(authJson);
    expect(() => decodeAuthSecret("")).toThrow(/empty/);
  });

  test("formats pi auth JSON consistently", () => {
    expect(
      formatPiAuthJson(
        '{"openai-codex":{"type":"oauth","refresh":"r","access":"a","expires":1},"anthropic":{"type":"api_key","key":"k"}}',
      ),
    ).toBe(
      '{"anthropic":{"key":"k","type":"api_key"},"openai-codex":{"access":"a","expires":1,"refresh":"r","type":"oauth"}}',
    );
  });

  test("rejects invalid pi auth JSON", () => {
    expect(() => formatPiAuthJson("not json")).toThrow(/auth\.json/);
    expect(() => formatPiAuthJson("[]")).toThrow(/JSON object/);
    expect(() => formatPiAuthJson('{"anthropic":{"key":"k"}}')).toThrow(/api_key or oauth/);
  });

  test("writes auth.json from the auth input", () => {
    const directory = createTempDirectory();
    const authJson = JSON.stringify({ anthropic: { type: "api_key", key: "sk-ant-secret" } });

    loadPiAuth(encodeAuthSecret(authJson), directory);

    expect(readFileSync(path.join(directory, "auth.json"), "utf8")).toBe(
      formatPiAuthJson(authJson),
    );
  });

  test("skips auth secret updates when auth is unchanged", async () => {
    const directory = createTempDirectory();
    const authJson = JSON.stringify({
      "openai-codex": { type: "oauth", refresh: "refresh-token", access: "access", expires: 1 },
    });
    writeFileSync(path.join(directory, "auth.json"), authJson);

    let updates = 0;
    await persistPiAuth(directory, encodeAuthSecret(authJson), async () => {
      updates += 1;
    });

    expect(updates).toBe(0);

    const changedAuthJson = JSON.stringify({
      "openai-codex": { type: "oauth", refresh: "refresh-token", access: "changed", expires: 2 },
    });
    let updatedSecret = "";
    writeFileSync(path.join(directory, "auth.json"), changedAuthJson);
    await persistPiAuth(directory, encodeAuthSecret(authJson), async (value) => {
      updates += 1;
      updatedSecret = value;
    });

    expect(updates).toBe(1);
    expect(decodeAuthSecret(updatedSecret)).toBe(formatPiAuthJson(changedAuthJson));
  });

  test("does not persist auth that did not come from the auth input", async () => {
    const directory = createTempDirectory();
    writeFileSync(
      path.join(directory, "auth.json"),
      JSON.stringify({ anthropic: { type: "api_key", key: "k" } }),
    );

    let updates = 0;
    await persistPiAuth(directory, undefined, async () => {
      updates += 1;
    });

    expect(updates).toBe(0);
  });
});

describe("pi models", () => {
  const baseInputs = {
    provider: undefined,
    model: undefined,
    baseUrl: undefined,
    api: undefined,
    apiKey: undefined,
    models: undefined,
    thinking: undefined,
  };

  test("configures a CLIProxyAPI-style custom provider", () => {
    const inputs = {
      ...baseInputs,
      model: "gpt-5.6-luna",
      baseUrl: "http://localhost:8317/v1",
      apiKey: "secret",
      thinking: "high",
    };

    expect(buildPiModelsConfig(inputs)).toEqual({
      providers: {
        custom: {
          baseUrl: "http://localhost:8317/v1",
          api: "openai-completions",
          apiKey: `$${PI_API_KEY_ENV}`,
          models: [{ id: "gpt-5.6-luna", reasoning: true }],
        },
      },
    });
    expect(getPiModelSelection(inputs)).toEqual({ provider: "custom", model: "gpt-5.6-luna" });
    expect(JSON.stringify(buildPiModelsConfig(inputs))).not.toContain("secret");
  });

  test("merges base-url inputs into models input providers", () => {
    const models = JSON.stringify({
      providers: {
        proxy: {
          api: "anthropic-messages",
          headers: { "x-team": "ci" },
          models: [
            { id: "claude-sonnet-5", contextWindow: 200000 },
            { id: "claude-haiku-4-5", contextWindow: 200000 },
          ],
        },
        other: { baseUrl: "https://other.example/v1" },
      },
    });

    expect(
      buildPiModelsConfig(
        {
          ...baseInputs,
          provider: "proxy",
          model: "claude-sonnet-5",
          baseUrl: "https://proxy.example",
        },
        models,
      ),
    ).toEqual({
      providers: {
        proxy: {
          baseUrl: "https://proxy.example",
          api: "anthropic-messages",
          headers: { "x-team": "ci" },
          models: [
            { id: "claude-sonnet-5", contextWindow: 200000 },
            { id: "claude-haiku-4-5", contextWindow: 200000 },
          ],
        },
        other: { baseUrl: "https://other.example/v1" },
      },
    });
  });

  test("adds base-url models missing from the models input", () => {
    const models = JSON.stringify({
      providers: { custom: { models: [{ id: "gpt-5.5", contextWindow: 400000 }] } },
    });

    expect(
      buildPiModelsConfig(
        { ...baseInputs, model: "gpt-5.6-luna", baseUrl: "http://localhost:8317/v1" },
        models,
      ).providers.custom?.models,
    ).toEqual([
      { id: "gpt-5.5", contextWindow: 400000 },
      { id: "gpt-5.6-luna", reasoning: false },
    ]);
  });

  test("overrides built-in provider API keys", () => {
    const inputs = { ...baseInputs, provider: "anthropic", apiKey: "secret" };

    expect(buildPiModelsConfig(inputs)).toEqual({
      providers: { anthropic: { apiKey: `$${PI_API_KEY_ENV}` } },
    });
    expect(getPiModelSelection(inputs)).toEqual({ provider: "anthropic", model: undefined });
    expect(createPiProviderEnv("secret")).toEqual({ [PI_API_KEY_ENV]: "secret" });
    expect(createPiProviderEnv(undefined)).toEqual({});
  });

  test("rejects invalid models input", () => {
    expect(() => buildPiModelsConfig(baseInputs, "{")).toThrow(/models must be JSON/);
    expect(() => buildPiModelsConfig(baseInputs, "[]")).toThrow(/JSON object/);
    expect(() => buildPiModelsConfig(baseInputs, '{"providers":[]}')).toThrow(/providers/);
    expect(() => buildPiModelsConfig(baseInputs, '{"providers":{"a":1}}')).toThrow(/a/);
  });

  test("writes models.json only when providers are configured", () => {
    const directory = createTempDirectory();

    setupPiModels(directory, baseInputs, directory);
    expect(() => readFileSync(path.join(directory, "models.json"))).toThrow();

    writeFileSync(
      path.join(directory, "models-input.json"),
      JSON.stringify({ providers: { local: { baseUrl: "http://localhost:11434/v1" } } }),
    );
    setupPiModels(directory, { ...baseInputs, models: "models-input.json" }, directory);

    expect(JSON.parse(readFileSync(path.join(directory, "models.json"), "utf8"))).toEqual({
      providers: { local: { baseUrl: "http://localhost:11434/v1" } },
    });
  });
});

describe("pi runner", () => {
  test("builds pi arguments", () => {
    expect(
      buildPiArgs({
        extensionPath: "/tmp/ext.ts",
        provider: "custom",
        model: "gpt-5.6-luna",
        thinking: "high",
      }),
    ).toEqual([
      "--mode",
      "json",
      "--no-session",
      "-na",
      "-ne",
      "-e",
      "/tmp/ext.ts",
      "--provider",
      "custom",
      "--model",
      "gpt-5.6-luna",
      "--thinking",
      "high",
    ]);
    expect(
      buildPiArgs({
        extensionPath: "/tmp/ext.ts",
        provider: undefined,
        model: undefined,
        thinking: undefined,
      }),
    ).not.toContain("--model");
  });

  test("reads the submitted result from JSON events", () => {
    const state = createPiStreamState();

    handlePiOutputLine("not json", state);
    handlePiOutputLine(
      JSON.stringify({
        type: "tool_execution_end",
        toolName: SUBMIT_RESULT_TOOL,
        result: {
          content: [{ type: "text", text: "Result submitted." }],
          details: { commit_message: " Update docs \n", pr_comment: "Looks good" },
        },
        isError: false,
      }),
      state,
    );
    handlePiOutputLine(
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          provider: "custom",
          model: "gpt-5.6-luna",
          stopReason: "toolUse",
        },
      }),
      state,
    );

    expect(getPiRunMetadata(state, 0)).toEqual({
      commitMessage: "Update docs",
      prComment: "Looks good",
      model: "custom/gpt-5.6-luna",
    });
  });

  test("ignores failed submit_result calls", () => {
    const state = createPiStreamState();

    handlePiOutputLine(
      JSON.stringify({
        type: "tool_execution_end",
        toolName: SUBMIT_RESULT_TOOL,
        result: { content: [{ type: "text", text: "Validation failed" }], details: {} },
        isError: true,
      }),
      state,
    );

    expect(state.result).toBeUndefined();
  });

  test("logs tool failures as tool errors", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    try {
      handlePiOutputLine(
        JSON.stringify({
          type: "tool_execution_end",
          toolName: "read",
          result: { content: [{ type: "text", text: "ENOENT" }] },
          isError: true,
        }),
        createPiStreamState(),
      );

      expect(write.mock.calls.map(([line]) => String(line)).join("")).toContain("[pi:tool-error]");
    } finally {
      write.mockRestore();
    }
  });

  test("falls back to empty metadata when submit_result is not called", () => {
    const state = createPiStreamState();
    state.lastAssistant = { role: "assistant", model: "claude-sonnet-5", stopReason: "stop" };

    expect(getPiRunMetadata(state, 0)).toEqual({
      commitMessage: "",
      prComment: "",
      model: "claude-sonnet-5",
    });
  });

  test("fails on pi errors", () => {
    const state = createPiStreamState();

    expect(() => getPiRunMetadata(state, 0)).toThrow(/did not produce a response/);
    expect(() => getPiRunMetadata(state, 2)).toThrow(/exited with code 2/);

    state.lastAssistant = {
      role: "assistant",
      stopReason: "error",
      errorMessage: "401 Unauthorized",
    };
    expect(() => getPiRunMetadata(state, 0)).toThrow(/401 Unauthorized/);

    state.lastAssistant = { role: "assistant", stopReason: "aborted" };
    expect(() => getPiRunMetadata(state, 0)).toThrow(/aborted/);
  });

  test("creates the pi environment without action inputs", () => {
    process.env.INPUT_API_KEY = "secret";

    try {
      const env = createPiEnv("/tmp/agent", { EXTRA: "1" });

      expect(env.INPUT_API_KEY).toBeUndefined();
      expect(env.PI_CODING_AGENT_DIR).toBe("/tmp/agent");
      expect(env.PI_SKIP_VERSION_CHECK).toBe("1");
      expect(env.EXTRA).toBe("1");
    } finally {
      delete process.env.INPUT_API_KEY;
    }
  });
});

describe("pi prompt", () => {
  test("adds action instructions to the prompt", () => {
    const prompt = buildPrompt("  Fix the tests.  ");

    expect(prompt.startsWith("Fix the tests.\n\npi action instructions:")).toBe(true);
    expect(prompt).toContain(SUBMIT_RESULT_TOOL);
    expect(prompt).toContain("not a pull request");
  });

  test("formats pull request comments with the agent and model", () => {
    expect(formatPiPullRequestComment(" Done. \n", "custom/<model>")).toBe(
      `Done.\n<sub>agent: pi ${PI_VERSION} | model: <code>custom/&lt;model&gt;</code></sub>`,
    );
  });

  test("registers the submit_result tool in the extension", () => {
    expect(PI_ACTION_EXTENSION).toContain(`name: "${SUBMIT_RESULT_TOOL}"`);
    expect(PI_ACTION_EXTENSION).toContain("terminate: true");
  });
});

describe("pi binary", () => {
  test("maps platforms to pi release assets", () => {
    expect(getPiTarget("linux", "x64")).toBe("linux-x64");
    expect(getPiTarget("darwin", "arm64")).toBe("darwin-arm64");
    expect(getPiTarget("win32", "x64")).toBe("windows-x64");
    expect(getPiTarget("linux", "ia32")).toBeNull();
    expect(getPiReleaseAsset("linux-x64")).toEqual({
      assetName: "pi-linux-x64.tar.gz",
      format: "tar",
    });
    expect(getPiReleaseAsset("windows-arm64")).toEqual({
      assetName: "pi-windows-arm64.zip",
      format: "zip",
    });
    expect(() => getPiReleaseAsset("freebsd-x64")).toThrow(/Unsupported/);
    expect(getPiReleaseAssetUrl("0.87.1", "darwin-arm64")).toBe(
      "https://github.com/earendil-works/pi/releases/download/v0.87.1/pi-darwin-arm64.tar.gz",
    );
  });

  test("builds exact tool archive action cache keys and paths", () => {
    const asset = getPiToolArchiveAsset("0.87.1", "linux-x64");

    expect(getToolArchiveCacheKey(asset)).toBe("pi-action-tool-cache-v1-pi-0.87.1-linux-x64");
    expect(getToolArchiveCachePaths(asset, "/tool-cache/pi/0.87.1/linux-x64")).toEqual([
      "/tool-cache/pi/0.87.1/linux-x64",
      "/tool-cache/pi/0.87.1/linux-x64.complete",
    ]);
  });

  test("finds the pi executable in the release archive", () => {
    const directory = createTempDirectory();
    const executable = path.join(directory, "pi", "pi");
    mkdirSync(path.join(directory, "pi"));
    writeFileSync(executable, "#!/bin/sh\n");

    expect(findPiExecutable(directory, "linux")).toBe(executable);
  });
});

describe("mcp", () => {
  test("builds GitHub MCP config without embedding the token", () => {
    const server = createMcpServerConfig(
      "github",
      "/tools/github-mcp-server",
      "https://github.com",
    );
    const config = buildPiMcpConfig(server);

    expect(config).toEqual({
      name: "github",
      command: "/tools/github-mcp-server",
      args: ["stdio"],
      env: {
        GITHUB_HOST: "https://github.com",
        GITHUB_TOOLSETS: "repos,issues,pull_requests,actions",
        GITHUB_READ_ONLY: "1",
      },
    });
  });

  test("builds Forgejo MCP config without embedding the token", () => {
    const server = createMcpServerConfig("forgejo", "/tools/forgejo-mcp", "https://codeberg.org");
    const config = buildPiMcpConfig(server);

    expect(config.command).toBe("/tools/forgejo-mcp");
    expect(config.args).toContain("--transport");
    expect(config.args).toContain("https://codeberg.org");
    expect(config.env).not.toHaveProperty("FORGEJO_ACCESS_TOKEN");
  });

  test("limits Forgejo MCP to read tools", () => {
    const { tools } = buildPiMcpConfig(
      createMcpServerConfig("forgejo", "/tools/forgejo-mcp", "https://codeberg.org"),
    );

    expect(tools).toContain("get_pull_request_diff");
    expect(tools).toContain("list_workflow_runs");
    expect(tools).not.toContain("create_issue_comment");
    expect(tools).not.toContain("merge_pull_request");
    expect(PI_ACTION_EXTENSION).toContain("config.tools.includes(tool.name)");
  });

  test("builds Gitea MCP config without embedding the token", () => {
    const server = createMcpServerConfig("gitea", "/tools/gitea-mcp", "https://gitea.com");
    const config = buildPiMcpConfig(server);

    expect(config.command).toBe("/tools/gitea-mcp");
    expect(config.args).toContain("-t");
    expect(config.args).toContain("https://gitea.com");
    expect(config.env).not.toHaveProperty("GITEA_ACCESS_TOKEN");
    expect(config.env.GITEA_READONLY).toBe("true");
    expect(config.env.GITEA_TOOLS?.split(",")).toContain("pull_request_read");
    expect(config).not.toHaveProperty("tools");
  });

  test("maps platforms to GitHub MCP release assets", () => {
    const { version, ...asset } = getMcpReleaseAsset("github", "linux", "x64");

    expect(asset).toEqual({
      cacheName: "github-mcp-server",
      target: "Linux-x86_64",
      assetName: "github-mcp-server_Linux_x86_64.tar.gz",
      format: "tar",
      executableNames: ["github-mcp-server"],
    });
    expect(getMcpReleaseAssetUrl("github", "win32", "arm64")).toBe(
      `https://github.com/github/github-mcp-server/releases/download/v${version}/github-mcp-server_Windows_arm64.zip`,
    );
  });

  test("maps platforms to Gitea MCP release assets", () => {
    const { version, ...asset } = getMcpReleaseAsset("gitea", "linux", "x64");

    expect(asset).toEqual({
      cacheName: "gitea-mcp",
      target: "Linux-x86_64",
      assetName: "gitea-mcp_Linux_x86_64.tar.gz",
      format: "tar",
      executableNames: ["gitea-mcp"],
    });
    expect(getMcpReleaseAssetUrl("gitea", "win32", "arm64")).toBe(
      `https://gitea.com/gitea/gitea-mcp/releases/download/v${version}/gitea-mcp_Windows_arm64.zip`,
    );
  });

  test("maps platforms to Forgejo MCP release assets", () => {
    const { version, ...asset } = getMcpReleaseAsset("forgejo", "darwin", "arm64");

    expect(asset).toEqual({
      cacheName: "forgejo-mcp",
      target: "darwin-arm64",
      assetName: `forgejo-mcp_${version}_darwin_arm64.tar.gz`,
      format: "tar",
      executableNames: ["forgejo-mcp"],
    });
    expect(getMcpReleaseAssetUrl("forgejo", "linux", "x64")).toBe(
      `https://codeberg.org/goern/forgejo-mcp/releases/download/v${version}/forgejo-mcp_${version}_linux_amd64.tar.gz`,
    );
    expect(() => getMcpReleaseAsset("forgejo", "win32", "x64")).toThrow(/Unsupported Forgejo/);
  });
});

describe("platforms", () => {
  test("detects action platform", () => {
    expect(detectPlatform({})).toBe("github");
    expect(detectPlatform({ GITEA_ACTIONS: "true" })).toBe("gitea");
    expect(detectPlatform({ FORGEJO_ACTIONS: "true" })).toBe("forgejo");
  });

  test("detects GitHub App installation /user errors", () => {
    expect(
      isGitHubAppInstallationUserError({
        status: 403,
        message: "Resource not accessible by integration",
      }),
    ).toBe(true);
    expect(isGitHubAppInstallationUserError({ status: 401, message: "Bad credentials" })).toBe(
      false,
    );
  });

  test("builds GitHub bot identities", () => {
    expect(getGitHubActionsBotUser()).toEqual({
      login: "github-actions[bot]",
      id: 41898282,
      email: "41898282+github-actions[bot]@users.noreply.github.com",
    });
    expect(getGitHubAppBotLogin("my-app")).toBe("my-app[bot]");
    expect(buildGitHubNoreplyEmail(123, "my-app[bot]")).toBe(
      "123+my-app[bot]@users.noreply.github.com",
    );
  });

  test("defines GitHub App installation token permissions", () => {
    expect(GITHUB_APP_INSTALLATION_PERMISSIONS).toEqual({
      actions: "read",
      contents: "write",
      issues: "write",
      pull_requests: "write",
      secrets: "write",
    });
  });

  test("creates GitHub App JWTs", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const jwt = createGitHubAppJwt(
      "Iv1.client",
      privateKeyPem.replace(/\n/g, "\\n"),
      1_700_000_000_000,
    );
    const [header = "", payload = "", signature = ""] = jwt.split(".");

    expect(JSON.parse(Buffer.from(header, "base64url").toString("utf8"))).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))).toEqual({
      iat: 1_699_999_940,
      exp: 1_700_000_540,
      iss: "Iv1.client",
    });
    expect(normalizePrivateKey(privateKeyPem.replace(/\n/g, "\\n"))).toBe(privateKeyPem);
    expect(
      verifySignature(
        "RSA-SHA256",
        Buffer.from(`${header}.${payload}`),
        publicKey,
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);
  });
});

describe("git", () => {
  test("builds authenticated push URLs", () => {
    expect(
      buildAuthenticatedRemoteUrl(
        "https://github.com/owner/repo.git",
        "github",
        createActionUser("octocat"),
        "token",
      ),
    ).toBe("https://x-access-token:token@github.com/owner/repo.git");
    expect(
      buildAuthenticatedRemoteUrl(
        "https://gitea.example/owner/repo.git",
        "gitea",
        createActionUser("bot"),
        "token",
      ),
    ).toBe("https://bot:token@gitea.example/owner/repo.git");
    expect(
      buildAuthenticatedRemoteUrl(
        "https://forgejo.example/owner/repo.git",
        "forgejo",
        createActionUser("bot"),
        "token",
      ),
    ).toBe("https://bot:token@forgejo.example/owner/repo.git");
  });

  test("normalizes SSH-style remotes to authenticated HTTPS push URLs", () => {
    expect(
      buildAuthenticatedRemoteUrl(
        "git@github.com:owner/repo.git",
        "github",
        createActionUser("octocat"),
        "token",
      ),
    ).toBe("https://x-access-token:token@github.com/owner/repo.git");
    expect(
      buildAuthenticatedRemoteUrl(
        "ssh://git@github.com/owner/repo.git",
        "github",
        createActionUser("octocat"),
        "token",
      ),
    ).toBe("https://x-access-token:token@github.com/owner/repo.git");
  });

  test("builds git config overrides that isolate push credentials", () => {
    expect(
      buildCredentialIsolationGitArgs("https://x-access-token:token@github.com/owner/repo.git"),
    ).toEqual([
      "-c",
      "credential.helper=",
      "-c",
      "credential.https://github.com/.helper=",
      "-c",
      "credential.https://github.com/owner/repo.git.helper=",
      "-c",
      "credential.https://github.com/owner/repo.helper=",
      "-c",
      "http.extraheader=",
      "-c",
      "http.https://github.com/.extraheader=",
      "-c",
      "http.https://github.com/owner/repo.git.extraheader=",
      "-c",
      "http.https://github.com/owner/repo.extraheader=",
    ]);
  });
});

function createTempDirectory(): string {
  return mkdtempSync(path.join(tmpdir(), "pi-action-test-"));
}

function createActionUser(login: string) {
  return {
    login,
    id: 1,
    email: `${login}@example.com`,
  };
}
