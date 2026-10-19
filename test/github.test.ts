import type { getOctokit } from '@actions/github';
import { describe, expect, it, vi } from 'vitest';
import { MARKER } from '../src/comment';
import { githubTracker, issueFromPayload } from '../src/github';

const repo = { owner: 'octo', repo: 'app' };

const rawIssue = {
  number: 7,
  title: 'Broken build',
  body: null,
  user: { login: 'dependabot[bot]', type: 'Bot' },
  labels: ['bug', { name: 'ci' }, { name: null }],
};

function mockOctokit() {
  const issues = {
    get: vi.fn().mockResolvedValue({ data: rawIssue }),
    listLabelsForRepo: vi.fn().mockResolvedValue({
      data: [
        { name: 'bug', description: "Something isn't working" },
        { name: 'ci', description: null },
      ],
    }),
    listForRepo: vi.fn().mockResolvedValue({
      data: [
        { number: 9, title: 'PR', body: '', pull_request: { url: 'x' } },
        { number: 8, title: 'Older issue', body: null },
      ],
    }),
    listComments: vi.fn().mockResolvedValue({
      data: [{ body: 'thanks!' }, { body: `${MARKER}\nThanks for opening this.` }],
    }),
    addLabels: vi.fn().mockResolvedValue({ data: [] }),
    createComment: vi.fn().mockResolvedValue({ data: {} }),
  };
  const octokit = {
    rest: { issues },
    paginate: vi.fn(
      async (method: (params: unknown) => Promise<{ data: unknown[] }>, params: unknown) =>
        (await method(params)).data,
    ),
  };
  return { issues, octokit: octokit as unknown as ReturnType<typeof getOctokit> };
}

describe('issueFromPayload', () => {
  it('normalises the webhook issue', () => {
    expect(issueFromPayload({ issue: rawIssue })).toEqual({
      number: 7,
      title: 'Broken build',
      body: '',
      author: 'dependabot[bot]',
      authorIsBot: true,
      labels: ['bug', 'ci'],
    });
  });

  it('returns null for pull requests and events without an issue', () => {
    expect(issueFromPayload({ issue: { ...rawIssue, pull_request: {} } })).toBeNull();
    expect(issueFromPayload({})).toBeNull();
  });
});

describe('githubTracker', () => {
  it('reads labels, open issues and the marker comment', async () => {
    const { octokit, issues } = mockOctokit();
    const tracker = githubTracker(octokit, repo);

    await expect(tracker.listLabels()).resolves.toEqual([
      { name: 'bug', description: "Something isn't working" },
      { name: 'ci', description: '' },
    ]);
    await expect(tracker.listOpenIssues()).resolves.toEqual([
      { number: 8, title: 'Older issue', body: '' },
    ]);
    expect(issues.listForRepo).toHaveBeenCalledWith({
      ...repo,
      state: 'open',
      sort: 'created',
      direction: 'desc',
      per_page: 100,
    });
    await expect(tracker.hasTriageComment(7)).resolves.toBe(true);
    expect(issues.listComments).toHaveBeenCalledWith({ ...repo, issue_number: 7, per_page: 100 });
  });

  it('reports no marker when nobody has triaged yet', async () => {
    const { octokit, issues } = mockOctokit();
    issues.listComments.mockResolvedValue({ data: [{ body: 'me too' }, { body: null }] });
    await expect(githubTracker(octokit, repo).hasTriageComment(7)).resolves.toBe(false);
  });

  it('writes labels and comments to the right issue', async () => {
    const { octokit, issues } = mockOctokit();
    const tracker = githubTracker(octokit, repo);

    await tracker.addLabels(7, ['bug']);
    await tracker.createComment(7, 'hello');

    expect(issues.addLabels).toHaveBeenCalledWith({ ...repo, issue_number: 7, labels: ['bug'] });
    expect(issues.createComment).toHaveBeenCalledWith({ ...repo, issue_number: 7, body: 'hello' });
  });

  it('fetches a single issue and refuses pull requests', async () => {
    const { octokit, issues } = mockOctokit();
    const tracker = githubTracker(octokit, repo);

    await expect(tracker.getIssue(7)).resolves.toMatchObject({ number: 7, authorIsBot: true });
    issues.get.mockResolvedValueOnce({ data: { ...rawIssue, pull_request: {} } });
    await expect(tracker.getIssue(7)).rejects.toThrow('#7 is a pull request');
  });
});
