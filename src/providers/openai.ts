import { z } from 'zod';
import { postJson, ProviderError } from './http';
import type { ChatModel } from './types';

const responseSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable().optional() }) }))
    .min(1),
});

export interface OpenAIOptions {
  model: string;
  apiKey: string;
  baseUrl: string;
  reasoningEffort: string;
  timeoutMs: number;
}

// Works with anything that speaks the Chat Completions API: OpenAI itself,
// Ollama, OpenRouter, Groq, Azure AI Foundry and so on.
export function openaiModel({
  model,
  apiKey,
  baseUrl,
  reasoningEffort,
  timeoutMs,
}: OpenAIOptions): ChatModel {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  return {
    id: `openai:${model}`,
    async complete({ system, user }) {
      const data = await postJson(
        url,
        apiKey ? { authorization: `Bearer ${apiKey}` } : {},
        {
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          response_format: { type: 'json_object' },
          ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        },
        { timeoutMs },
      );

      const parsed = responseSchema.safeParse(data);
      if (!parsed.success) throw new ProviderError('unexpected chat completions response shape');
      return parsed.data.choices[0]?.message.content ?? '';
    },
  };
}
