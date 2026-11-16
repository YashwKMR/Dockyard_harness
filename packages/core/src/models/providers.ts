import { ChatMessage, ModelCompletionOptions, ModelCompletionResponse, ModelProvider, ToolCall, ToolDefinition } from './types.js';
import {
  PROVIDER_CATALOG,
  SUPPORTED_PROVIDERS,
  SupportedProviderType,
  getProviderInfo,
  normalizeProvider
} from './catalog.js';

export * from './catalog.js';

export class MockModelProvider implements ModelProvider {
  public name = 'mock';
  public responses: ModelCompletionResponse[] = [];
  public callHistory: { messages: ChatMessage[]; options?: ModelCompletionOptions }[] = [];

  constructor(responses?: ModelCompletionResponse[]) {
    if (responses) {
      this.responses = [...responses];
    }
  }

  public enqueueResponse(response: ModelCompletionResponse) {
    this.responses.push(response);
  }

  async complete(messages: ChatMessage[], options?: ModelCompletionOptions): Promise<ModelCompletionResponse> {
    this.callHistory.push({ messages, options });
    if (this.responses.length > 0) {
      return this.responses.shift()!;
    }
    return {
      content: 'Simulation mode: no model provider is configured, so nothing was actually done. Set a provider API key (or pick a provider in the app) to run real tasks.',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 }
    };
  }
}

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * POST with a request timeout and bounded retries on rate limits, overload and
 * network failures. A long agent run should survive one transient 429 or 503.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: { retries?: number; timeoutMs?: number; baseDelayMs?: number } = {}
): Promise<Response> {
  const retries = options.retries ?? Number(process.env.DOCKYARD_MAX_RETRIES ?? 3);
  const timeoutMs = options.timeoutMs ?? Number(process.env.DOCKYARD_REQUEST_TIMEOUT_MS ?? 300_000);
  const baseDelayMs = options.baseDelayMs ?? 1000;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (!RETRYABLE_STATUS.has(response.status) || attempt === retries) {
        return response;
      }
      const retryAfter = Number(response.headers.get('retry-after'));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 60_000)
        : baseDelayMs * 2 ** attempt;
      await response.arrayBuffer().catch(() => undefined); // release the connection
      await sleep(delay);
    } catch (err) {
      lastError = err;
      if (attempt === retries) break;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  throw new Error(`Model request failed after ${retries + 1} attempt(s): ${(lastError as any)?.message || lastError}`);
}

function describeApiError(provider: string, model: string, status: number, body: string): string {
  const text = body.slice(0, 1500);
  let hint = '';
  if (status === 401 || status === 403) {
    hint = ' Check that the API key for this provider is set and valid.';
  } else if (status === 404 || /model.{0,40}(not found|does not exist|not exist|unknown|decommission|deprecat|retired)/i.test(text)) {
    hint = ` The model "${model}" may have been renamed or retired; set DOCKYARD_MODEL (or --model) to a current ID from the provider's model list.`;
  }
  return `Model API error [${provider}] (${status}): ${text}${hint}`;
}

export interface OpenAICompatibleConfig {
  apiKey?: string;
  baseURL?: string;
  model: string;
  providerName?: string;
  customHeaders?: Record<string, string>;
  /** Which request field carries the output-token limit. Defaults to max_tokens. */
  maxTokensParam?: 'max_tokens' | 'max_completion_tokens';
}

// Fields some vendors attach to an assistant turn and require back on the next
// request (reasoning traces, Gemini thought signatures). They are passed through untouched.
const MESSAGE_PASSTHROUGH = ['reasoning_content', 'reasoning_details', 'reasoning'];

export class OpenAICompatibleProvider implements ModelProvider {
  public name: string;
  public apiKey: string;
  public baseURL: string;
  public model: string;
  public customHeaders: Record<string, string>;
  public maxTokensParam: 'max_tokens' | 'max_completion_tokens';

