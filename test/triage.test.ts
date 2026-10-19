import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKER } from '../src/comment';
import type { ChatModel } from '../src/providers';
import {
  findCandidates,
  resolveLabels,
  triageIssue,
  type IssueTracker,
  type TriageOptions,
} from '../src/triage';
import type { Issue } from '../src/types';

const issue: Issue = {
  number: 50,
  title: 'CLI crashes when the config file is missing',
  body: 'Deleting config.yml and running `app start` throws ENOENT and the CLI crashes.',
  author: 'reporter',
  authorIsBot: false,
  labels: [],
};

const openIssues = [
  { number: 50, title: issue.title, body: issue.body },
  { number: 12, title: 'Crash on startup without config file', body: 'ENOENT config.yml' },
  { number: 20, title: 'Add dark mode', body: 'Please add a dark theme to the settings page.' },
];

const repoLabels = [
  { name: 'bug', description: "Something isn't working" },
  { name: 'Area: CLI', description: 'Command line interface' },
  { name: 'enhancement', description: 'New feature or request' },
  { name: 'duplicate', description: 'This issue already exists' },
];

function fakeTracker({ alreadyTriaged = false } = {}) {
  return {
    listLabels: vi.fn<IssueTracker['listLabels']>().mockResolvedValue(repoLabels),
    listOpenIssues: vi.fn<IssueTracker['listOpenIssues']>().mockResolvedValue(openIssues),
    hasTriageComment: vi.fn<IssueTracker['hasTriageComment']>().mockResolvedValue(alreadyTriaged),
    addLabels: vi.fn<IssueTracker['addLabels']>().mockResolvedValue(undefined),
    createComment: vi.fn<IssueTracker['createComment']>().mockResolvedValue(undefined),
  };
}

function fakeModel(answer: unknown) {
  const complete = vi
    .fn<ChatModel['complete']>()
    .mockResolvedValue(typeof answer === 'string' ? answer : JSON.stringify(answer));
  return { id: 'fake:model', complete };
}

const log = { info: vi.fn(), warning: vi.fn(), debug: vi.fn() };
const options: TriageOptions = { mode: 'comment', dryRun: false, minConfidence: 0.6 };

const goodAnswer = {
  category: 'bug',
  confidence: 0.92,
  labels: ['bug', 'area: cli', 'priority: high', 'duplicate'],
  duplicates: [12, 99],
  missing_info: ['the version you are running'],
};

beforeEach(() => vi.clearAllMocks());

describe('findCandidates', () => {
  it('finds the lexically similar issue and skips the issue itself', () => {
    expect(findCandidates(issue, openIssues).map((c) => c.number)).toEqual([12]);
  });
});

describe('resolveLabels', () => {
  it('maps names case-insensitively, drops unknown and already applied labels, caps at 3', () => {
    const labels = [...repoLabels, { name: 'docs', description: '' }];
    expect(resolveLabels(['BUG', 'nope', 'area: cli', 'docs', 'enhancement'], labels, [])).toEqual([
      'bug',
      'Area: CLI',
      'docs',
    ]);
    expect(resolveLabels(['bug', 'Bug'], labels, ['Bug'])).toEqual([]);
  });
});

