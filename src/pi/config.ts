import { chmodSync, writeFileSync } from "node:fs";
import path from "node:path";

import * as core from "@actions/core";

import { resolveFileInput } from "../inputs.ts";
import type { ActionInputs } from "../types.ts";

export const PI_API_KEY_ENV = "PI_ACTION_API_KEY";
export const DEFAULT_CUSTOM_PROVIDER = "custom";
export const DEFAULT_CUSTOM_API = "openai-completions";
export const SEARCH_TOOLS = ["grep", "find", "ls"];
const MODEL_LIST_TIMEOUT_MS = 10000;

type ProviderInputs = Pick<
  ActionInputs,
  "provider" | "model" | "baseUrl" | "api" | "apiKey" | "models" | "thinking"
>;

type ModelsConfig = {
  providers: Record<string, Record<string, unknown>>;
};

export type PiModelSelection = {
  provider: string | undefined;
  model: string | undefined;
};

export type PiModelLimits = {
  contextWindow?: number;
  maxTokens?: number;
};

export async function setupPiModels(
  agentDir: string,
  inputs: ProviderInputs,
  workspace: string,
): Promise<PiModelSelection> {
  const models = inputs.models ? resolveFileInput(inputs.models, workspace) : undefined;
  const config = buildPiModelsConfig(inputs, models);
  await discoverPiModelLimits(config, inputs);

  if (Object.keys(config.providers).length > 0) {
    const modelsPath = path.join(agentDir, "models.json");
    writeFileSync(modelsPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    chmodSync(modelsPath, 0o600);
    core.info(`Configured pi providers: ${Object.keys(config.providers).join(", ")}`);
  }

  return getPiModelSelection(inputs);
}

// Without bash, pi has no way to search the workspace, so turn on its
// read-only search tools; the action's extension confines them to the
// workspace. If another shell such as powershell is still active, the
// extension skips confinement, which costs nothing: that shell can already
// read any file.
export function setupPiSettings(agentDir: string, excludeTools: string[]): boolean {
  if (!excludeTools.includes("bash")) {
    return false;
  }

  const settings = { defaultTools: SEARCH_TOOLS.map((tool) => `+${tool}`) };
  writeFileSync(path.join(agentDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`, {
    mode: 0o600,
  });
  core.info(`Enabled pi search tools without bash: ${SEARCH_TOOLS.join(", ")}`);
  return true;
}

export function buildPiModelsConfig(inputs: ProviderInputs, models?: string): ModelsConfig {
  const config = parseModelsConfig(models);

  if (inputs.baseUrl) {
    if (!inputs.model) {
      throw new Error("model is required when base-url is provided");
    }

    const modelId = inputs.model;
    const providerName = inputs.provider ?? DEFAULT_CUSTOM_PROVIDER;
    const existing = config.providers[providerName] ?? {};
    const existingModels = Array.isArray(existing.models) ? (existing.models as unknown[]) : [];
    // Keep a definition from the models input, which may carry context
    // window, cost, or input metadata the action cannot infer.
    const models = existingModels.some((model) => isModelWithId(model, modelId))
      ? existingModels
      : [
          ...existingModels,
          { id: modelId, reasoning: inputs.thinking !== undefined && inputs.thinking !== "off" },
        ];

    config.providers[providerName] = {
      ...existing,
      baseUrl: inputs.baseUrl,
      api: inputs.api ?? existing.api ?? DEFAULT_CUSTOM_API,
      ...(inputs.apiKey ? { apiKey: `$${PI_API_KEY_ENV}` } : {}),
      models,
    };
  } else if (inputs.apiKey) {
    if (!inputs.provider) {
      throw new Error("provider is required when api-key is provided without base-url");
    }

    config.providers[inputs.provider] = {
      ...config.providers[inputs.provider],
      apiKey: `$${PI_API_KEY_ENV}`,
    };
  }

  return config;
}

// pi gives a model without limits a 128000-token context window and a
// 16384-token output limit, which cuts off long turns of models that support
// more. Fill in the limits the models input leaves unset from the endpoint's
// model list. CLIProxyAPI only includes limits in the Anthropic format of that
// list, so the request asks for it.
export async function discoverPiModelLimits(
  config: ModelsConfig,
  inputs: ProviderInputs,
): Promise<void> {
  if (!inputs.baseUrl || !inputs.model) {
    return;
  }

  const modelId = inputs.model;
  const provider = config.providers[inputs.provider ?? DEFAULT_CUSTOM_PROVIDER];
  const definition = Array.isArray(provider?.models)
    ? (provider.models as unknown[]).find((model) => isModelWithId(model, modelId))
    : undefined;

  if (!isRecord(definition) || (definition.contextWindow && definition.maxTokens)) {
    return;
  }

  const url = getModelListUrl(inputs.baseUrl, asString(provider?.api));
  let limits: PiModelLimits;

  try {
    limits = await fetchModelLimits(url, modelId, inputs.apiKey);
  } catch (error) {
    core.info(
      `Could not read limits for ${modelId} from ${url}; pi will use its defaults: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const discovered: PiModelLimits = {};

  if (!definition.contextWindow && limits.contextWindow) {
    discovered.contextWindow = limits.contextWindow;
  }

  if (!definition.maxTokens && limits.maxTokens) {
    discovered.maxTokens = limits.maxTokens;
  }

  if (Object.keys(discovered).length === 0) {
    core.info(`${url} has no limits for ${modelId}; pi will use its defaults`);
    return;
  }

  Object.assign(definition, discovered);
  core.info(
    `Discovered limits for ${modelId}: ${Object.entries(discovered)
      .map(([name, value]) => `${name} ${value}`)
      .join(", ")}`,
  );
}

export function getModelListUrl(baseUrl: string, api: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  // Anthropic clients add /v1 to the base URL themselves; OpenAI clients
  // expect it to be part of the base URL already.
  return api === "anthropic-messages" ? `${base}/v1/models` : `${base}/models`;
}

export async function fetchModelLimits(
  url: string,
  modelId: string,
  apiKey: string | undefined,
): Promise<PiModelLimits> {
  const response = await fetch(url, {
    headers: {
      "anthropic-version": "2023-06-01",
      ...(apiKey ? { authorization: `Bearer ${apiKey}`, "x-api-key": apiKey } : {}),
    },
    // fetch drops authorization on a cross-origin redirect, but not x-api-key.
    redirect: "error",
    signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return parseModelLimits(await response.json(), modelId);
}

// Reads the Anthropic (max_input_tokens, max_tokens) and OpenRouter-style
// (context_length, max_completion_tokens) fields of a model list.
export function parseModelLimits(body: unknown, modelId: string): PiModelLimits {
  const list = isRecord(body) && Array.isArray(body.data) ? (body.data as unknown[]) : [];
  const model = list.find((entry) => isModelWithId(entry, modelId));

  if (!isRecord(model)) {
    return {};
  }

  return {
    contextWindow: asPositiveInteger(model.max_input_tokens ?? model.context_length),
    maxTokens: asPositiveInteger(model.max_tokens ?? model.max_completion_tokens),
  };
}

export function getPiModelSelection(inputs: ProviderInputs): PiModelSelection {
  if (inputs.baseUrl) {
    return { provider: inputs.provider ?? DEFAULT_CUSTOM_PROVIDER, model: inputs.model };
  }

  return { provider: inputs.provider, model: inputs.model };
}

export function createPiProviderEnv(apiKey: string | undefined): Record<string, string> {
  return apiKey ? { [PI_API_KEY_ENV]: apiKey } : {};
}

function parseModelsConfig(models: string | undefined): ModelsConfig {
  if (!models?.trim()) {
    return { providers: {} };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(models);
  } catch (error) {
    throw new Error(
      `models must be JSON or a path to a JSON file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(parsed)) {
    throw new Error("models must be a JSON object");
  }

  const providers = parsed.providers ?? {};

  if (!isRecord(providers)) {
    throw new Error("models.providers must be a JSON object");
  }

  for (const [name, provider] of Object.entries(providers)) {
    if (!isRecord(provider)) {
      throw new Error(`models.providers.${name} must be a JSON object`);
    }
  }

  return { ...parsed, providers: providers as Record<string, Record<string, unknown>> };
}

function asPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isModelWithId(model: unknown, id: string): boolean {
  return isRecord(model) && model.id === id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
