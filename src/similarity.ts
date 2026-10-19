// Lexical duplicate search: TF-IDF vectors compared with cosine similarity.
// It only has to narrow ~100 open issues down to a handful of candidates;
// the model makes the final call on which ones are real duplicates.

const STOPWORDS = new Set(
  `a about after all also am an and any are as at be because been but by can could did do does
  doing don doesn didn isn wasn for from get got had has have how i if in into is it its just like me my no not now
  of on or our out so some than that the their them then there these they this to too up us was
  we were what when where which while who why will with would you your yes please thanks thank
  hi hello issue problem`.split(/\s+/),
);

export function stem(word: string): string {
  if (word.length <= 4) return word;
  if (word.endsWith('ing') && word.length >= 7) return word.slice(0, -3);
  if (word.endsWith('ed') && word.length >= 6) return word.slice(0, -2);
  if (/(?:s|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !/(?:ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
    .map(stem);
}

export interface SimilarityDoc {
  id: number;
  text: string;
}

export interface SimilarityMatch {
  id: number;
  score: number;
}

type Vector = Map<string, number>;

function termCounts(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

function weigh(counts: Map<string, number>, idf: Map<string, number>): Vector {
  const vector: Vector = new Map();
  let norm = 0;
  for (const [term, count] of counts) {
    const weight = (1 + Math.log(count)) * (idf.get(term) ?? 0);
    vector.set(term, weight);
    norm += weight * weight;
  }
  norm = Math.sqrt(norm);
  if (norm === 0) return vector;
  for (const [term, weight] of vector) vector.set(term, weight / norm);
  return vector;
}

function cosine(a: Vector, b: Vector): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [term, weight] of small) dot += weight * (large.get(term) ?? 0);
  return dot;
}

export function rankBySimilarity(
  query: string,
  docs: SimilarityDoc[],
  options: { minScore: number; limit: number },
): SimilarityMatch[] {
  const queryCounts = termCounts(tokenize(query));
  if (queryCounts.size === 0 || docs.length === 0) return [];

  const docCounts = docs.map((doc) => termCounts(tokenize(doc.text)));

  // The query counts as a document too, so every query term has a defined idf.
  const total = docs.length + 1;
  const docFrequency = new Map<string, number>();
  for (const counts of [queryCounts, ...docCounts]) {
    for (const term of counts.keys()) docFrequency.set(term, (docFrequency.get(term) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [term, df] of docFrequency) idf.set(term, Math.log((total + 1) / (df + 1)) + 1);

  const queryVector = weigh(queryCounts, idf);
  return docs
    .map((doc, i) => ({
      id: doc.id,
      score: cosine(queryVector, weigh(docCounts[i] ?? new Map(), idf)),
    }))
    .filter((match) => match.score >= options.minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit);
}
