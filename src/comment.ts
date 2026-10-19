import type { Category, IssueSummary } from './types';

// Hidden in every comment the action posts, so a re-run can tell it already spoke.
export const MARKER = '<!-- issue-triage-action -->';

const CATEGORY_PHRASE: Record<Category, string> = {
  bug: 'a bug report',
  feature: 'a feature request',
  question: 'a question',
  docs: 'a docs issue',
};

// Model output ends up in a public comment, so strip anything that could ping
// people, inject HTML or smuggle in links.
export function sanitize(text: string, maxLength = 140): string {
  const clean = text
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[<>[\]`*_|]/g, '')
    .replace(/@(?=[\w-])/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength - 3).trimEnd()}...`;
}

export interface CommentInput {
  category: Category;
  duplicates: IssueSummary[];
  missingInfo: string[];
}

// Returns null when there is nothing worth saying; a comment that only repeats
// the labels is noise in the author's notifications.
export function renderComment({ category, duplicates, missingInfo }: CommentInput): string | null {
  const asks = missingInfo.map((item) => sanitize(item)).filter((item) => item.length > 0);
  if (duplicates.length === 0 && asks.length === 0) return null;

  const parts = [MARKER, `Thanks for opening this. It reads like ${CATEGORY_PHRASE[category]}.`];

  const [only] = duplicates;
  if (only && duplicates.length === 1) {
    parts.push(
      `It might be the same as #${only.number} (${sanitize(only.title, 80)}). If it is, a thumbs up and any extra details over there help more than a second thread.`,
    );
  } else if (duplicates.length > 1) {
    const list = duplicates.map((d) => `- #${d.number} ${sanitize(d.title, 80)}`).join('\n');
    parts.push(`These open issues look similar, so it may already be tracked:\n${list}`);
  }

  if (asks.length > 0) {
    const list = asks.map((item) => `- ${item}`).join('\n');
    parts.push(`To make it easier for someone to pick this up, could you add:\n${list}`);
  }

  parts.push(
    '<sub>Automated triage. A maintainer will take a look and may change the labels.</sub>',
  );
  return parts.join('\n\n');
}
