Review this pull request.

## Gathering context

- Use the platform MCP tools to read the pull request title, description, and existing comments.
- Compare the pull request against its base branch with `git diff origin/main...HEAD` (and `git log origin/main..HEAD` for the commits), then read the surrounding code in the changed files as needed.
- Follow the requirements in `AGENTS.md` and `CONTRIBUTING.md`.

## What to look for

- Correctness bugs, regressions, and unhandled edge cases.
- Security issues, especially around tokens, secrets, git credentials, and workflow permissions.
- Missing or outdated tests, documentation (`README.md`, `action.yaml` inputs), and the committed `build/index.js` bundle when `src/` changes.
- Workflow changes that would fail `zizmor` or `forgejo-runner validate`.

Skip style nits that `nix fmt` or `oxlint` would catch, and do not restate what the pull request already explains.

## Output

- Do not modify any files; this is a review only.
- Put the review in the pull request comment as concise Markdown: a one-sentence summary, then a list of findings ordered by severity, each referencing `path:line` with a short explanation and suggested fix.
- If you find nothing worth raising, say so in one sentence.
- Fail the run if you report any findings, with a one-line summary such as "2 issues found in src/git.ts" as the reason.
