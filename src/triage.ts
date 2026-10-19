import { renderComment } from './comment';
import { buildPrompt } from './prompt';
import type { ChatModel } from './providers';
import { rankBySimilarity } from './similarity';
import type { Category, Issue, IssueSummary, RepoLabel } from './types';
import { parseVerdict } from './verdict';

export interface IssueTracker {
  listLabels(): Promise<RepoLabel[]>;
  listOpenIssues(): Promise<IssueSummary[]>;
  hasTriageComment(issueNumber: number): Promise<boolean>;
  addLabels(issueNumber: number, labels: string[]): Promise<void>;
  createComment(issueNumber: number, body: string): Promise<void>;
}

export interface Logger {
  info(message: string): void;
  warning(message: string): void;
  debug(message: string): void;
}

export interface TriageOptions {
  mode: 'comment' | 'labels';
  dryRun: boolean;
  minConfidence: number;
}

export interface TriagePlan {
  category: Category;
  confidence: number;
  labels: string[];
  duplicates: IssueSummary[];
  comment: string | null;
}

export type TriageResult =
  { status: 'skipped'; reason: string } | { status: 'triaged' | 'dry-run'; plan: TriagePlan };

const MAX_LABELS = 3;
const MAX_MISSING_INFO = 3;
const MAX_CANDIDATES = 5;
const MIN_SIMILARITY = 0.2;

// These record a maintainer's decision, so the action never offers them to the model.
const RESERVED_LABELS = new Set([
  'duplicate',
  'invalid',
  'wontfix',
  "won't fix",
  'good first issue',
  'help wanted',
]);

function similarityText(issue: IssueSummary): string {
  // The title goes in twice so it outweighs a long stack trace in the body.
  return `${issue.title}\n${issue.title}\n${issue.body.slice(0, 3000)}`;
}

export function findCandidates(issue: Issue, openIssues: IssueSummary[]): IssueSummary[] {
  const others = new Map(
    openIssues.filter((other) => other.number !== issue.number).map((o) => [o.number, o]),
  );
  const matches = rankBySimilarity(
    similarityText(issue),
    [...others.values()].map((other) => ({ id: other.number, text: similarityText(other) })),
    { minScore: MIN_SIMILARITY, limit: MAX_CANDIDATES },
  );
  return matches.flatMap((match) => others.get(match.id) ?? []);
}

// Common names for the type labels. Models often pick only the specific labels
// ("area: build") and skip the obvious one, so the action adds it itself.
const CATEGORY_LABELS: Record<Category, string[]> = {
  bug: ['bug', 'type: bug', 'kind/bug', 'type/bug'],
  feature: ['enhancement', 'feature', 'feature request', 'type: feature', 'kind/feature'],
  question: ['question', 'type: question', 'kind/question'],
  docs: ['documentation', 'docs', 'type: docs', 'kind/docs', 'kind/documentation'],
};

export function categoryLabel(category: Category, available: RepoLabel[]): string | null {
  const byName = new Map(available.map((label) => [label.name.toLowerCase(), label.name]));
  for (const name of CATEGORY_LABELS[category]) {
    const label = byName.get(name);
    if (label) return label;
  }
  return null;
}

export function resolveLabels(
  picked: string[],
  available: RepoLabel[],
  current: string[],
): string[] {
  const canonical = new Map(available.map((label) => [label.name.toLowerCase(), label.name]));
  const alreadyOn = new Set(current.map((name) => name.toLowerCase()));
  const result = new Set<string>();

  for (const name of picked) {
    const key = name.trim().toLowerCase();
    const label = canonical.get(key);
    if (label && !alreadyOn.has(key)) result.add(label);
  }
  return [...result].slice(0, MAX_LABELS);
}

export async function triageIssue(
  issue: Issue,
  { tracker, model, log }: { tracker: IssueTracker; model: ChatModel; log: Logger },
  options: TriageOptions,
): Promise<TriageResult> {
  if (issue.authorIsBot) {
    return { status: 'skipped', reason: `#${issue.number} was opened by a bot` };
  }
  if (await tracker.hasTriageComment(issue.number)) {
    return { status: 'skipped', reason: `#${issue.number} already has a triage comment` };
  }

  const [repoLabels, openIssues] = await Promise.all([
    tracker.listLabels(),
    tracker.listOpenIssues(),
  ]);
  const labels = repoLabels.filter((label) => !RESERVED_LABELS.has(label.name.toLowerCase()));
  const candidates = findCandidates(issue, openIssues);
  log.info(
    candidates.length > 0
      ? `Duplicate candidates: ${candidates.map((c) => `#${c.number}`).join(', ')}`
      : `No similar open issues among the ${openIssues.length} checked`,
  );

  log.info(`Asking ${model.id} to triage #${issue.number}`);
  const raw = await model.complete(buildPrompt(issue, labels, candidates));
  const parsed = parseVerdict(raw);
  if (!parsed.ok) {
    log.warning(`Model output was not usable (${parsed.error}). Leaving the issue alone.`);
    log.debug(`Raw model output: ${raw.slice(0, 2000)}`);
    return { status: 'skipped', reason: 'model output was not valid' };
  }

  const { verdict } = parsed;
  if (verdict.confidence < options.minConfidence) {
    return {
      status: 'skipped',
      reason: `confidence ${verdict.confidence} is below min-confidence ${options.minConfidence}`,
    };
  }

  const candidateByNumber = new Map(candidates.map((c) => [c.number, c]));
  const duplicates = [...new Set(verdict.duplicates)].flatMap(
    (n) => candidateByNumber.get(n) ?? [],
  );
  const plan: TriagePlan = {
    category: verdict.category,
    confidence: verdict.confidence,
    labels: resolveLabels(
      [categoryLabel(verdict.category, labels) ?? [], verdict.labels].flat(),
      labels,
      issue.labels,
    ),
    duplicates,
    comment:
      options.mode === 'comment'
        ? renderComment({
            category: verdict.category,
            duplicates,
            missingInfo: verdict.missing_info.slice(0, MAX_MISSING_INFO),
          })
        : null,
  };

  if (options.dryRun) return { status: 'dry-run', plan };

  if (plan.labels.length > 0) await tracker.addLabels(issue.number, plan.labels);
  if (plan.comment) await tracker.createComment(issue.number, plan.comment);
  return { status: 'triaged', plan };
}
