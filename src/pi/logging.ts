import * as core from "@actions/core";

export function logPiText(title: string, text: string): void {
  core.startGroup(title);
  core.info(text);
  core.endGroup();
}

const ANSI_RESET = "\x1b[0m";

const PI_LOG_LABEL_COLORS: Record<string, string> = {
  agent: "\x1b[2m",
  turn: "\x1b[2m",
  retry: "\x1b[33m",
  compaction: "\x1b[2m",
  message: "\x1b[97m",
  reasoning: "\x1b[2m",
  command: "\x1b[34m",
  "command-output": "\x1b[2m",
  file: "\x1b[35m",
  tool: "\x1b[36m",
  stderr: "\x1b[2m",
  error: "\x1b[31m",
};

export function logPiLine(label: string, text: string): void {
  logPiBlock(label, text);
}

export function logPiBlock(label: string, text: string): void {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
  const prefix = formatPiLogPrefix(label);

  if (!normalized.trim()) {
    return;
  }

  for (const line of normalized.split("\n")) {
    core.info(`${prefix} ${line}`);
  }
}

export function formatInlineLogText(value: string): string {
  const singleLine = value.replace(/\s+/g, " ").trim();

  if (singleLine.length <= 120) {
    return singleLine;
  }

  return `${singleLine.slice(0, 117)}...`;
}

function formatPiLogPrefix(label: string): string {
  const prefix = `[pi:${label}]`;
  const color = PI_LOG_LABEL_COLORS[label];

  if (!color || !piLogColorsEnabled()) {
    return prefix;
  }

  return `${color}${prefix}${ANSI_RESET}`;
}

function piLogColorsEnabled(): boolean {
  return process.env.NO_COLOR === undefined && process.env.FORCE_COLOR !== "0";
}
