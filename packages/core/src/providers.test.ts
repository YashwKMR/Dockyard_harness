import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AnthropicProvider,
  OpenAICompatibleProvider,
  PROVIDER_CATALOG,
  createModelProvider,
  describeProviders,
  detectProviderFromEnv,
  getProviderInfo,
  normalizeProvider
} from './models/providers.js';
import { ChatMessage, ToolDefinition } from './models/types.js';

const TOOL: ToolDefinition = {
  name: 'read_file',
  description: 'Read a file',
  parameters: { type: 'object', properties: { filepath: { type: 'string' } }, required: ['filepath'] }
};

function withFetch<T>(handler: (url: string, init: RequestInit) => Response, work: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => handler(String(url), init)) as typeof fetch;
  return work().finally(() => {
    globalThis.fetch = original;
  });
}

test('Catalog: every provider is complete and no retired model ID is a default', () => {
  const retired = [
    'gpt-4o', 'claude-3-5-sonnet-20241022', 'gemini-1.5-pro', 'abab6.5s-chat', 'llama3.1-70b',
    'llama-3.3-70b-versatile', 'deepseek/deepseek-chat', 'deepseek-chat', 'deepseek-coder-v2'
  ];
  const ids = new Set<string>();
  for (const p of PROVIDER_CATALOG) {
    assert.ok(!ids.has(p.id), `duplicate provider ${p.id}`);
    ids.add(p.id);
    assert.ok(p.name && p.description && p.defaultModel, `${p.id} is missing fields`);
    assert.match(p.baseURL, /^https?:\/\//, `${p.id} base URL`);
    assert.ok(p.local || p.apiKeyEnv.length > 0, `${p.id} needs an API key variable`);
    assert.ok(!retired.includes(p.defaultModel), `${p.id} defaults to retired model ${p.defaultModel}`);
    for (const m of p.models) assert.ok(!retired.includes(m), `${p.id} suggests retired model ${m}`);
  }
  for (const id of ['openai', 'anthropic', 'gemini', 'glm', 'qwen', 'minimax', 'deepseek']) {
    assert.ok(ids.has(id), `missing provider ${id}`);
  }
});

test('Catalog: defaults, endpoints and aliases for the main vendors', () => {
  const built = (provider: any) => createModelProvider({ provider, apiKey: 'k' }) as OpenAICompatibleProvider;

  assert.equal(built('openai').model, 'gpt-6.1-sol');
  assert.equal(built('openai').maxTokensParam, 'max_completion_tokens');
  assert.equal((createModelProvider({ provider: 'anthropic', apiKey: 'k' }) as AnthropicProvider).model, 'claude-opus-5-5');
  assert.equal(built('gemini').model, 'gemini-4-argon');
  assert.equal(built('gemini').baseURL, 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.equal(built('glm').model, 'glm-5.3');
  assert.equal(built('glm').baseURL, 'https://api.z.ai/api/paas/v4');
  assert.equal(built('qwen').model, 'qwen3.8-max');
  assert.equal(built('qwen').baseURL, 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1');
  assert.equal(built('minimax').model, 'MiniMax-M3.1-Flash');
  assert.equal(built('minimax').baseURL, 'https://api.minimax.io/v1');
  assert.equal(built('deepseek').model, 'deepseek-v4-pro');
  assert.equal(built('groq').model, 'openai/gpt-oss-120b');
  assert.equal(built('cerebras').model, 'gpt-oss-120b');

  assert.equal(normalizeProvider('Zhipu'), 'glm');
  assert.equal(normalizeProvider('dashscope'), 'qwen');
  assert.equal(normalizeProvider('nope'), undefined);
  assert.equal(detectProviderFromEnv({ ZAI_API_KEY: 'x' }), 'glm');
  assert.equal(detectProviderFromEnv({ DASHSCOPE_API_KEY: 'x' }), 'qwen');
  assert.equal(detectProviderFromEnv({ DOCKYARD_PROVIDER: 'zhipu' }), 'glm');

  // An explicit model always wins over the default.
  assert.equal((createModelProvider({ provider: 'openai', apiKey: 'k', model: 'gpt-5.5' }) as OpenAICompatibleProvider).model, 'gpt-5.5');
  assert.throws(() => createModelProvider({ provider: 'cloudflare', apiKey: 'k' }), /CLOUDFLARE_ACCOUNT_ID/);

  const described = describeProviders({ ANTHROPIC_API_KEY: 'x' });
  assert.equal(described.find(p => p.id === 'anthropic')?.configured, true);
  assert.equal(described.find(p => p.id === 'openai')?.configured, false);
  assert.equal(described.find(p => p.id === 'ollama')?.configured, true);
  assert.equal(getProviderInfo('glm').apiKeyEnv[0], 'ZAI_API_KEY');
});

test('OpenAI-compatible wire format: no forced sampling settings, correct token field', () => {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' }
  ];
  const openai = createModelProvider({ provider: 'openai', apiKey: 'k' }) as OpenAICompatibleProvider;
  const plain = openai.buildRequestBody(messages, { tools: [TOOL] });
  assert.equal('temperature' in plain, false, 'current reasoning models reject a non-default temperature');
  assert.equal('max_tokens' in plain, false);
  assert.equal(plain.tools[0].function.name, 'read_file');

  const limited = openai.buildRequestBody(messages, { maxTokens: 500, temperature: 0.3 });
  assert.equal(limited.max_completion_tokens, 500);
  assert.equal('max_tokens' in limited, false);
  assert.equal(limited.temperature, 0.3);
  assert.equal('tools' in limited, false);

  const groq = createModelProvider({ provider: 'groq', apiKey: 'k' }) as OpenAICompatibleProvider;
  assert.equal(groq.buildRequestBody(messages, { maxTokens: 500 }).max_tokens, 500);
});

test('OpenAI-compatible wire format: vendor fields on a tool turn are sent back unchanged', async () => {
  const provider = createModelProvider({ provider: 'gemini', apiKey: 'k' }) as OpenAICompatibleProvider;
  let requestUrl = '';
  let auth = '';
  const first = await withFetch(
    (url, init) => {
      requestUrl = url;
      auth = (init.headers as any).Authorization;
      return new Response(
        JSON.stringify({
          choices: [{
            message: {
              content: null,
              reasoning_content: 'thinking about it',
              tool_calls: [{
                id: 'call_1',
                type: 'function',
                extra_content: { google: { thought_signature: 'SIG123' } },
                function: { name: 'read_file', arguments: '{"filepath":"a.txt"}' }
              }]
            }
          }],
          usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 }
        }),
        { status: 200 }
      );
    },
    () => provider.complete([{ role: 'user', content: 'read a.txt' }], { tools: [TOOL] })
  );

  assert.equal(requestUrl, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  assert.equal(auth, 'Bearer k');
  assert.equal(first.content, '');
  assert.deepEqual(first.toolCalls?.[0].arguments, { filepath: 'a.txt' });
  assert.deepEqual(first.toolCalls?.[0].providerData, { extra_content: { google: { thought_signature: 'SIG123' } } });
  assert.deepEqual(first.providerData, { reasoning_content: 'thinking about it' });
  assert.equal(first.usage?.totalTokens, 7);

  const next = provider.buildRequestBody([
    { role: 'user', content: 'read a.txt' },
    { role: 'assistant', content: '', toolCalls: first.toolCalls, providerData: first.providerData },
    { role: 'tool', toolCallId: 'call_1', name: 'read_file', content: 'file text' }
  ]);
  const assistant = next.messages[1];
  assert.equal(assistant.reasoning_content, 'thinking about it');
  assert.equal(assistant.tool_calls[0].extra_content.google.thought_signature, 'SIG123');
  assert.equal(assistant.tool_calls[0].function.arguments, '{"filepath":"a.txt"}');
  assert.equal(next.messages[2].tool_call_id, 'call_1');
});

test('Errors: a retired model produces a message that says what to change', async () => {
  const provider = createModelProvider({ provider: 'groq', apiKey: 'k', model: 'llama-3.3-70b-versatile' });
  await withFetch(
    () => new Response(JSON.stringify({ error: { message: 'The model `llama-3.3-70b-versatile` has been decommissioned' } }), { status: 400 }),
    async () => {
      await assert.rejects(provider.complete([{ role: 'user', content: 'hi' }]), /renamed or retired; set DOCKYARD_MODEL/);
    }
  );
  await withFetch(
    () => new Response('{"error":"bad key"}', { status: 401 }),
    async () => {
      await assert.rejects(provider.complete([{ role: 'user', content: 'hi' }]), /API key/);
    }
  );
});

test('Anthropic wire format: tool results grouped, no forced temperature, response parsed', async () => {
  const provider = new AnthropicProvider({ apiKey: 'k' });
  const body = provider.buildRequestBody(
    [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: 'working',
        toolCalls: [
          { id: 't1', name: 'read_file', arguments: { filepath: 'a' } },
          { id: 't2', name: 'read_file', arguments: { filepath: 'b' } }
        ]
      },
      { role: 'tool', toolCallId: 't1', content: 'A' },
      { role: 'tool', toolCallId: 't2', content: 'nope', isError: true }
    ],
    { tools: [TOOL] }
  );
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.system, 'sys');
  assert.equal('temperature' in body, false);
  assert.equal(body.messages.length, 3, 'both tool results travel in one user message');
  assert.deepEqual(body.messages[2].content.map((b: any) => b.tool_use_id), ['t1', 't2']);
  assert.equal(body.messages[2].content[1].is_error, true);
  assert.equal(body.tools[0].input_schema.required[0], 'filepath');

  // ANTHROPIC_BASE_URL is set without /v1 by the Anthropic SDKs and Claude Code; both forms must work.
  assert.equal(new AnthropicProvider({ apiKey: 'k', baseURL: 'https://gateway.example.com/anthropic' }).baseURL, 'https://gateway.example.com/anthropic/v1');
  assert.equal(new AnthropicProvider({ apiKey: 'k', baseURL: 'https://api.anthropic.com/v1/' }).baseURL, 'https://api.anthropic.com/v1');

  let headers: any;
  let requestUrl = '';
  const rooted = new AnthropicProvider({ apiKey: 'k', baseURL: 'https://api.anthropic.com' });
  const res = await withFetch(
    (url, init) => {
      requestUrl = url;
      headers = init.headers;
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 't3', name: 'read_file', input: { filepath: 'c' } }],
          usage: { input_tokens: 5, output_tokens: 6 }
        }),
        { status: 200 }
      );
    },
    () => rooted.complete([{ role: 'user', content: 'go' }], { tools: [TOOL] })
  );
  assert.equal(requestUrl, 'https://api.anthropic.com/v1/messages');
  assert.equal(headers['x-api-key'], 'k');
  assert.equal(res.content, 'ok');
  assert.equal(res.toolCalls?.[0].id, 't3');
  assert.equal(res.usage?.totalTokens, 11);
});
