import * as core from "@actions/core";

import { diffSinceCommit } from "./git.ts";
import { getRunContext } from "./platforms/index.ts";
import type {
  ActionUser,
  PiRunMetadata,
  PlatformClient,
  PreviousReview,
  PullRequestNote,
  ReviewLevel,
  SubmittedReview,
} from "./types.ts";
import { errorMessage } from "./utils.ts";

// Finds the action user's last review of the pull request, with its inline
// comments, what others said since, and what changed since, so a run that
// reviews the pull request again can start from there.
export async function loadPreviousReview(
  client: PlatformClient,
  user: ActionUser,
  workspace: string,
): Promise<PreviousReview | undefined> {
  const { baseRef, headSha: head } = getRunContext().pullRequest ?? {};

  if (!baseRef || !head) {
    return undefined;
  }

  const reviews = await client.listPullRequestReviews();
  const review = findLastReview(reviews, user.login);

  if (!review?.commitId) {
    return undefined;
  }

  const since = review.commitId;
  const [comments, notes] = await Promise.all([
    client.listPullRequestReviewComments(review.id),
    listNotesSince(client, reviews, review, user.login),
  ]);
  let changes: string | undefined;

  try {
    changes = await diffSinceCommit(workspace, {
      platform: client.type,
      user,
      token: client.token,
      since,
      head,
      baseRef,
    });
  } catch (error) {
    core.warning(`Could not work out the changes since ${since}: ${errorMessage(error)}`);
  }

  core.info(
    `Found the previous review at ${since}, with ${notes.length} comment(s) since${changes === undefined ? "" : ` and ${changes ? "changes" : "no changes"} since`}`,
  );
  return { review, comments, notes, baseRef, changes };
}

export function findLastReview(
  reviews: SubmittedReview[],
  login: string,
): SubmittedReview | undefined {
  return reviews
    .filter((review) => review.login.toLowerCase() === login.toLowerCase() && review.commitId)
    .sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt))
    .at(-1);
}

// Replies to inline comments become reviews of their own, so later reviews by
// others count as well as comments.
async function listNotesSince(
  client: PlatformClient,
  reviews: SubmittedReview[],
  review: SubmittedReview,
  login: string,
): Promise<PullRequestNote[]> {
  const after = (time: string) => Date.parse(time) > Date.parse(review.submittedAt);
  const others = (note: { login: string }) => note.login.toLowerCase() !== login.toLowerCase();
  const later = reviews.filter((entry) => others(entry) && after(entry.submittedAt));
  const [comments, ...reviewComments] = await Promise.all([
    client.listPullRequestComments(review.submittedAt),
    ...later.map((entry) => client.listPullRequestReviewComments(entry.id)),
  ]);
  const notes: PullRequestNote[] = [
    ...comments.filter(others),
    ...later.flatMap((entry) =>
      entry.body.trim()
        ? [{ login: entry.login, body: entry.body, createdAt: entry.submittedAt }]
        : [],
    ),
    ...reviewComments.flat(),
  ];

  return notes.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

// Approves again without running pi when pi approved the pull request and
// nothing changed since apart from rebasing onto or merging the base branch.
export function getReapproval(
  previous: PreviousReview | undefined,
  level: ReviewLevel,
): PiRunMetadata | undefined {
  if (
    level !== "approve" ||
    !previous ||
    previous.changes !== "" ||
    previous.review.state !== "approved" ||
    previous.review.dismissed
  ) {
    return undefined;
  }

  return {
    commitMessage: "",
    prComment: `Nothing changed since my approval at ${previous.review.commitId} apart from rebasing onto or merging \`${previous.baseRef}\`, so the action approved again without running pi.`,
    failReason: "",
    reviewEvent: "approve",
    reviewComments: [],
    model: undefined,
  };
}
