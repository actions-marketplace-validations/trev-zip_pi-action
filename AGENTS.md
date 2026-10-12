# AGENTS.md

## Task Completion Requirements

- `nix fmt` must be used for formatting.
- `nix flake check` must pass before considering tasks completed. Intent-to-add (`git add -N`) new files so `nix flake check` can see them.

## Version Control Requirements

- Commit messages created by agents must follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).
- Commits created by agents must include an `Assisted-by: [tool name] ([primary model name and version])` Git commit trailer.
- Branch names created by agents must follow [Conventional Branch 1.1.0](https://conventionalbranch.org/).

## Pull Request Requirements

- Merging into `main` requires an approval from `pi`, which reviews only when its review is requested. Pushing makes its approval stale, and pushes do not start a new review.
- After pushing to an open pull request, reply to `pi`'s review comments first, then re-request a review from `pi` (for example `POST /repos/{owner}/{repo}/pulls/{index}/requested_reviewers` with `{"reviewers": ["pi"]}`).