describe('triageIssue', () => {
  it('labels the issue and posts one comment', async () => {
    const tracker = fakeTracker();
    const model = fakeModel(goodAnswer);

    const result = await triageIssue(issue, { tracker, model, log }, options);

    expect(result.status).toBe('triaged');
    expect(tracker.addLabels).toHaveBeenCalledWith(50, ['bug', 'Area: CLI']);
    expect(tracker.createComment).toHaveBeenCalledTimes(1);
    const body = tracker.createComment.mock.calls[0]?.[1];
    expect(body).toContain(MARKER);
    expect(body).toContain('#12');
    expect(body).not.toContain('#99');
    expect(body).toContain('- the version you are running');
  });

  it('never shows reserved labels to the model', async () => {
    const tracker = fakeTracker();
    const model = fakeModel(goodAnswer);

    await triageIssue(issue, { tracker, model, log }, options);

    const prompt = model.complete.mock.calls[0]?.[0];
    expect(prompt?.user).toContain('- bug:');
    expect(prompt?.user).not.toContain('- duplicate');
    expect(prompt?.user).toContain('#12 Crash on startup without config file');
  });

  it('only reports the plan in dry-run mode', async () => {
    const tracker = fakeTracker();
    const result = await triageIssue(
      issue,
      { tracker, model: fakeModel(goodAnswer), log },
      { ...options, dryRun: true },
    );

    expect(result).toMatchObject({
      status: 'dry-run',
      plan: { category: 'bug', labels: ['bug', 'Area: CLI'] },
    });
    expect(result.status === 'dry-run' && result.plan.duplicates.map((d) => d.number)).toEqual([
      12,
    ]);
    expect(tracker.addLabels).not.toHaveBeenCalled();
    expect(tracker.createComment).not.toHaveBeenCalled();
  });

  it('does not comment in labels mode', async () => {
    const tracker = fakeTracker();
    const result = await triageIssue(
      issue,
      { tracker, model: fakeModel(goodAnswer), log },
      { ...options, mode: 'labels' },
    );

    expect(result.status === 'triaged' && result.plan.comment).toBeNull();
    expect(tracker.addLabels).toHaveBeenCalled();
    expect(tracker.createComment).not.toHaveBeenCalled();
  });

  it('skips commenting when there is nothing useful to say', async () => {
    const tracker = fakeTracker();
    const model = fakeModel({ ...goodAnswer, duplicates: [], missing_info: [] });

    await triageIssue(issue, { tracker, model, log }, options);

    expect(tracker.addLabels).toHaveBeenCalledWith(50, ['bug', 'Area: CLI']);
    expect(tracker.createComment).not.toHaveBeenCalled();
  });

  it('stops before calling the model if a triage comment already exists', async () => {
    const tracker = fakeTracker({ alreadyTriaged: true });
    const model = fakeModel(goodAnswer);

    const result = await triageIssue(issue, { tracker, model, log }, options);

    expect(result).toEqual({ status: 'skipped', reason: '#50 already has a triage comment' });
    expect(model.complete).not.toHaveBeenCalled();
    expect(tracker.createComment).not.toHaveBeenCalled();
  });

  it('ignores issues opened by bots', async () => {
    const tracker = fakeTracker();
    const model = fakeModel(goodAnswer);

    const result = await triageIssue(
      { ...issue, authorIsBot: true },
      { tracker, model, log },
      options,
    );

    expect(result.status).toBe('skipped');
    expect(tracker.hasTriageComment).not.toHaveBeenCalled();
    expect(model.complete).not.toHaveBeenCalled();
  });

  it.each([
    ['prose', 'I think this is a bug, label it bug.'],
    ['wrong shape', { category: 'bug', labels: 'bug' }],
    ['made-up category', { ...goodAnswer, category: 'crash' }],
  ])('does nothing when the model returns %s', async (_name, answer) => {
    const tracker = fakeTracker();

    const result = await triageIssue(issue, { tracker, model: fakeModel(answer), log }, options);

    expect(result).toEqual({ status: 'skipped', reason: 'model output was not valid' });
    expect(log.warning).toHaveBeenCalled();
    expect(tracker.addLabels).not.toHaveBeenCalled();
    expect(tracker.createComment).not.toHaveBeenCalled();
  });

  it('does nothing when the model is unsure', async () => {
    const tracker = fakeTracker();
    const model = fakeModel({ ...goodAnswer, confidence: 0.4 });

    const result = await triageIssue(issue, { tracker, model, log }, options);

    expect(result).toEqual({
      status: 'skipped',
      reason: 'confidence 0.4 is below min-confidence 0.6',
    });
    expect(tracker.addLabels).not.toHaveBeenCalled();
  });

  it('lets a model error bubble up', async () => {
    const model = { id: 'fake:model', complete: vi.fn().mockRejectedValue(new Error('401')) };
    await expect(
      triageIssue(issue, { tracker: fakeTracker(), model, log }, options),
    ).rejects.toThrow('401');
  });
});
