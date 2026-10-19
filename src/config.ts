import { DEFAULT_MODELS, DEFAULT_OPENAI_BASE_URL, PROVIDERS, type ModelConfig } from './providers';
import type { TriageOptions } from './triage';

export interface Config {
  githubToken: string;
  issueNumber: number | null;
  model: ModelConfig;
  triage: TriageOptions;
}

export type GetInput = (name: string) => string;

const MODES = ['comment', 'labels'] as const;

function oneOf<T extends string>(name: string, allowed: readonly T[], value: string): T {
  const match = allowed.find((option) => option === value.toLowerCase());
  if (!match) throw new Error(`${name} must be one of ${allowed.join(', ')} (got "${value}")`);
  return match;
}

function bool(name: string, value: string): boolean {
  if (value === '') return false;
  if (/^true$/i.test(value)) return true;
  if (/^false$/i.test(value)) return false;
  throw new Error(`${name} must be true or false (got "${value}")`);
}

// Takes the input getter as a parameter so the same parsing serves the action
// (core.getInput) and the local runner (CLI flags).
export function readConfig(getInput: GetInput): Config {
  const input = (name: string) => getInput(name).trim();

  const provider = oneOf('provider', PROVIDERS, input('provider') || 'gemini');
  const baseUrl = input('base-url');
  const apiKey = input('api-key');

  if (baseUrl && provider !== 'openai') {
    throw new Error('base-url only applies to the openai provider');
  }
  // A local OpenAI-compatible server (Ollama, llama.cpp, vLLM) usually has no key.
  if (!apiKey && !(provider === 'openai' && baseUrl)) {
    throw new Error(`api-key is required for the ${provider} provider`);
  }

  const minConfidence = Number(input('min-confidence') || '0.6');
  if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) {
    throw new Error(
      `min-confidence must be a number between 0 and 1 (got "${input('min-confidence')}")`,
    );
  }

  const timeoutSeconds = Number(input('timeout-seconds') || '120');
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new Error(
      `timeout-seconds must be a positive number (got "${input('timeout-seconds')}")`,
    );
  }

  const rawIssueNumber = input('issue-number');
  const issueNumber = rawIssueNumber ? Number(rawIssueNumber) : null;
  if (issueNumber !== null && (!Number.isInteger(issueNumber) || issueNumber <= 0)) {
    throw new Error(`issue-number must be a positive integer (got "${rawIssueNumber}")`);
  }

  return {
    githubToken: input('github-token'),
    issueNumber,
    model: {
      provider,
      model: input('model') || DEFAULT_MODELS[provider],
      apiKey,
      baseUrl: baseUrl || DEFAULT_OPENAI_BASE_URL,
      reasoningEffort: input('reasoning-effort'),
      timeoutMs: timeoutSeconds * 1000,
    },
    triage: {
      mode: oneOf('mode', MODES, input('mode') || 'comment'),
      dryRun: bool('dry-run', input('dry-run')),
      minConfidence,
    },
  };
}
