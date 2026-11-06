export type ModelRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ModelMessage {
  role: ModelRole;
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ModelCompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  tools?: ToolDefinition[];
  stream?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface ModelCompletionResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  provider: string;
  model: string;
  latencyMs: number;
}

export type ProviderId =
  | 'openrouter'
  | 'nvidia'
  | 'anthropic'
  | 'gemini'
  | 'groq'
  | 'cerebras'
  | 'ollama'
  | 'lmstudio'
  | 'custom';

export interface ModelProviderConfig {
  id: ProviderId;
  name: string;
  baseUrl?: string;
  apiKey?: string;
  defaultModel: string;
  supportedModels: string[];
}
