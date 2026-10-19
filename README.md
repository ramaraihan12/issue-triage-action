# issue-triage-action

[![ci](https://github.com/ramaraihan12/issue-triage-action/actions/workflows/ci.yml/badge.svg)](https://github.com/ramaraihan12/issue-triage-action/actions/workflows/ci.yml)

A GitHub Action that looks at every new issue, sorts it into bug / feature / question / docs, adds labels that already exist in the repo, points out a likely duplicate and asks for missing details in one short comment. For small repos where nobody has time to triage on the day an issue comes in.

This is what it produced for one of the example payloads in `examples/`, run locally against Ollama:

```text
$ pnpm triage:local examples/windows-path-bug.json --provider openai \
    --base-url http://localhost:11434/v1 --model qwen3.5-9b:iq4xs --reasoning-effort none

Duplicate candidates: #96
Asking openai:qwen3.5-9b:iq4xs to triage #104

#104 mdsite build fails with 'no such file or directory' on my Windows machine
model: openai:qwen3.5-9b:iq4xs (32.4s)
category: bug (confidence 0.95)
labels: bug, area: build, platform: windows
duplicates: #96
comment:

<!-- issue-triage-action -->

Thanks for opening this. It reads like a bug report.

It might be the same as #96 (Build crashes with ENOENT when the project path contains spaces). If it is, a thumbs up and any extra details over there help more than a second thread.

<sub>Automated triage. A maintainer will take a look and may change the labels.</sub>
```

## How it works

- Skips issues opened by bots, and issues that already have a comment with the hidden `<!-- issue-triage-action -->` marker. That marker is how it never comments twice, even if the workflow re-runs.
- Reads the repo's labels (minus maintainer-only ones like `duplicate`, `wontfix`, `good first issue`) and the 100 newest open issues and PRs (one API page), then drops the PRs.
- Narrows those issues to at most 5 duplicate candidates with TF-IDF and cosine similarity, computed inside the action. No embeddings, see Notes.
- One model call returns JSON, which is checked with zod. If the JSON is broken, has the wrong shape, an unknown category, or the confidence is under `min-confidence`, the action does nothing at all. A missing label is better than a wrong one.
- Labels are matched against the repo's real labels, anything made up is dropped, max 3. The label for the category (`bug`, `enhancement`, `question`, `documentation`) is added if the repo has it.
- It only comments when there is something worth saying (a likely duplicate or missing details). Model text is stripped of links, @mentions, issue references and markup before it goes into the comment.

## Use it

```yaml
# .github/workflows/triage.yml
name: triage

on:
  issues:
    types: [opened]

permissions:
  contents: read
  issues: write

jobs:
  triage:
    runs-on: ubuntu-latest
    steps:
      - uses: ramaraihan12/issue-triage-action@v1
        with:
          api-key: ${{ secrets.GEMINI_API_KEY }}
          # dry-run: true   # log what it would do, touch nothing
          # mode: labels    # never comment
```

`@v1` moves with each 1.x release. The action gets `issues: write` and your API key, so pinning it to a full commit SHA is the safer choice if you'd rather review each update yourself.

The default provider is Gemini (`gemini-3.5-flash-lite`), which has a free tier. Get a key at [aistudio.google.com](https://aistudio.google.com/apikey) and save it as the `GEMINI_API_KEY` secret. To use something else, set `provider` and pass that provider's key as `api-key`:

| provider    | default model           | key                                                     |
| ----------- | ----------------------- | ------------------------------------------------------- |
| `gemini`    | `gemini-3.5-flash-lite` | Gemini API key                                          |
| `openai`    | `gpt-6-luna`            | OpenAI key, or another API's key when `base-url` is set |
| `anthropic` | `claude-haiku-5-5`      | Anthropic API key                                       |

`openai` with `base-url` covers anything that speaks Chat Completions: OpenRouter, Groq, a self-hosted Ollama.

Other inputs: `model`, `base-url`, `reasoning-effort`, `mode` (`comment` or `labels`), `dry-run`, `min-confidence` (default 0.6), `issue-number` (for `workflow_dispatch`), `timeout-seconds`, `github-token`. Outputs: `status`, `category`, `labels`, `duplicates`, `comment`. Full descriptions are in [action.yml](action.yml), and this repo triages its own issues with [.github/workflows/triage.yml](.github/workflows/triage.yml).

## Stack

TypeScript (strict), @actions/core, @actions/github (Octokit), zod, esbuild for the `dist/` bundle, Vitest, ESLint and Prettier. Model calls are plain `fetch`, no provider SDKs.

## Run it locally

You need Node 24 and pnpm. `triage:local` runs the same triage code against a JSON fixture instead of a real repo, and it is always a dry run.

```bash
pnpm install
ollama pull qwen3.5:9b
pnpm triage:local examples/windows-path-bug.json --provider openai \
  --base-url http://localhost:11434/v1 --model qwen3.5:9b --reasoning-effort none
```

I ran it with an IQ4_XS quant of the same model (`qwen3.5-9b:iq4xs`) because that fits my 6 GB GPU. `--reasoning-effort none` turns thinking off, which a classification like this doesn't need. For a hosted provider, put the key in `TRIAGE_API_KEY`:

```bash
TRIAGE_API_KEY=your-key pnpm triage:local examples/rss-feature.json --provider gemini
```

There is also a Dockerfile for the local runner, if you'd rather not install Node (on Linux, add `--add-host=host.docker.internal:host-gateway` to the run):

```bash
docker build -t issue-triage .
docker run --rm issue-triage examples/rss-feature.json --provider openai \
  --base-url http://host.docker.internal:11434/v1 --model qwen3.5:9b --reasoning-effort none
```

`dist/` is committed because Actions runs it straight from the repo. After changing `src/`, run `pnpm build` and commit the result. CI fails if they drift.

## Tests

```bash
pnpm test
```

Octokit, `@actions/core` and the model are all faked, so tests run offline with no keys. CI also runs `pnpm typecheck` and `pnpm lint`.

## Notes

- The plan was to default to GitHub Models, because it ran on the workflow's own `GITHUB_TOKEN` for free (and had free embeddings too). GitHub retired it on July 30, 2026, so the default is Gemini's free tier, which does need a key.
- Duplicate search is lexical only. TF-IDF matches "Build fails with ENOENT when the path has spaces" to #96 easily, but the same bug written as "Can't open files in folders with blanks" scores under the cutoff and is missed. Embeddings would catch it, at the cost of embedding every open issue on each run or keeping a cache somewhere. It also only reads that one page, and open PRs on it take up slots, so on a busy repo an older duplicate is never seen.
- Small local models are overconfident. The 9B model above reports a confidence of 1 more often than it should, so `min-confidence` is a weak guard with them.
- An issue that got labels but no comment has no marker, so re-running the workflow on it asks the model again and might comment then. It never removes labels.
