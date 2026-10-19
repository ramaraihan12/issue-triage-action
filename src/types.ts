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
