import { z } from 'zod';
import { CATEGORIES } from './types';

const issueNumber = z.union([
  z.number().int().positive(),
  z
    .string()
    .regex(/^#?\d+$/)
    .transform((value) => Number(value.replace('#', ''))),
]);

const verdictSchema = z.object({
  category: z.enum(CATEGORIES),
  confidence: z.number().min(0).max(1),
  labels: z.array(z.string()),
  duplicates: z.array(issueNumber),
  missing_info: z.array(z.string()),
});

export type Verdict = z.infer<typeof verdictSchema>;

// Thinking models served through OpenAI-compatible APIs sometimes leak their
// reasoning into the content, and some models wrap JSON in a code fence.
function extractJsonObject(raw: string): string | null {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start === -1 || end <= start ? null : text.slice(start, end + 1);
}

export type ParseResult = { ok: true; verdict: Verdict } | { ok: false; error: string };

export function parseVerdict(raw: string): ParseResult {
  const json = extractJsonObject(raw);
  if (json === null) return { ok: false, error: 'no JSON object in the response' };

  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, error: 'response is not valid JSON' };
  }

  const result = verdictSchema.safeParse(data);
  if (!result.success) {
    return { ok: false, error: z.prettifyError(result.error).replace(/\n/g, '; ') };
  }
  return { ok: true, verdict: result.data };
}
