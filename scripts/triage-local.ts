// Runs the same triage code as the action against a JSON fixture instead of a
// live repo. Always a dry run: it prints what the action would do.
//
//   pnpm triage:local examples/windows-path-bug.json \
//     --provider openai --base-url http://localhost:11434/v1 --model qwen3.5-9b:iq4xs
//
// Hosted providers read their key from TRIAGE_API_KEY.

import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { readConfig } from '../src/config';
import { createModel } from '../src/providers';
import { triageIssue, type IssueTracker } from '../src/triage';

const fixtureSchema = z.object({
  issue: z.object({
    number: z.number().int(),
    title: z.string(),
    body: z.string().default(''),
    author: z.string().default('someone'),
    labels: z.array(z.string()).default([]),
  }),
  labels: z.array(z.object({ name: z.string(), description: z.string().default('') })),
  openIssues: z.array(
    z.object({ number: z.number().int(), title: z.string(), body: z.string().default('') }),
  ),
});

const USAGE =
  'usage: pnpm triage:local <fixture.json> [--provider] [--model] [--base-url] [--verbose]';

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      provider: { type: 'string' },
      model: { type: 'string' },
      'base-url': { type: 'string' },
      'reasoning-effort': { type: 'string' },
      mode: { type: 'string' },
      'min-confidence': { type: 'string' },
      'timeout-seconds': { type: 'string' },
      verbose: { type: 'boolean', default: false },
    },
  });

  const [fixturePath] = positionals;
  if (!fixturePath) {
    console.error(USAGE);
    process.exit(2);
  }

  const parsed = fixtureSchema.safeParse(JSON.parse(await readFile(fixturePath, 'utf8')));
  if (!parsed.success) {
    throw new Error(`${fixturePath} is not a valid fixture\n${z.prettifyError(parsed.error)}`);
  }
  const fixture = parsed.data;
  const { verbose, ...inputs } = values;
  const apiKey = process.env.TRIAGE_API_KEY;
  if (!apiKey && inputs.provider && inputs.provider !== 'openai') {
    throw new Error(`set TRIAGE_API_KEY for the ${inputs.provider} provider`);
  }
  const flags: Record<string, string | undefined> = { ...inputs, 'api-key': apiKey };
  const config = readConfig((name) => flags[name] ?? '');

  const tracker: IssueTracker = {
    listLabels: () => Promise.resolve(fixture.labels),
    listOpenIssues: () => Promise.resolve(fixture.openIssues),
    hasTriageComment: () => Promise.resolve(false),
    addLabels: () => Promise.reject(new Error('the local runner never writes')),
    createComment: () => Promise.reject(new Error('the local runner never writes')),
  };

  const model = createModel(config.model);
  const log = {
    info: (message: string) => {
      console.log(message);
    },
    warning: (message: string) => {
      console.warn(`warning: ${message}`);
    },
    debug: (message: string) => {
      if (verbose) console.log(message);
    },
  };

  const started = performance.now();
  const result = await triageIssue(
    { ...fixture.issue, authorIsBot: false },
    { tracker, model, log },
    { ...config.triage, dryRun: true },
  );
  const seconds = ((performance.now() - started) / 1000).toFixed(1);

  console.log(`\n#${fixture.issue.number} ${fixture.issue.title}`);
  console.log(`model: ${model.id} (${seconds}s)`);
  if (result.status === 'skipped') {
    console.log(`skipped: ${result.reason}`);
  } else {
    const { plan } = result;
    console.log(`category: ${plan.category} (confidence ${plan.confidence})`);
    console.log(`labels: ${plan.labels.join(', ') || 'none'}`);
    console.log(`duplicates: ${plan.duplicates.map((d) => `#${d.number}`).join(', ') || 'none'}`);
    console.log(plan.comment ? `comment:\n\n${plan.comment}` : 'comment: none');
  }
}

// Bad flags, a missing key or an unreachable model are the usual failures
// here, and the message says more than a stack trace would.
try {
  await main();
} catch (error) {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
