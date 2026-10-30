# AGENTS.md

## Task Completion Requirements

- `nix fmt` must be used for formatting.
- `nix flake check` must pass before considering tasks completed. Intent-to-add (`git add -N`) new files so `nix flake check` can see them.

## Version Control Requirements

- Commit messages created by agents must follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).
- Commits created by agents must include an `Assisted-by: [tool name] ([primary model name and version])` Git commit trailer.
- Branch names created by agents must follow [Conventional Branch 1.0.0](https://conventionalbranch.org/v1.0.0/).

## Template Update Requirements

- If `.template.json` exists, this project was created from the template at `url`, and `commit` is the latest template commit whose changes have been applied.
- To update from the template, port each commit in `<commit>..main` of the template to this project, adapting names, URLs and paths. Skip dependency updates (`chore(deps)`) that this project's Renovate already handles, and changes to `init.sh`, `template.schema.json` and the `templates` flake output, which are not part of this project.
- Set `commit` to the template commit that was synced to in the same commit that applies its changes.

## Pull Request Requirements

- Merging into `main` requires an approval from `pi`, which reviews only when its review is requested. Pushing makes its approval stale, and pushes do not start a new review.
- After pushing to an open pull request, reply to `pi`'s review comments first, then re-request a review from `pi` (for example `POST /repos/{owner}/{repo}/pulls/{index}/requested_reviewers` with `{"reviewers": ["pi"]}`).
