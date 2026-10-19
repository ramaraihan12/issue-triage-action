import { afterEach, describe, expect, it, vi } from 'vitest';
import { createModel, ProviderError, type ModelConfig } from '../src/providers';

const prompt = { system: 'be brief', user: 'classify this' };

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function lastRequest(fetchMock: ReturnType<typeof stubFetch>) {
  // postJson always passes a string URL and a JSON string body.
  const [url, init] = fetchMock.mock.calls.at(-1) ?? [];
  return {
    url: url as string,
    headers: init?.headers as Record<string, string>,
    body: JSON.parse(init?.body as string) as Record<string, unknown>,
  };
}

const base: ModelConfig = {
  provider: 'openai',
  model: 'm',
  apiKey: 'k',
  baseUrl: 'https://api.openai.com/v1',
  reasoningEffort: '',
  timeoutMs: 5_000,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('openai-compatible provider', () => {
  it('posts a json_object chat completion and returns the content', async () => {
    const fetchMock = stubFetch(jsonResponse({ choices: [{ message: { content: '{"a":1}' } }] }));
    const model = createModel({ ...base, baseUrl: 'http://localhost:11434/v1/' });

    await expect(model.complete(prompt)).resolves.toBe('{"a":1}');

    const req = lastRequest(fetchMock);
    expect(req.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(req.headers.authorization).toBe('Bearer k');
    expect(req.body).toMatchObject({
      model: 'm',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'classify this' },
      ],
    });
    expect(req.body).not.toHaveProperty('reasoning_effort');
  });

  it('sends reasoning_effort and skips auth when configured that way', async () => {
    const fetchMock = stubFetch(jsonResponse({ choices: [{ message: { content: null } }] }));
    const model = createModel({ ...base, apiKey: '', reasoningEffort: 'none' });

    await expect(model.complete(prompt)).resolves.toBe('');
    const req = lastRequest(fetchMock);
    expect(req.headers).not.toHaveProperty('authorization');
    expect(req.body.reasoning_effort).toBe('none');
  });

  it('rejects a response without choices', async () => {
    stubFetch(jsonResponse({ error: 'nope' }));
    await expect(createModel(base).complete(prompt)).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('anthropic provider', () => {
  it('uses the messages API and joins text blocks', async () => {
    const fetchMock = stubFetch(
      jsonResponse({
        content: [
          { type: 'thinking', thinking: '...' },
          { type: 'text', text: '{"category":' },
          { type: 'text', text: '"bug"}' },
        ],
      }),
    );
    const model = createModel({ ...base, provider: 'anthropic', model: 'claude-haiku-5-5' });

    await expect(model.complete(prompt)).resolves.toBe('{"category":"bug"}');
    const req = lastRequest(fetchMock);
    expect(req.url).toBe('https://api.anthropic.com/v1/messages');
    expect(req.headers['x-api-key']).toBe('k');
    expect(req.headers['anthropic-version']).toBe('2023-06-01');
    expect(req.body).toMatchObject({
      model: 'claude-haiku-5-5',
      system: 'be brief',
      messages: [{ role: 'user', content: 'classify this' }],
    });
  });
});

describe('gemini provider', () => {
  it('asks for JSON and skips thought parts', async () => {
    const fetchMock = stubFetch(
      jsonResponse({
        candidates: [
          { content: { parts: [{ text: 'thinking...', thought: true }, { text: '{"ok":true}' }] } },
        ],
      }),
    );
    const model = createModel({ ...base, provider: 'gemini', model: 'gemini-3.5-flash-lite' });

    await expect(model.complete(prompt)).resolves.toBe('{"ok":true}');
    const req = lastRequest(fetchMock);
    expect(req.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
    );
    expect(req.headers['x-goog-api-key']).toBe('k');
    expect(req.body).toMatchObject({
      systemInstruction: { parts: [{ text: 'be brief' }] },
      contents: [{ role: 'user', parts: [{ text: 'classify this' }] }],
      generationConfig: { responseMimeType: 'application/json' },
    });
  });

  it('returns an empty string when the prompt was blocked', async () => {
    stubFetch(jsonResponse({ promptFeedback: { blockReason: 'SAFETY' } }));
    const model = createModel({ ...base, provider: 'gemini' });
    await expect(model.complete(prompt)).resolves.toBe('');
  });
});

describe('http errors', () => {
  it('retries once on 429 and then succeeds', async () => {
    vi.useFakeTimers();
    const fetchMock = stubFetch(
      new Response('slow down', { status: 429, headers: { 'retry-after': '3' } }),
      jsonResponse({ choices: [{ message: { content: 'ok' } }] }),
    );

    const pending = createModel(base).complete(prompt);
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(pending).resolves.toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up with the status and a short detail', async () => {
    vi.useFakeTimers();
    stubFetch(
      new Response('overloaded', { status: 503 }),
      new Response('still overloaded', { status: 503 }),
    );

    const pending = createModel(base).complete(prompt);
    const assertion = expect(pending).rejects.toMatchObject({
      name: 'ProviderError',
      status: 503,
      message: 'api.openai.com returned 503: still overloaded',
    });
    await vi.advanceTimersByTimeAsync(2_000);
    await assertion;
  });

  it('reports a timeout without retrying', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createModel(base).complete(prompt)).rejects.toThrow(
      'api.openai.com did not answer within 5s',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 401', async () => {
    const fetchMock = stubFetch(new Response('bad key', { status: 401 }));
    await expect(createModel(base).complete(prompt)).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
