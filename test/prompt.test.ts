import { describe, expect, it } from 'vitest';
import { buildPrompt } from '../src/prompt';
import type { Issue } from '../src/types';

const issue: Issue = {
  number: 42,
  title: 'Crash when\nconfig is missing',
  body: 'Steps:\n1. delete config.yml\n2. run `app start`',
  author: 'someone',
  authorIsBot: false,
  labels: [],
};

describe('buildPrompt', () => {
  it('lists labels, candidates and the new issue', () => {
    const { system, user } = buildPrompt(
      issue,
      [
        { name: 'bug', description: "Something isn't working" },
        { name: 'area: cli', description: '' },
      ],
      [{ number: 7, title: 'Startup crash', body: 'It crashes\n\nwithout a config file' }],
    );

    expect(system).toContain('"category"');
    expect(user).toContain("- bug: Something isn't working\n- area: cli\n");
    expect(user).toContain('#7 Startup crash\n  It crashes without a config file');
    expect(user).toContain(
      'NEW ISSUE #42\nTitle: Crash when config is missing\nBody:\nSteps:\n1. delete',
    );
  });

  it('says so when there are no labels or candidates', () => {
    const { user } = buildPrompt({ ...issue, body: '  ' }, [], []);
    expect(user).toContain('AVAILABLE LABELS:\n(none)');
    expect(user).toContain('similar wording):\n(none)');
    expect(user).toContain('Body:\n(empty)');
  });

  it('clips very long bodies', () => {
    const { user } = buildPrompt({ ...issue, body: 'x'.repeat(10_000) }, [], []);
    expect(user).toContain('x'.repeat(4000) + ' [...]');
    expect(user).not.toContain('x'.repeat(4001));
  });
});
