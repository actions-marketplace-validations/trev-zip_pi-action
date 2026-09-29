import { isPullRequestEvent } from "../platforms/index.ts";
import { PI_VERSION } from "./binary.ts";
import { SUBMIT_RESULT_TOOL } from "./extension.ts";

export function buildPrompt(prompt: string): string {
  const prInstructions = isPullRequestEvent()
    ? "If a pull request comment would be useful, set pr_comment to concise Markdown. Otherwise set it to an empty string."
    : "This event is not a pull request. Set pr_comment to an empty string.";

  return `${prompt.trim()}

pi action instructions:
- Make any requested repository changes directly in the working tree.
- Do not commit, push, or post comments yourself; this action handles that after you finish.
- When finished, call the ${SUBMIT_RESULT_TOOL} tool exactly once as your final action.
- If you made repository changes, set commit_message to a concise imperative commit message. If not, set it to an empty string.
- ${prInstructions}
- Platform MCP tools are available for read-only repository, pull request, issue, and workflow context. Use them when helpful, but do not create, update, merge, comment, or otherwise write through MCP.`;
}

export function formatPiPullRequestComment(comment: string, model: string): string {
  return `${comment.trim()}\n<sub>agent: pi ${PI_VERSION} | model: <code>${escapeHtml(model)}</code></sub>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
