import { ChatMessage, ModelCompletionOptions, ModelCompletionResponse, ModelProvider, ToolDefinition } from './types.js';

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
      content: 'I have analyzed your workspace and everything looks sound.',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 }
    };
  }
}

export interface OpenAICompatibleConfig {
  apiKey?: string;
  baseURL?: string;
  model: string;
  providerName?: string;
  customHeaders?: Record<string, string>;
}

export class OpenAICompatibleProvider implements ModelProvider {
  public name: string;
  public apiKey: string;
  public baseURL: string;
  public model: string;
  public customHeaders: Record<string, string>;

  constructor(config: OpenAICompatibleConfig) {
    this.name = config.providerName || 'openai-compatible';
    this.apiKey = config.apiKey || '';
    this.baseURL = config.baseURL || 'https://api.openai.com/v1';
    this.model = config.model;
    this.customHeaders = config.customHeaders || {};
  }

  async complete(messages: ChatMessage[], options?: ModelCompletionOptions): Promise<ModelCompletionResponse> {
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
      return msg;
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.customHeaders
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model,
        messages: formattedMessages,
        tools: formattedTools && formattedTools.length > 0 ? formattedTools : undefined,
        temperature: options?.temperature ?? 0.2,
        max_tokens: options?.maxTokens
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Model API error [${this.name}] (${response.status}): ${errText}`);
    }

    const data: any = await response.json();
    const choice = data.choices?.[0];
    const message = choice?.message;

    const toolCalls = message?.tool_calls?.map((tc: any) => {
      let args = {};
      try {
        args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments;
      } catch {
        args = { raw: tc.function.arguments };
      }
      return {
        id: tc.id,
        name: tc.function.name,
        arguments: args
      };
    });

    return {
      content: message?.content || '',
      toolCalls,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens
      } : undefined
    };
  }
}

// Anthropic Native Adapter
export class AnthropicProvider implements ModelProvider {
  public name = 'anthropic';
  private apiKey: string;
  private baseURL: string;
  private model: string;

  constructor(config: { apiKey?: string; baseURL?: string; model?: string }) {
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || '';
    this.baseURL = config.baseURL || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1';
    this.model = config.model || process.env.DOCKYARD_MODEL || 'claude-3-5-sonnet-20241022';
  }

  async complete(messages: ChatMessage[], options?: ModelCompletionOptions): Promise<ModelCompletionResponse> {
    const systemMsg = messages.find(m => m.role === 'system')?.content || '';
    const nonSystemMsgs = messages.filter(m => m.role !== 'system');

    const formattedMessages = nonSystemMsgs.map(m => {
      if (m.role === 'tool') {
        return {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: m.toolCallId || 'call_0',
              content: m.content
            }
          ]
        };
      }

      if (m.toolCalls && m.toolCalls.length > 0) {
        return {
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
        };
      }

      return {
        role: m.role,
        content: m.content
      };
    });

    const anthropicTools = options?.tools?.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters
    }));

    const response = await fetch(`${this.baseURL.replace(/\/$/, '')}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: this.model,
        system: systemMsg,
        messages: formattedMessages,
        tools: anthropicTools && anthropicTools.length > 0 ? anthropicTools : undefined,
        max_tokens: options?.maxTokens || 4096,
        temperature: options?.temperature ?? 0.2
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${errText}`);
    }

    const data: any = await response.json();
    let textContent = '';
    const toolCalls: any[] = [];

    for (const block of data.content || []) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input
        });
      }
    }

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: data.usage ? {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens
      } : undefined
    };
  }
}

export type SupportedProviderType =
  | 'openrouter'
  | 'nvidia'
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'minimax'
  | 'cloudflare'
  | 'groq'
  | 'cerebras'
  | 'ollama'
  | 'lmstudio'
  | 'vllm'
  | 'custom';

export interface ProviderFactoryConfig {
  provider?: SupportedProviderType;
  model?: string;
  apiKey?: string;
  baseURL?: string;
  accountId?: string; // For Cloudflare Workers AI
  siteUrl?: string;
  siteName?: string;
}

export function createModelProvider(config: ProviderFactoryConfig): ModelProvider {
  const provider = config.provider || 'openai';

  // 1. OpenRouter
  if (provider === 'openrouter') {
    const apiKey = config.apiKey || process.env.OPENROUTER_API_KEY || '';
    const baseURL = config.baseURL || process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
    const model = config.model || process.env.DOCKYARD_MODEL || 'deepseek/deepseek-chat';
    return new OpenAICompatibleProvider({
      providerName: 'openrouter',
      apiKey,
      baseURL,
      model,
      customHeaders: {
        'HTTP-Referer': config.siteUrl || 'https://github.com/dockyard-org/dockyard',
        'X-Title': config.siteName || 'Dockyard Harness'
      }
    });
  }

  // 2. NVIDIA NIM
  if (provider === 'nvidia') {
    return new OpenAICompatibleProvider({
      providerName: 'nvidia',
      apiKey: config.apiKey || process.env.NVIDIA_API_KEY || '',
      baseURL: config.baseURL || process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
      model: config.model || process.env.DOCKYARD_MODEL || 'meta/llama-3.3-70b-instruct'
    });
  }

  // 3. Anthropic Claude
  if (provider === 'anthropic') {
    return new AnthropicProvider({
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
      baseURL: config.baseURL || process.env.ANTHROPIC_BASE_URL,
      model: config.model || process.env.DOCKYARD_MODEL || 'claude-3-5-sonnet-20241022'
    });
  }

  // 4. Google Gemini (via OpenAI-compatible endpoint)
  if (provider === 'gemini') {
    return new OpenAICompatibleProvider({
      providerName: 'gemini',
      apiKey: config.apiKey || process.env.GEMINI_API_KEY || '',
      baseURL: config.baseURL || process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/',
      model: config.model || process.env.DOCKYARD_MODEL || 'gemini-1.5-pro'
    });
  }

  // 5. MiniMax
  if (provider === 'minimax') {
    return new OpenAICompatibleProvider({
      providerName: 'minimax',
      apiKey: config.apiKey || process.env.MINIMAX_API_KEY || '',
      baseURL: config.baseURL || process.env.MINIMAX_BASE_URL || 'https://api.minimax.chat/v1',
      model: config.model || process.env.DOCKYARD_MODEL || 'abab6.5s-chat'
    });
  }

  // 6. Cloudflare Workers AI
  if (provider === 'cloudflare') {
    const accountId = config.accountId || process.env.CLOUDFLARE_ACCOUNT_ID || 'account_id';
    return new OpenAICompatibleProvider({
      providerName: 'cloudflare',
      apiKey: config.apiKey || process.env.CLOUDFLARE_API_KEY || '',
      baseURL: config.baseURL || `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`,
      model: config.model || process.env.DOCKYARD_MODEL || '@cf/meta/llama-3.3-70b-instruct'
    });
  }

  // 7. Groq
  if (provider === 'groq') {
    return new OpenAICompatibleProvider({
      providerName: 'groq',
      apiKey: config.apiKey || process.env.GROQ_API_KEY || '',
      baseURL: config.baseURL || process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
      model: config.model || process.env.DOCKYARD_MODEL || 'llama-3.3-70b-versatile'
    });
  }

  // 8. Cerebras
  if (provider === 'cerebras') {
    return new OpenAICompatibleProvider({
      providerName: 'cerebras',
      apiKey: config.apiKey || process.env.CEREBRAS_API_KEY || '',
      baseURL: config.baseURL || process.env.CEREBRAS_BASE_URL || 'https://api.cerebras.ai/v1',
      model: config.model || process.env.DOCKYARD_MODEL || 'llama3.1-70b'
    });
  }

  // 9. Local AI Models (Ollama, LM Studio, vLLM)
  if (provider === 'ollama') {
    return new OpenAICompatibleProvider({
      providerName: 'ollama',
      apiKey: config.apiKey || 'ollama',
      baseURL: config.baseURL || process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
      model: config.model || process.env.DOCKYARD_MODEL || 'deepseek-coder-v2'
    });
  }

  if (provider === 'lmstudio') {
    return new OpenAICompatibleProvider({
      providerName: 'lmstudio',
      apiKey: config.apiKey || 'lm-studio',
      baseURL: config.baseURL || process.env.LMSTUDIO_BASE_URL || 'http://localhost:1234/v1',
      model: config.model || process.env.DOCKYARD_MODEL || 'local-model'
    });
  }

  if (provider === 'vllm') {
    return new OpenAICompatibleProvider({
      providerName: 'vllm',
      apiKey: config.apiKey || 'vllm',
      baseURL: config.baseURL || process.env.VLLM_BASE_URL || 'http://localhost:8000/v1',
      model: config.model || process.env.DOCKYARD_MODEL || 'default'
    });
  }

  // 10. OpenAI / OpenAI-compatible fallback
  const apiKey = config.apiKey || process.env.OPENAI_API_KEY || '';
  const baseURL = config.baseURL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const model = config.model || process.env.DOCKYARD_MODEL || 'gpt-4o';

  if (!apiKey && !config.baseURL && !config.provider) {
    return new MockModelProvider();
  }

  return new OpenAICompatibleProvider({
    providerName: 'openai',
    apiKey,
    baseURL,
    model
  });
}
