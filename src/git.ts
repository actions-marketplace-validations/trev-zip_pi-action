import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as github from "@actions/github";

import type { ActionUser, Platform, PullRequestPayload } from "./types.ts";

export async function configureGitUser(workspace: string, user: ActionUser): Promise<void> {
  await runGit(["config", "user.name", user.login], workspace);
  await runGit(["config", "user.email", user.email], workspace);
  core.info(`Configured git user as ${user.login} <${user.email}>`);
}

export async function hasGitChanges(workspace: string): Promise<boolean> {
  const { stdout } = await runGit(["status", "--porcelain"], workspace);
  return stdout.trim().length > 0;
}

export async function commitChanges(workspace: string, commitMessage: string): Promise<void> {
  const message = commitMessage || "Update with pi";

  await runGit(["add", "-A"], workspace);
  await runGit(["commit", "-m", message], workspace);
  core.info("Committed pi changes");
}

export async function pushChanges(
  workspace: string,
  platform: Platform,
  user: ActionUser,
  token: string,
): Promise<void> {
  const authenticatedUrl = await getAuthenticatedOriginUrl(workspace, platform, user, token);
  const pushRef = await resolvePushRef(workspace);
  await runGit(
    [
      ...buildCredentialIsolationGitArgs(authenticatedUrl),
      "push",
      authenticatedUrl,
      `HEAD:${pushRef}`,
    ],
    workspace,
    { env: createNonInteractiveGitEnv() },
  );
  core.info("Pushed pi changes");
}

export type DiffSinceCommitOptions = {
  platform: Platform;
  user: ActionUser;
  token: string;
  // The commit an earlier review saw, the pull request's head, and its base
  // branch.
  since: string;
  head: string;
  baseRef: string;
};

const FULL_SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const BRANCH_NAME = /^[A-Za-z0-9._/-]{1,200}$/;
const BASE_REF = "refs/pi-action/base";

// Returns what changed in a pull request between two of its heads, leaving out
// changes that came from rebasing onto or merging the base branch. The older
// head's changes are replayed onto the newer head's merge base, and the diff
// runs from there to the newer head. Where the replay conflicts, the diff shows
// how the newer head resolved the conflict markers.
export async function diffSinceCommit(
  workspace: string,
  options: DiffSinceCommitOptions,
): Promise<string> {
  const { since, head, baseRef } = options;

  if (!FULL_SHA.test(since) || !FULL_SHA.test(head)) {
    throw new Error("commits must be full SHAs");
  }

  if (!BRANCH_NAME.test(baseRef)) {
    throw new Error(`unsupported base branch name: ${baseRef}`);
  }

  // Checkouts are usually shallow, and the merge bases need the history.
  const { stdout: shallow } = await runGit(["rev-parse", "--is-shallow-repository"], workspace);
  const authenticatedUrl = await getAuthenticatedOriginUrl(
    workspace,
    options.platform,
    options.user,
    options.token,
  );
  await runGit(
    [
      ...buildCredentialIsolationGitArgs(authenticatedUrl),
      "fetch",
      "--no-tags",
      ...(shallow.trim() === "true" ? ["--unshallow"] : []),
      authenticatedUrl,
      since,
      head,
      `+refs/heads/${baseRef}:${BASE_REF}`,
    ],
    workspace,
    { env: createNonInteractiveGitEnv() },
  );

  return diffReplayed(workspace, since, head, BASE_REF);
}

// The part of diffSinceCommit that runs on commits already in the repository.
export async function diffReplayed(
  workspace: string,
  since: string,
  head: string,
  base: string,
): Promise<string> {
  const sinceBase = await gitOutput(["merge-base", since, base], workspace);
  const headBase = await gitOutput(["merge-base", head, base], workspace);
  let from = since;

  if (sinceBase !== headBase) {
    // merge-tree exits with 1 when the replay conflicts, and still writes the
    // tree, with conflict markers, on the first line.
    const replay = await runGit(
      ["merge-tree", "--write-tree", `--merge-base=${sinceBase}`, headBase, since],
      workspace,
      { ignoreReturnCode: true },
    );

    if (replay.exitCode > 1) {
      throw new Error(`git merge-tree failed: ${replay.stderr.trim()}`);
    }

    from = replay.stdout.split("\n")[0]?.trim() ?? "";
  }

  const { stdout } = await runGit(
    ["diff", "--no-color", "--no-ext-diff", "--no-textconv", from, head],
    workspace,
  );
  return stdout;
}

