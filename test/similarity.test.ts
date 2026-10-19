import { describe, expect, it } from 'vitest';
import { rankBySimilarity, stem, tokenize } from '../src/similarity';

describe('stem', () => {
  it.each([
    ['crashes', 'crash'],
    ['crashed', 'crash'],
    ['crashing', 'crash'],
    ['errors', 'error'],
    ['issues', 'issue'],
    ['processes', 'process'],
  ])('%s -> %s', (word, expected) => {
    expect(stem(word)).toBe(expected);
  });

  it('leaves short words and -ss/-us endings alone', () => {
    expect(stem('uses')).toBe('uses');
    expect(stem('status')).toBe('status');
    expect(stem('class')).toBe('class');
    expect(stem('string')).toBe('string');
  });
});

describe('tokenize', () => {
  it('lowercases, drops stopwords and splits on punctuation', () => {
    expect(tokenize("The CLI doesn't start: TypeError in config.load()")).toEqual([
      'cli',
      'start',
      'typeerror',
      'config',
      'load',
    ]);
  });

  it('keeps non-latin words', () => {
    expect(tokenize('Ошибка при запуске')).toEqual(['ошибка', 'при', 'запуске']);
  });
});

describe('rankBySimilarity', () => {
  const docs = [
    { id: 1, text: 'Add dark mode to the settings page' },
    { id: 2, text: 'CLI crashes when the config file is missing' },
    { id: 3, text: 'Typo in installation docs' },
    { id: 4, text: 'Crash on startup if config.yml does not exist' },
  ];

  it('ranks issues that share rare words first', () => {
    const matches = rankBySimilarity('App crashed because config file was missing', docs, {
      minScore: 0.1,
      limit: 5,
    });
    expect(matches.map((m) => m.id)).toEqual([2, 4]);
    expect(matches[0]?.score).toBeGreaterThan(matches[1]?.score ?? 1);
  });

  it('respects minScore and limit', () => {
    const query = 'config file missing crash';
    expect(rankBySimilarity(query, docs, { minScore: 0.99, limit: 5 })).toEqual([]);
    expect(rankBySimilarity(query, docs, { minScore: 0, limit: 1 })).toHaveLength(1);
  });

  it('returns nothing for an empty query or corpus', () => {
    expect(rankBySimilarity('the and of', docs, { minScore: 0, limit: 5 })).toEqual([]);
    expect(rankBySimilarity('crash', [], { minScore: 0, limit: 5 })).toEqual([]);
  });

  it('scores an identical document close to 1', () => {
    const [match] = rankBySimilarity(docs[1]?.text ?? '', docs, { minScore: 0, limit: 1 });
    expect(match?.id).toBe(2);
    expect(match?.score).toBeCloseTo(1, 5);
  });
});
