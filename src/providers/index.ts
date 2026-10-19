import { anthropicModel } from './anthropic';
import { geminiModel } from './gemini';
import { openaiModel } from './openai';
import type { ChatModel } from './types';

export type { ChatModel } from './types';
export { ProviderError } from './http';

export const PROVIDERS = ['gemini', 'openai', 'anthropic'] as const;
export type Provider = (typeof PROVIDERS)[number];

// Cheapest current model per provider; classification doesn't need more.
export const DEFAULT_MODELS: Record<Provider, string> = {
  gemini: 'gemini-3.5-flash-lite',
  openai: 'gpt-6-luna',
  anthropic: 'claude-haiku-5-5',
};

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

export interface ModelConfig {
  provider: Provider;
  model: string;
  apiKey: string;
  baseUrl: string;
  reasoningEffort: string;
  timeoutMs: number;
}

export function createModel(config: ModelConfig): ChatModel {
  switch (config.provider) {
    case 'gemini':
      return geminiModel(config);
    case 'anthropic':
      return anthropicModel(config);
    case 'openai':
      return openaiModel(config);
  }
}