  constructor(config: OpenAICompatibleConfig) {
    this.name = config.providerName || 'openai-compatible';
    this.apiKey = config.apiKey || '';
    this.baseURL = config.baseURL || 'https://api.openai.com/v1';
    this.model = config.model;
    this.customHeaders = config.customHeaders || {};
    this.maxTokensParam = config.maxTokensParam || 'max_tokens';
  }

  /** The JSON body sent to /chat/completions. Exposed so the wire format can be tested. */
  buildRequestBody(messages: ChatMessage[], options?: ModelCompletionOptions): Record<string, any> {
    const formattedTools = options?.tools?.map((tool: ToolDefinition) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));

    const formattedMessages = messages.map(m => {
      const msg: any = { role: m.role, content: m.content };
      if (m.toolCalls && m.toolCalls.length > 0) {
        msg.tool_calls = m.toolCalls.map(tc => ({
          ...(tc.providerData || {}),
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments)
          }
        }));
      }
      if (m.toolCallId) {
        msg.tool_call_id = m.toolCallId;
      }
      if (m.role === 'assistant' && m.providerData) {
        Object.assign(msg, m.providerData);
      }
      return msg;
    });

    const body: Record<string, any> = { model: this.model, messages: formattedMessages };
    if (formattedTools && formattedTools.length > 0) body.tools = formattedTools;
    // Sampling settings are sent only when asked for: several current reasoning
    // models reject any temperature other than their default.
    if (options?.temperature !== undefined) body.temperature = options.temperature;
    if (options?.maxTokens !== undefined) body[this.maxTokensParam] = options.maxTokens;
    if (options?.stopSequences?.length) body.stop = options.stopSequences;
    return body;
  }

  async complete(messages: ChatMessage[], options?: ModelCompletionOptions): Promise<ModelCompletionResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.customHeaders
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetchWithRetry(`${this.baseURL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(this.buildRequestBody(messages, options))
    });

    if (!response.ok) {
      throw new Error(describeApiError(this.name, this.model, response.status, await response.text()));
    }

    const data: any = await response.json();
    if (data?.error && !data.choices) {
      throw new Error(describeApiError(this.name, this.model, 200, JSON.stringify(data.error)));
    }
    const message = data.choices?.[0]?.message;

    const toolCalls: ToolCall[] | undefined = message?.tool_calls?.map((tc: any, index: number) => {
      let args: Record<string, any> = {};
      try {
        const raw = tc.function?.arguments;
        args = typeof raw === 'string' ? (raw.trim() ? JSON.parse(raw) : {}) : (raw || {});
      } catch {
        args = { raw: tc.function?.arguments };
      }
      const { id, type: _type, function: _fn, index: _index, ...extra } = tc;
      const call: ToolCall = {
        id: id || `call_${Date.now()}_${index}`,
        name: tc.function?.name,
        arguments: args
      };
      if (Object.keys(extra).length > 0) call.providerData = extra;
      return call;
    });

    const providerData: Record<string, any> = {};
    for (const key of MESSAGE_PASSTHROUGH) {
      if (message?.[key] !== undefined && message[key] !== null) providerData[key] = message[key];
    }

    const content = typeof message?.content === 'string'
      ? message.content
      : Array.isArray(message?.content)
        ? message.content.map((part: any) => (typeof part === 'string' ? part : part?.text || '')).join('')
        : '';

    return {
      content,
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      providerData: Object.keys(providerData).length > 0 ? providerData : undefined,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens || 0,
        completionTokens: data.usage.completion_tokens || 0,
        totalTokens: data.usage.total_tokens || 0
      } : undefined
    };
  }
}

// Anthropic Native Adapter
export class AnthropicProvider implements ModelProvider {
  public name = 'anthropic';
  public model: string;
  public baseURL: string;
  private apiKey: string;

  constructor(config: { apiKey?: string; baseURL?: string; model?: string }) {
    const info = getProviderInfo('anthropic');
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || '';
    // The Anthropic SDKs and Claude Code treat ANTHROPIC_BASE_URL as the API root and add /v1
    // themselves, so accept the URL with or without /v1.
    const root = (config.baseURL || process.env.ANTHROPIC_BASE_URL || info.baseURL).replace(/\/+$/, '');
    this.baseURL = /\/v1$/.test(root) ? root : `${root}/v1`;
    this.model = config.model || process.env.DOCKYARD_MODEL || info.defaultModel;
  }

  /** The JSON body sent to /messages. Exposed so the wire format can be tested. */
  buildRequestBody(messages: ChatMessage[], options?: ModelCompletionOptions): Record<string, any> {
    const systemMsg = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    const formattedMessages: { role: string; content: any }[] = [];

    for (const m of messages) {
      if (m.role === 'system') continue;

      if (m.role === 'tool') {
        const block = {
          type: 'tool_result',
          tool_use_id: m.toolCallId || 'call_0',
          content: m.content || '(no output)',
          ...(m.isError ? { is_error: true } : {})
        };
        // The Messages API expects every result of one assistant turn in a single user message.
        const prev = formattedMessages[formattedMessages.length - 1];
        if (prev && prev.role === 'user' && Array.isArray(prev.content) && prev.content[0]?.type === 'tool_result') {
          prev.content.push(block);
        } else {
          formattedMessages.push({ role: 'user', content: [block] });
        }
        continue;
      }

      if (m.toolCalls && m.toolCalls.length > 0) {
        formattedMessages.push({
          role: 'assistant',
          content: [
            ...(m.content ? [{ type: 'text', text: m.content }] : []),
            ...m.toolCalls.map(tc => ({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments
            }))
          ]
        });
        continue;
      }

      // The API rejects empty text content.
      formattedMessages.push({ role: m.role, content: m.content || '(no content)' });
    }

    const anthropicTools = options?.tools?.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters
    }));

    const body: Record<string, any> = {
      model: this.model,
      messages: formattedMessages,
      max_tokens: options?.maxTokens || 8192
    };
    if (systemMsg) body.system = systemMsg;
    if (anthropicTools && anthropicTools.length > 0) body.tools = anthropicTools;
    // Current Claude models reject non-default sampling settings, so only send one when asked.
    if (options?.temperature !== undefined) body.temperature = options.temperature;
    if (options?.stopSequences?.length) body.stop_sequences = options.stopSequences;
    return body;
  }

  async complete(messages: ChatMessage[], options?: ModelCompletionOptions): Promise<ModelCompletionResponse> {
    const response = await fetchWithRetry(`${this.baseURL.replace(/\/+$/, '')}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(this.buildRequestBody(messages, options))
    });

    if (!response.ok) {
      throw new Error(describeApiError(this.name, this.model, response.status, await response.text()));
    }

    const data: any = await response.json();
    let textContent = '';
    const toolCalls: ToolCall[] = [];

    for (const block of data.content || []) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input || {}
        });
      }
    }

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: data.usage ? {
        promptTokens: data.usage.input_tokens || 0,
        completionTokens: data.usage.output_tokens || 0,
        totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0)
      } : undefined
    };
  }
}

