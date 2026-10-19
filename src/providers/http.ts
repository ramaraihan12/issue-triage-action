export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const DEFAULT_RETRY_DELAY_MS = 2_000;
const MAX_RETRY_DELAY_MS = 30_000;

export interface PostOptions {
  timeoutMs?: number;
  retries?: number;
}

function retryDelay(response: Response): number {
  const seconds = Number(response.headers.get('retry-after'));
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_RETRY_DELAY_MS;
  return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// One retry covers the usual free-tier 429s and brief 5xx blips. Timeouts are
// not retried: a model that took two minutes once will likely do it again.
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  { timeoutMs = 120_000, retries = 1 }: PostOptions = {},
): Promise<unknown> {
  const host = new URL(url).host;

  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new ProviderError(`${host} did not answer within ${timeoutMs / 1000}s`);
      }
      if (attempt < retries) {
        await wait(DEFAULT_RETRY_DELAY_MS);
        continue;
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new ProviderError(`request to ${host} failed: ${reason}`);
    }

    if (response.ok) {
      try {
        return await response.json();
      } catch {
        throw new ProviderError(`${host} returned a response that is not JSON`);
      }
    }

    if (RETRYABLE_STATUS.has(response.status) && attempt < retries) {
      await wait(retryDelay(response));
      continue;
    }

    const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
    throw new ProviderError(`${host} returned ${response.status}: ${detail}`, response.status);
  }
}
