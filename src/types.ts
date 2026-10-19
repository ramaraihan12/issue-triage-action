export interface IssueSummary {
  number: number;
  title: string;
  body: string;
}

export interface Issue extends IssueSummary {
  author: string;
  authorIsBot: boolean;
  labels: string[];
}

export interface RepoLabel {
  name: string;
  description: string;
}

export const CATEGORIES = ['bug', 'feature', 'question', 'docs'] as const;
export type Category = (typeof CATEGORIES)[number];

export const MISSING_INFO = ['version', 'steps', 'logs', 'os', 'expected_vs_actual'] as const;
export type MissingInfo = (typeof MISSING_INFO)[number];
