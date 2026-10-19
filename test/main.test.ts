import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The whole action runs here with @actions/core, @actions/github and the model
// endpoint replaced by fakes, so the wiring between inputs, octokit and outputs
// is covered without network access.

interface ActionState {
  inputs: Record<string, string>;
  outputs: Record<string, string>;
  payload: Record<string, unknown>;
  failed: string | null;
}

const state = vi.hoisted((): ActionState => ({
  inputs: {},
  outputs: {},
  payload: {},
  failed: null,
}));

const issues = vi.hoisted(() => ({
  get: vi.fn(),
  listLabelsForRepo: vi.fn(),
  listForRepo: vi.fn(),
  listComments: vi.fn(),
  addLabels: vi.fn(),
  createComment: vi.fn(),
}));

vi.mock('@actions/core', () => {
  const summary = {
    addHeading: () => summary,
    addList: () => summary,
    addDetails: () => summary,
    write: () => Promise.resolve(summary),
  };
  return {
    getInput: (name: string) => state.inputs[name] ?? '',
    setOutput: (name: string, value: string) => {
      state.outputs[name] = value;
    },
    setFailed: (message: string) => {
      state.failed = message;
    },
    setSecret: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    debug: vi.fn(),
    summary,
  };
});

vi.mock('@actions/github', () => ({
  context: {
    repo: { owner: 'octo', repo: 'app' },
    eventName: 'issues',
    get payload() {
      return state.payload;
    },
  },
  getOctokit: () => ({
    rest: { issues },
    paginate: async (method: (p: unknown) => Promise<{ data: unknown[] }>, params: unknown) =>
      (await method(params)).data,
  }),
}));

const { run } = await import('../src/main');

const newIssue = {
  number: 31,
  title: 'Export to CSV drops the header row',
  body: 'When I export a report to CSV the first row with column names is missing. Version 2.4.1.',
  user: { login: 'reporter', type: 'User' },
  labels: [],
};

function modelReplies(content: string) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  state.inputs = {
    provider: 'openai',
    'base-url': 'http://localhost:11434/v1',
    model: 'local-model',
    'github-token': 'ghs_test',
  };
  state.outputs = {};
  state.failed = null;
  state.payload = { action: 'opened', issue: newIssue };

  issues.listLabelsForRepo.mockResolvedValue({
    data: [
      { name: 'bug', description: "Something isn't working" },
      { name: 'export', description: 'CSV and PDF export' },
    ],
  });
  issues.listForRepo.mockResolvedValue({
    data: [
      newIssue,
      { number: 22, title: 'CSV export missing header row', body: 'Header row not in CSV export.' },
      { number: 5, title: 'Add Slack notifications', body: 'Post to Slack when a report is ready' },
    ],
  });
  issues.listComments.mockResolvedValue({ data: [] });
  issues.addLabels.mockResolvedValue({ data: [] });
  issues.createComment.mockResolvedValue({ data: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('run', () => {
  it('triages the issue from the event payload', async () => {
    const fetchMock = modelReplies(
      JSON.stringify({
        category: 'bug',
        confidence: 0.9,
        labels: ['bug', 'export'],
        duplicates: [22],
        missing_info: [],
      }),
    );

    await run();

    expect(state.failed).toBeNull();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:11434/v1/chat/completions');
    expect(issues.addLabels).toHaveBeenCalledWith({
      owner: 'octo',
      repo: 'app',
      issue_number: 31,
      labels: ['bug', 'export'],
    });
    expect(issues.createComment).toHaveBeenCalledTimes(1);
    expect(state.outputs).toMatchObject({
      status: 'triaged',
      category: 'bug',
      labels: 'bug,export',
      duplicates: '22',
    });
    expect(state.outputs.comment).toContain('#22');
  });

  it('writes nothing in dry-run mode but still sets outputs', async () => {
    state.inputs['dry-run'] = 'true';
    modelReplies(
      JSON.stringify({
        category: 'bug',
        confidence: 0.9,
        labels: ['bug'],
        duplicates: [22],
        missing_info: [],
      }),
    );

    await run();

    expect(issues.addLabels).not.toHaveBeenCalled();
    expect(issues.createComment).not.toHaveBeenCalled();
    expect(state.outputs).toMatchObject({ status: 'dry-run', labels: 'bug', duplicates: '22' });
  });

  it('uses issue-number instead of the payload when given', async () => {
    state.inputs['issue-number'] = '31';
    state.payload = {};
    issues.get.mockResolvedValue({ data: newIssue });
    modelReplies('not json at all');

    await run();

    expect(issues.get).toHaveBeenCalledWith({ owner: 'octo', repo: 'app', issue_number: 31 });
    expect(state.outputs.status).toBe('skipped');
    expect(issues.addLabels).not.toHaveBeenCalled();
  });

  it('skips events without an issue', async () => {
    state.payload = { action: 'created' };
    await run();
    expect(state.outputs.status).toBe('skipped');
    expect(state.failed).toBeNull();
  });

  it('fails the step on a bad config or a provider error', async () => {
    state.inputs = { provider: 'gemini' };
    await run();
    expect(state.failed).toBe('api-key is required for the gemini provider');

    state.inputs = { provider: 'openai', 'api-key': 'wrong', 'github-token': 'ghs_test' };
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('invalid api key', { status: 401 })),
    );
    await run();
    expect(state.failed).toBe('api.openai.com returned 401: invalid api key');
  });
});
