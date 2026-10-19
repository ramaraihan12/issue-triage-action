import type { Category, IssueSummary, MissingInfo } from './types';

// Hidden in every comment the action posts, so a re-run can tell it already spoke.
export const MARKER = '<!-- issue-triage-action -->';

const CATEGORY_PHRASE: Record<Category, string> = {
  bug: 'a bug report',
  feature: 'a feature request',
  question: 'a question',
  docs: 'a docs issue',
};

// What the bot asks for. The model only picks keys, so its own wording never
// reaches a public comment.
const ASK: Record<MissingInfo, string> = {
  version: 'the version you are running',
  steps: 'steps to reproduce it',
  logs: 'any error output or logs',
  os: 'your operating system',
  expected_vs_actual: 'what you expected to happen and what happened instead',
};

// Issue titles come from other users and end up in the comment, so strip
// anything that could ping people, inject HTML or smuggle in links. GitHub
// autolinks http(s):// and www. hosts, and mail clients showing the
// notification also link bare domains, so anything shaped like host/path goes
// too. Issue references are dropped because GitHub posts a cross-reference on
// the issue they point to, in any repo.
export function sanitize(text: string, maxLength = 140): string {
  const clean = text
    .replace(/(?:https?:\/\/|\bwww\.)\S+/gi, '')
    .replace(/\b[\w-]+(?:\.[\w-]+)+\/\S*/g, '')
    .replace(/&#?\w+;/g, '')
    .replace(/(?:\b[\w.-]+\/[\w.-]+)?#\d+\b|\bgh-\d+\b/gi, '')
    .replace(/[<>[\]`*_|]/g, '')
    .replace(/@(?=[\w-])/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength - 3).trimEnd()}...`;
}

export interface CommentInput {
  category: Category;
  duplicates: IssueSummary[];
  missingInfo: MissingInfo[];
}

// Returns null when there is nothing worth saying; a comment that only repeats
// the labels is noise in the author's notifications.
export function renderComment({ category, duplicates, missingInfo }: CommentInput): string | null {
  if (duplicates.length === 0 && missingInfo.length === 0) return null;

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

  if (missingInfo.length > 0) {
    const list = missingInfo.map((item) => `- ${ASK[item]}`).join('\n');
    parts.push(`To make it easier for someone to pick this up, could you add:\n${list}`);
  }

  parts.push(
    '<sub>Automated triage. A maintainer will take a look and may change the labels.</sub>',
  );
  return parts.join('\n\n');
}