async function getAuthenticatedOriginUrl(
  workspace: string,
  platform: Platform,
  user: ActionUser,
  token: string,
): Promise<string> {
  const { stdout } = await runGit(["remote", "get-url", "origin"], workspace);
  const authenticatedUrl = buildAuthenticatedRemoteUrl(stdout.trim(), platform, user, token);

  if (!authenticatedUrl) {
    throw new Error("origin remote must be HTTP(S) or SSH-style to use the action token");
  }

  core.setSecret(authenticatedUrl);
  return authenticatedUrl;
}

async function gitOutput(args: string[], workspace: string): Promise<string> {
  const { stdout } = await runGit(args, workspace);
  return stdout.trim();
}

async function resolvePushRef(workspace: string): Promise<string> {
  const payload = github.context.payload as PullRequestPayload;
  const prHeadRef = payload.pull_request?.head?.ref ?? process.env.GITHUB_HEAD_REF;

  if (prHeadRef) {
    return prHeadRef;
  }

  if (process.env.GITHUB_REF_TYPE !== "tag" && process.env.GITHUB_REF_NAME) {
    return process.env.GITHUB_REF_NAME;
  }

  const { stdout } = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], workspace);
  const branch = stdout.trim();

  if (!branch || branch === "HEAD") {
    throw new Error("Could not determine a branch to push pi changes to");
  }

  return branch;
}

async function runGit(
  args: string[],
  workspace: string,
  options: exec.ExecOptions = {},
): Promise<exec.ExecOutput> {
  return exec.getExecOutput("git", args, { ...options, cwd: workspace, silent: true });
}

export function buildAuthenticatedRemoteUrl(
  remoteUrl: string,
  platform: Platform,
  user: ActionUser,
  token: string,
): string | null {
  const url = normalizeRemoteUrl(remoteUrl);

  if (!url) {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  if (platform === "github") {
    url.username = "x-access-token";
  } else {
    url.username = user.login;
  }

  url.password = token;
  return url.toString();
}

export function buildCredentialIsolationGitArgs(remoteUrl: string): string[] {
  const configUrls = buildGitCredentialConfigUrls(remoteUrl);
  const configValues = [
    "credential.helper=",
    ...configUrls.map((url) => `credential.${url}.helper=`),
    "http.extraheader=",
    ...configUrls.map((url) => `http.${url}.extraheader=`),
  ];

  return configValues.flatMap((value) => ["-c", value]);
}

function normalizeRemoteUrl(remoteUrl: string): URL | null {
  try {
    const url = new URL(remoteUrl);

    if (url.protocol === "ssh:") {
      return sshUrlToHttpsUrl(url);
    }

    return url;
  } catch {
    return scpLikeUrlToHttpsUrl(remoteUrl);
  }
}

function sshUrlToHttpsUrl(url: URL): URL | null {
  if (!url.hostname || !url.pathname || url.pathname === "/") {
    return null;
  }

  return new URL(`https://${url.hostname}${url.pathname}`);
}

function scpLikeUrlToHttpsUrl(remoteUrl: string): URL | null {
  const match = /^(?:[^@\s]+)@([^:\s]+):(.+)$/.exec(remoteUrl);
  const host = match?.[1];
  const path = match?.[2]?.replace(/^\/+/, "");

  if (!host || !path) {
    return null;
  }

  return new URL(`https://${host}/${path}`);
}

function buildGitCredentialConfigUrls(remoteUrl: string): string[] {
  const url = normalizeRemoteUrl(remoteUrl);

  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
    return [];
  }

  url.username = "";
  url.password = "";

  const urls = new Set<string>([`${url.protocol}//${url.host}/`]);
  const path = url.pathname.replace(/\/+$/, "");

  if (path && path !== "/") {
    const repoUrl = `${url.protocol}//${url.host}${path}`;
    urls.add(repoUrl);

    if (repoUrl.endsWith(".git")) {
      urls.add(repoUrl.slice(0, -4));
    }
  }

  return [...urls];
}

function createNonInteractiveGitEnv(): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  env.GIT_ASKPASS = "";
  env.GIT_TERMINAL_PROMPT = "0";
  return env;
}
