import { describe, expect, it } from 'vitest';
import { readConfig } from '../src/config';

function inputs(values: Record<string, string>) {
  return (name: string) => values[name] ?? '';
}

describe('readConfig', () => {
  it('defaults to gemini in comment mode', () => {
    const config = readConfig(inputs({ 'api-key': 'secret', 'github-token': 'ghs_x' }));

    expect(config).toEqual({
      githubToken: 'ghs_x',
      issueNumber: null,
      model: {
        provider: 'gemini',
        model: 'gemini-3.5-flash-lite',
        apiKey: 'secret',
        baseUrl: 'https://api.openai.com/v1',
        reasoningEffort: '',
        timeoutMs: 120_000,
      },
      triage: { mode: 'comment', dryRun: false, minConfidence: 0.6 },
    });
  });

  it('allows a keyless openai-compatible server', () => {
    const config = readConfig(
      inputs({
        provider: 'openai',
        'base-url': 'http://localhost:11434/v1',
        model: 'qwen3.5-9b:iq4xs',
        'reasoning-effort': 'none',
        mode: 'labels',
        'dry-run': 'TRUE',
        'min-confidence': '0.75',
        'issue-number': '17',
        'timeout-seconds': '600',
      }),
    );

    expect(config.model).toMatchObject({
      provider: 'openai',
      apiKey: '',
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen3.5-9b:iq4xs',
      reasoningEffort: 'none',
      timeoutMs: 600_000,
    });
    expect(config.triage).toEqual({ mode: 'labels', dryRun: true, minConfidence: 0.75 });
    expect(config.issueNumber).toBe(17);
  });

  it.each([
    [{ provider: 'gemini' }, 'api-key is required for the gemini provider'],
    [{ provider: 'openai' }, 'api-key is required for the openai provider'],
    [{ provider: 'cohere', 'api-key': 'k' }, 'provider must be one of gemini, openai, anthropic'],
    [{ provider: 'anthropic', 'api-key': 'k', 'base-url': 'http://x' }, 'base-url only applies'],
    [{ 'api-key': 'k', mode: 'loud' }, 'mode must be one of comment, labels'],
    [{ 'api-key': 'k', 'dry-run': 'yes please' }, 'dry-run must be true or false'],
    [
      { 'api-key': 'k', 'min-confidence': '1.5' },
      'min-confidence must be a number between 0 and 1',
    ],
    [{ 'api-key': 'k', 'issue-number': '-3' }, 'issue-number must be a positive integer'],
    [{ 'api-key': 'k', 'timeout-seconds': '0' }, 'timeout-seconds must be a positive number'],
  ])('rejects %o', (values, message) => {
    expect(() => readConfig(inputs(values))).toThrow(message);
  });
});
