import { z } from 'zod';
import { postJson, ProviderError } from './http';
import type { ChatModel } from './types';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const responseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z.array(
              z.object({ text: z.string().optional(), thought: z.boolean().optional() }),
            ),
          })
          .optional(),
      }),
    )
    .optional(),
});

export function geminiModel({ model, apiKey }: { model: string; apiKey: string }): ChatModel {
  const url = `${BASE_URL}/${encodeURIComponent(model)}:generateContent`;

  return {
    id: `gemini:${model}`,
    async complete({ system, user }) {
      const data = await postJson(
        url,
        { 'x-goog-api-key': apiKey },
        {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { responseMimeType: 'application/json' },
        },
      );

      const parsed = responseSchema.safeParse(data);
      if (!parsed.success) throw new ProviderError('unexpected generateContent response shape');
      // No candidates means the prompt was blocked; treat it as an empty answer.
      const parts = parsed.data.candidates?.[0]?.content?.parts ?? [];
      return parts
        .filter((part) => !part.thought)
        .map((part) => part.text ?? '')
        .join('');
    },
  };
}