export interface ProviderFactoryConfig {
  provider?: SupportedProviderType;
  model?: string;
  apiKey?: string;
  baseURL?: string;
  accountId?: string; // For Cloudflare Workers AI
  siteUrl?: string;
  siteName?: string;
}

function firstEnv(names: string[], env: NodeJS.ProcessEnv): string {
  for (const name of names) {
    if (env[name]) return env[name] as string;
  }
  return '';
}

/** Which provider the environment points at, or undefined when nothing is configured. */
export function detectProviderFromEnv(env: NodeJS.ProcessEnv = process.env): SupportedProviderType | undefined {
  const explicit = (env.DOCKYARD_PROVIDER || '').trim();
  if (explicit) {
    const normalized = normalizeProvider(explicit);
    if (!normalized) {
      throw new Error(`Unknown DOCKYARD_PROVIDER "${explicit}". Supported: ${SUPPORTED_PROVIDERS.join(', ')}.`);
    }
    return normalized;
  }
  // First cloud provider with a key set wins, in catalog order; then local runners with an endpoint set.
  for (const info of PROVIDER_CATALOG) {
    if (info.id === 'custom' || info.local) continue;
    if (firstEnv(info.apiKeyEnv, env)) return info.id;
  }
  for (const info of PROVIDER_CATALOG) {
    if (info.local && env[info.baseURLEnv]) return info.id;
  }
  return undefined;
}

