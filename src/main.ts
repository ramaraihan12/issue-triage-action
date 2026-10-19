import * as core from '@actions/core';
import * as github from '@actions/github';
import { readConfig } from './config';
import { githubTracker, issueFromPayload } from './github';
import { createModel } from './providers';
import { triageIssue, type TriageResult } from './triage';

async function report(result: TriageResult): Promise<void> {
  core.setOutput('status', result.status);

  if (result.status === 'skipped') {
    core.info(`Skipped: ${result.reason}`);
    return;
  }

  const { plan } = result;
  const labels = plan.labels.join(', ');
  const duplicates = plan.duplicates.map((d) => `#${d.number}`).join(', ');
  core.setOutput('category', plan.category);
  core.setOutput('labels', plan.labels.join(','));
  core.setOutput('duplicates', plan.duplicates.map((d) => d.number).join(','));
  core.setOutput('comment', plan.comment ?? '');

  const verb = result.status === 'dry-run' ? 'Would add' : 'Added';
  core.info(`Category: ${plan.category} (confidence ${plan.confidence})`);
  core.info(`${verb} labels: ${labels || 'none'}`);
  core.info(`Likely duplicates: ${duplicates || 'none'}`);
  if (plan.comment) core.info(`Comment:\n${plan.comment}`);

  await core.summary
    .addHeading(result.status === 'dry-run' ? 'Issue triage (dry run)' : 'Issue triage', 3)
    .addList([
      `Category: ${plan.category} (confidence ${plan.confidence})`,
      `${verb} labels: ${labels || 'none'}`,
      `Likely duplicates: ${duplicates || 'none'}`,
    ])
    .addDetails('Comment', plan.comment ? `\n\n${plan.comment}\n\n` : 'No comment')
    .write();
}

export async function run(): Promise<void> {
  try {
    const config = readConfig((name) => core.getInput(name));
    if (config.model.apiKey) core.setSecret(config.model.apiKey);

    const tracker = githubTracker(github.getOctokit(config.githubToken), github.context.repo);
    const issue =
      config.issueNumber === null
        ? issueFromPayload(github.context.payload)
        : await tracker.getIssue(config.issueNumber);

    if (!issue) {
      core.info(`Nothing to triage: the ${github.context.eventName} event has no issue.`);
      core.setOutput('status', 'skipped');
      return;
    }

    const result = await triageIssue(
      issue,
      { tracker, model: createModel(config.model), log: core },
      config.triage,
    );
    await report(result);
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}
