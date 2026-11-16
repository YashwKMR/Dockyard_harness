export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
  /** Vendor-specific fields that must be sent back unchanged with this call (e.g. Gemini thought signatures). */
  providerData?: Record<string, any>;
}

export interface ToolResult {
  callId: string;
  output: string;
  error?: string;
  isError?: boolean;
  metadata?: Record<string, any>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
  /** Set on tool messages whose tool call failed. */
  isError?: boolean;
  /** Vendor-specific fields of an assistant turn that the vendor requires back (e.g. reasoning traces). */
  providerData?: Record<string, any>;
}

export interface ModelCompletionOptions {
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  stopSequences?: string[];
}

export interface ModelCompletionResponse {
  content: string;
  toolCalls?: ToolCall[];
  providerData?: Record<string, any>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ModelProvider {
  name: string;
  complete(messages: ChatMessage[], options?: ModelCompletionOptions): Promise<ModelCompletionResponse>;
}
