import type { getOctokit } from '@actions/github';
import { z } from 'zod';
import { MARKER } from './comment';
import type { IssueTracker } from './triage';
import type { Issue } from './types';

type Octokit = ReturnType<typeof getOctokit>;

export interface RepoRef {
  owner: string;
  repo: string;
}

// The most recent open issues are where duplicates usually live, and one page
// keeps the action to a single API call on busy repos.
const RECENT_OPEN_ISSUES = 100;

const rawIssueSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullish(),
  user: z.object({ login: z.string(), type: z.string() }).nullish(),
  labels: z.array(z.union([z.string(), z.object({ name: z.string().nullish() })])).default([]),
  pull_request: z.unknown().optional(),
});

function toIssue(raw: z.infer<typeof rawIssueSchema>): Issue {
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body ?? '',
    author: raw.user?.login ?? '',
    authorIsBot: raw.user?.type === 'Bot',
    labels: raw.labels
      .map((label) => (typeof label === 'string' ? label : (label.name ?? '')))
      .filter((name) => name.length > 0),
  };
}

// Returns null for events that don't carry a plain issue (pull requests share
// the issues API, and issue_comment events can point at either).
export function issueFromPayload(payload: { issue?: unknown }): Issue | null {
  const parsed = rawIssueSchema.safeParse(payload.issue);
  if (!parsed.success || parsed.data.pull_request !== undefined) return null;
  return toIssue(parsed.data);
}

export function githubTracker(
  octokit: Octokit,
  repo: RepoRef,
): IssueTracker & { getIssue(issueNumber: number): Promise<Issue> } {
  return {
    async getIssue(issueNumber) {
      const { data } = await octokit.rest.issues.get({ ...repo, issue_number: issueNumber });
      const raw = rawIssueSchema.parse(data);
      if (raw.pull_request !== undefined) throw new Error(`#${issueNumber} is a pull request`);
      return toIssue(raw);
    },

    async listLabels() {
      const labels = await octokit.paginate(octokit.rest.issues.listLabelsForRepo, {
        ...repo,
        per_page: 100,
      });
      return labels.map((label) => ({ name: label.name, description: label.description ?? '' }));
    },

    async listOpenIssues() {
      const { data } = await octokit.rest.issues.listForRepo({
        ...repo,
        state: 'open',
        sort: 'created',
        direction: 'desc',
        per_page: RECENT_OPEN_ISSUES,
      });
      return data
        .filter((item) => !item.pull_request)
        .map((item) => ({ number: item.number, title: item.title, body: item.body ?? '' }));
    },

    async hasTriageComment(issueNumber) {
      const comments = await octokit.paginate(octokit.rest.issues.listComments, {
        ...repo,
        issue_number: issueNumber,
        per_page: 100,
      });
      return comments.some((comment) => comment.body?.includes(MARKER) === true);
    },

    async addLabels(issueNumber, labels) {
      await octokit.rest.issues.addLabels({ ...repo, issue_number: issueNumber, labels });
    },

    async createComment(issueNumber, body) {
      await octokit.rest.issues.createComment({ ...repo, issue_number: issueNumber, body });
    },
  };
}
