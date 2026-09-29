import * as core from "@actions/core";

import { commitChanges, configureGitUser, hasGitChanges, pushChanges } from "./git.ts";
import { readInputs, resolvePromptInput } from "./inputs.ts";
import { setupPiMcp } from "./mcp.ts";
import { loadPiAuth, persistPiAuth } from "./pi/auth.ts";
import { resolvePiExecutable } from "./pi/binary.ts";
import { createPiProviderEnv, setupPiModels } from "./pi/config.ts";
import { writePiActionExtension } from "./pi/extension.ts";
import { createPiAgentDir } from "./pi/home.ts";
import { formatPiPullRequestComment } from "./pi/prompt.ts";
import { runPiPrompt } from "./pi/runner.ts";
import { createPlatformClient, isPullRequestEvent } from "./platforms/index.ts";

export async function run(): Promise<void> {
  const inputs = readInputs();
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const platformClient = await createPlatformClient({
    token: inputs.token,
    githubAppClientId: inputs.githubAppClientId,
    githubAppPrivateKey: inputs.githubAppPrivateKey,
  });
  const agentDir = createPiAgentDir();
  const piExecutable = await resolvePiExecutable();
  const updateAuthSecret = (value: string) =>
    platformClient.updateRepositoryAuthSecret(inputs.authSecret, value);

  try {
    loadPiAuth(inputs.auth, agentDir);

    const user = await platformClient.getActionUser();
    await configureGitUser(workspace, user);

    const pullRequestEvent = isPullRequestEvent();
    const { provider, model } = setupPiModels(agentDir, inputs, workspace);
    const extensionPath = writePiActionExtension(agentDir);
    const mcpEnv = await setupPiMcp(agentDir, platformClient);
    const prompt = resolvePromptInput(inputs.prompt, workspace);
    const metadata = await runPiPrompt({
      executable: piExecutable,
      agentDir,
      workspace,
      prompt,
      extensionPath,
      provider,
      model,
      thinking: inputs.thinking,
      env: { ...mcpEnv, ...createPiProviderEnv(inputs.apiKey) },
    });

    const prComment = metadata.prComment.trim();

    if (await hasGitChanges(workspace)) {
      await commitChanges(workspace, metadata.commitMessage);

      if (inputs.dryRun) {
        core.info("Dry run enabled; skipping push of pi changes");
      } else {
        await pushChanges(workspace, platformClient.type, user, platformClient.token);
      }
    } else {
      core.info("pi did not leave repository changes to commit");
    }

    if (pullRequestEvent && prComment) {
      const commentModel = metadata.model ?? model;

      if (!commentModel) {
        throw new Error("Could not determine the pi model for the pull request comment");
      }

      if (inputs.dryRun) {
        core.info("Dry run enabled; skipping pi pull request comment");
      } else {
        await platformClient.postPullRequestComment(
          formatPiPullRequestComment(prComment, commentModel),
        );
      }
    }

    if (pullRequestEvent && inputs.automerge !== undefined) {
      if (inputs.dryRun) {
        core.info("Dry run enabled; skipping pull request automerge update");
      } else {
        await platformClient.setPullRequestAutomerge(inputs.automerge);
      }
    }
  } finally {
    await persistPiAuth(agentDir, inputs.auth, updateAuthSecret);
  }
}
