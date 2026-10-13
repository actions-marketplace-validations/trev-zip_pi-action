import type {
  GiteaCommentResponse,
  GiteaReviewCommentResponse,
  GiteaReviewResponse,
  PullRequestNote,
  SubmittedReview,
} from "../types.ts";

// Pending reviews and review requests are left out, since neither is a
// submitted review.
const GITEA_REVIEW_STATES: Record<string, SubmittedReview["state"]> = {
  APPROVED: "approved",
  REQUEST_CHANGES: "changes_requested",
  COMMENT: "commented",
};

// Reads the reviews the Forgejo and Gitea APIs return, which share a format.
export function parseGiteaReview(review: GiteaReviewResponse): SubmittedReview[] {
  const state = review.state ? GITEA_REVIEW_STATES[review.state] : undefined;
  const login = review.user?.login;

  if (!state || review.id === undefined || !login || !review.submitted_at) {
    return [];
  }

  return [
    {
      id: review.id,
      login,
      state,
      dismissed: Boolean(review.dismissed),
      commitId: review.commit_id || undefined,
      body: review.body ?? "",
      submittedAt: review.submitted_at,
    },
  ];
}

export function parseGiteaReviewComment(comment: GiteaReviewCommentResponse): PullRequestNote[] {
  const login = comment.user?.login;
  const line = comment.position || comment.original_position;

  if (!login || !comment.body || !comment.path) {
    return [];
  }

  return [
    {
      login,
      body: comment.body,
      createdAt: comment.created_at ?? "",
      path: comment.path,
      ...(line ? { line } : {}),
    },
  ];
}

export function parseGiteaComment(comment: GiteaCommentResponse): PullRequestNote[] {
  const login = comment.user?.login;

  if (!login || !comment.body) {
    return [];
  }

  return [{ login, body: comment.body, createdAt: comment.created_at ?? "" }];
}
