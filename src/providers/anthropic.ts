import { z } from 'zod';
import { postJson, ProviderError } from './http';
import type { ChatModel } from './types';

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

const responseSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
});

interface AnthropicOptions {
  model: string;
  apiKey: string;
  timeoutMs: number;
}

export function anthropicModel({ model, apiKey, timeoutMs }: AnthropicOptions): ChatModel {
  return {
    id: `anthropic:${model}`,
    async complete({ system, user }) {
      const data = await postJson(
        MESSAGES_URL,
        { 'x-api-key': apiKey, 'anthropic-version': API_VERSION },
        { model, max_tokens: 1024, system, messages: [{ role: 'user', content: user }] },
        { timeoutMs },
      );

      const parsed = responseSchema.safeParse(data);
      if (!parsed.success) throw new ProviderError('unexpected messages API response shape');
      return parsed.data.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('');
    },
  };
}
