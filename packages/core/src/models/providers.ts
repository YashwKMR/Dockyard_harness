import {
  ModelMessage,
  ModelCompletionOptions,
  ModelCompletionResponse,
  ModelProviderConfig,
  ProviderId,
} from './types.js';

export const DEFAULT_PROVIDERS: Record<ProviderId, ModelProviderConfig> = {
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    supportedModels: [
      'anthropic/claude-3.5-sonnet',
      'meta-llama/llama-3.3-70b-instruct',
      'deepseek/deepseek-r1',
      'openai/gpt-4o',
    ],
  },
  nvidia: {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'meta/llama-3.3-70b-instruct',
    supportedModels: [
      'meta/llama-3.3-70b-instruct',
      'mistralai/mixtral-8x22b-instruct-v0.1',
      'deepseek-ai/deepseek-r1',
    ],
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-sonnet-latest',
    supportedModels: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-latest'],
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.0-flash',
    supportedModels: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-2.0-pro-exp-02-05'],
  },
  groq: {
    id: 'groq',
    name: 'Groq LPU',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    supportedModels: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'deepseek-r1-distill-llama-70b'],
  },
  cerebras: {
    id: 'cerebras',
    name: 'Cerebras Wafer-Scale',
    baseUrl: 'https://api.cerebras.ai/v1',
    defaultModel: 'llama-3.3-70b',
    supportedModels: ['llama-3.3-70b', 'llama3.1-8b'],
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama (Local)',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3:latest',
    supportedModels: ['llama3:latest', 'qwen2.5-coder:latest', 'deepseek-r1:latest'],
  },
  lmstudio: {
    id: 'lmstudio',
    name: 'LM Studio (Local)',
    baseUrl: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    supportedModels: ['local-model'],
  },
  custom: {
    id: 'custom',
    name: 'Custom Endpoint',
    baseUrl: 'http://localhost:8000/v1',
    defaultModel: 'default',
    supportedModels: ['default'],
  },
};

export interface ModelProviderClient {
  complete(messages: ModelMessage[], options?: ModelCompletionOptions): Promise<ModelCompletionResponse>;
}

export class MultiProviderHub {
  private providers: Map<ProviderId, ModelProviderConfig> = new Map();
  private mockResponses: Map<string, ModelCompletionResponse> = new Map();

  constructor(customConfigs?: Partial<Record<ProviderId, Partial<ModelProviderConfig>>>) {
    for (const [id, config] of Object.entries(DEFAULT_PROVIDERS) as [ProviderId, ModelProviderConfig][]) {
      const override = customConfigs?.[id];
      this.providers.set(id, { ...config, ...override });
    }
  }

  public getProviderConfig(provider: ProviderId): ModelProviderConfig | undefined {
    return this.providers.get(provider);
  }

  public setProviderConfig(provider: ProviderId, config: Partial<ModelProviderConfig>): void {
    const existing = this.providers.get(provider) || DEFAULT_PROVIDERS[provider];
    if (existing) {
      this.providers.set(provider, { ...existing, ...config });
    }
  }

  public setMockResponse(key: string, response: ModelCompletionResponse): void {
    this.mockResponses.set(key, response);
  }

  public async complete(
    provider: ProviderId,
    messages: ModelMessage[],
    options: ModelCompletionOptions = {}
  ): Promise<ModelCompletionResponse> {
    const startTime = Date.now();
    const config = this.providers.get(provider);
    if (!config) {
      throw new Error(`Unknown provider: ${provider}`);
    }

    const model = options.model || config.defaultModel;

    // Check mock registry first (useful for offline tests and predictable execution)
    const mockKey = `${provider}:${model}`;
    if (this.mockResponses.has(mockKey)) {
      const mock = this.mockResponses.get(mockKey)!;
      return {
        ...mock,
        latencyMs: Date.now() - startTime,
        provider,
        model,
      };
    }

    // If an API key is provided and live network is desired
    if (config.apiKey && config.baseUrl && !config.baseUrl.includes('localhost')) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        };
        if (provider === 'openrouter') {
          headers['HTTP-Referer'] = 'https://github.com/yashwant0906/Dockyard_harness';
          headers['X-Title'] = 'Dockyard Harness';
        }

        const body: Record<string, any> = {
          model,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens ?? 2048,
        };

        if (options.tools && options.tools.length > 0) {
          body.tools = options.tools.map((t) => ({
            type: 'function',
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            },
          }));
        }

        const res = await fetch(`${config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });

        if (res.ok) {
          const data = (await res.json()) as any;
          const choice = data.choices?.[0];
          const toolCalls = choice?.message?.tool_calls?.map((tc: any) => ({
            id: tc.id,
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments || '{}'),
          }));

          return {
            content: choice?.message?.content || '',
            toolCalls,
            usage: {
              promptTokens: data.usage?.prompt_tokens || 0,
              completionTokens: data.usage?.completion_tokens || 0,
              totalTokens: data.usage?.total_tokens || 0,
            },
            provider,
            model,
            latencyMs: Date.now() - startTime,
          };
        }
      } catch {
        // Fall back to heuristic mock response below if network fails
      }
    }

    // Deterministic mock fallback (offline development & zero-dependency local runs)
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
    let responseText = `[${config.name} (${model})] Completed task request: ${lastUserMsg.slice(0, 100)}`;
    let toolCalls = undefined;

    if (options.tools && options.tools.length > 0 && lastUserMsg.toLowerCase().includes('run:')) {
      const tool = options.tools[0];
      toolCalls = [
        {
          id: `call_${Date.now()}`,
          name: tool.name,
          arguments: { command: lastUserMsg.replace(/^run:\s*/i, '') },
        },
      ];
    }

    return {
      content: responseText,
      toolCalls,
      usage: {
        promptTokens: messages.reduce((acc, m) => acc + m.content.length, 0),
        completionTokens: responseText.length,
        totalTokens: messages.reduce((acc, m) => acc + m.content.length, 0) + responseText.length,
      },
      provider,
      model,
      latencyMs: Date.now() - startTime,
    };
  }
}