/** For each provider, whether this environment has what it needs to be called. */
export function describeProviders(env: NodeJS.ProcessEnv = process.env) {
  return PROVIDER_CATALOG.map(info => ({
    id: info.id,
    name: info.name,
    category: info.category,
    description: info.description,
    defaultModel: info.defaultModel,
    models: info.models,
    local: !!info.local,
    apiKeyEnv: info.apiKeyEnv,
    baseURL: env[info.baseURLEnv] || info.baseURL,
    configured: info.local ? true : !!firstEnv(info.apiKeyEnv, env)
  }));
}

/**
 * Build the provider the environment asks for. Falls back to the scripted
 * MockModelProvider (no real model, no tool use) when nothing is configured.
 */
export function createProviderFromEnv(env: NodeJS.ProcessEnv = process.env): { model: ModelProvider; provider: SupportedProviderType | 'mock'; modelName: string } {
  const provider = detectProviderFromEnv(env);
  if (!provider) {
    return { model: new MockModelProvider(), provider: 'mock', modelName: 'simulation' };
  }
  const model = createModelProvider({ provider, model: env.DOCKYARD_MODEL, baseURL: env.DOCKYARD_BASE_URL });
  return { provider, model, modelName: (model as any).model || '' };
}

export function createModelProvider(config: ProviderFactoryConfig): ModelProvider {
  // With nothing at all specified, stay in simulation rather than calling an API without a key.
  if (!config.provider && !config.apiKey && !config.baseURL && !process.env.OPENAI_API_KEY) {
    return new MockModelProvider();
  }

  const provider = config.provider ? normalizeProvider(config.provider) : 'openai';
  if (!provider) {
    throw new Error(`Unknown provider "${config.provider}". Supported: ${SUPPORTED_PROVIDERS.join(', ')}.`);
  }
  const info = getProviderInfo(provider);
  const env = process.env;

  const apiKey = config.apiKey || firstEnv(info.apiKeyEnv, env) || (info.local ? info.id : '');
  const model = config.model || env.DOCKYARD_MODEL || info.defaultModel;
  let baseURL = config.baseURL || env[info.baseURLEnv] || info.baseURL;

  if (provider === 'cloudflare') {
    const accountId = config.accountId || env.CLOUDFLARE_ACCOUNT_ID || '';
    if (baseURL.includes('{accountId}')) {
      if (!accountId) {
        throw new Error('Cloudflare Workers AI needs CLOUDFLARE_ACCOUNT_ID (your account ID) as well as the API key.');
      }
      baseURL = baseURL.replace('{accountId}', accountId);
    }
  }

  if (info.protocol === 'anthropic') {
    return new AnthropicProvider({ apiKey, baseURL, model });
  }

  return new OpenAICompatibleProvider({
    providerName: provider,
    apiKey,
    baseURL,
    model,
    maxTokensParam: info.maxTokensParam,
    customHeaders: provider === 'openrouter'
      ? {
          'HTTP-Referer': config.siteUrl || 'https://github.com/YashwKMR/Dockyard_harness',
          'X-Title': config.siteName || 'Dockyard Harness'
        }
      : undefined
  });
}
