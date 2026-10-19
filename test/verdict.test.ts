import { describe, expect, it } from 'vitest';
import { parseVerdict } from '../src/verdict';

const valid = {
  category: 'bug',
  confidence: 0.9,
  labels: ['bug'],
  duplicates: [12],
  missing_info: ['the version you are running'],
};

describe('parseVerdict', () => {
  it('accepts a clean JSON object', () => {
    expect(parseVerdict(JSON.stringify(valid))).toEqual({ ok: true, verdict: valid });
  });

  it('digs the object out of code fences and leaked reasoning', () => {
    const raw = `<think>maybe {"category": "feature"}?</think>\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``;
    expect(parseVerdict(raw)).toEqual({ ok: true, verdict: valid });
  });

  it('accepts issue numbers written as strings', () => {
    const result = parseVerdict(JSON.stringify({ ...valid, duplicates: ['#12', '7'] }));
    expect(result.ok && result.verdict.duplicates).toEqual([12, 7]);
  });

  it.each([
    ['plain prose', 'This looks like a bug to me.'],
    ['broken JSON', '{"category": "bug",'],
    ['unknown category', JSON.stringify({ ...valid, category: 'enhancement' })],
    ['confidence out of range', JSON.stringify({ ...valid, confidence: 7 })],
    ['missing field', JSON.stringify({ category: 'bug', confidence: 0.9 })],
    ['labels as a string', JSON.stringify({ ...valid, labels: 'bug' })],
  ])('rejects %s', (_name, raw) => {
    const result = parseVerdict(raw);
    expect(result.ok).toBe(false);
  });
});
