import { chmodSync, writeFileSync } from "node:fs";
import path from "node:path";

import * as core from "@actions/core";

import { resolveFileInput } from "../inputs.ts";
import type { ActionInputs } from "../types.ts";

export const PI_API_KEY_ENV = "PI_ACTION_API_KEY";
export const DEFAULT_CUSTOM_PROVIDER = "custom";
export const DEFAULT_CUSTOM_API = "openai-completions";

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

export function setupPiModels(
  agentDir: string,
  inputs: ProviderInputs,
  workspace: string,
): PiModelSelection {
  const models = inputs.models ? resolveFileInput(inputs.models, workspace) : undefined;
  const config = buildPiModelsConfig(inputs, models);

  if (Object.keys(config.providers).length > 0) {
    const modelsPath = path.join(agentDir, "models.json");
    writeFileSync(modelsPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    chmodSync(modelsPath, 0o600);
    core.info(`Configured pi providers: ${Object.keys(config.providers).join(", ")}`);
  }

  return getPiModelSelection(inputs);
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

function isModelWithId(model: unknown, id: string): boolean {
  return isRecord(model) && model.id === id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
