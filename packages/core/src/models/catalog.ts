/**
 * Single source of truth for providers and model names. The CLI help, the
 * server's /api/providers endpoint and the desktop app all read from here, so
 * a model rename is a one-line change in this file.
 *
 * Model IDs last checked against vendor documentation on 2026-11-15. Vendors
 * retire IDs on short notice; any ID can be overridden with DOCKYARD_MODEL or
 * `--model`, and `GET <baseURL>/models` lists what a key can actually call.
 */

export type SupportedProviderType =
  | 'openrouter'
  | 'nvidia'
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'minimax'
  | 'glm'
  | 'qwen'
  | 'deepseek'
  | 'cloudflare'
  | 'groq'
  | 'cerebras'
  | 'ollama'
  | 'lmstudio'
  | 'vllm'
  | 'custom';

export type ProviderCategory = 'Cloud API' | 'Ultra-Fast' | 'Local / Offline';

export interface ProviderInfo {
  id: SupportedProviderType;
  name: string;
  category: ProviderCategory;
  description: string;
  /** Wire protocol. Everything except Anthropic speaks OpenAI Chat Completions. */
  protocol: 'openai' | 'anthropic';
  /** Environment variables checked for the API key, in order. Empty for local runners. */
  apiKeyEnv: string[];
  /** Environment variable that overrides the endpoint. */
  baseURLEnv: string;
  baseURL: string;
  defaultModel: string;
  /** Other current model IDs, offered as suggestions in the UI. */
  models: string[];
  local?: boolean;
  /** OpenAI's current models take max_completion_tokens instead of max_tokens. */
  maxTokensParam?: 'max_tokens' | 'max_completion_tokens';
}

export const PROVIDER_CATALOG: ProviderInfo[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    category: 'Cloud API',
    description: 'One key for models from Google, Anthropic, OpenAI, DeepSeek and others.',
    protocol: 'openai',
    apiKeyEnv: ['OPENROUTER_API_KEY'],
    baseURLEnv: 'OPENROUTER_BASE_URL',
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'google/gemini-4-argon',
    models: ['google/gemini-4-argon', 'google/gemini-4-hydrogen', 'google/gemini-3.8-flash']
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    category: 'Cloud API',
    description: 'Claude Opus, Sonnet, Haiku and Fable through the native Messages API.',
    protocol: 'anthropic',
    apiKeyEnv: ['ANTHROPIC_API_KEY'],
    baseURLEnv: 'ANTHROPIC_BASE_URL',
    baseURL: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-opus-5-5',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2']
  },
  {
    id: 'openai',
    name: 'OpenAI',
    category: 'Cloud API',
    description: 'GPT-6 family.',
    protocol: 'openai',
    apiKeyEnv: ['OPENAI_API_KEY'],
    baseURLEnv: 'OPENAI_BASE_URL',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-6.1-sol',
    models: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-terra', 'gpt-6-luna', 'gpt-5.5'],
    maxTokensParam: 'max_completion_tokens'
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    category: 'Cloud API',
    description: 'Gemini 4 and Flash models through Google\'s OpenAI-compatible endpoint.',
    protocol: 'openai',
    apiKeyEnv: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    baseURLEnv: 'GEMINI_BASE_URL',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-4-argon',
    models: ['gemini-4-argon', 'gemini-4-carbon', 'gemini-4-hydrogen', 'gemini-3.8-flash']
  },
  {
    id: 'glm',
    name: 'Z.ai GLM (Zhipu)',
    category: 'Cloud API',
    description: 'GLM-5.3 models. Set GLM_BASE_URL to https://open.bigmodel.cn/api/paas/v4 for mainland China.',
    protocol: 'openai',
    apiKeyEnv: ['ZAI_API_KEY', 'GLM_API_KEY', 'ZHIPU_API_KEY'],
    baseURLEnv: 'GLM_BASE_URL',
    baseURL: 'https://api.z.ai/api/paas/v4',
    defaultModel: 'glm-5.3',
    models: ['glm-5.3', 'glm-5.3-flash']
  },
  {
    id: 'qwen',
    name: 'Alibaba Qwen',
    category: 'Cloud API',
    description: 'Qwen models on Alibaba Cloud Model Studio (DashScope), international endpoint.',
    protocol: 'openai',
    apiKeyEnv: ['DASHSCOPE_API_KEY', 'QWEN_API_KEY'],
    baseURLEnv: 'QWEN_BASE_URL',
    baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3.8-max',
    models: ['qwen3.8-max', 'qwen3.8-flash', 'qwen3.7-plus']
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    category: 'Cloud API',
    description: 'MiniMax M3 series.',
    protocol: 'openai',
    apiKeyEnv: ['MINIMAX_API_KEY'],
    baseURLEnv: 'MINIMAX_BASE_URL',
    baseURL: 'https://api.minimax.io/v1',
    defaultModel: 'MiniMax-M3.1-Flash',
    models: ['MiniMax-M3.1-Flash', 'MiniMax-M3']
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    category: 'Cloud API',
    description: 'DeepSeek V4 models direct from DeepSeek.',
    protocol: 'openai',
    apiKeyEnv: ['DEEPSEEK_API_KEY'],
    baseURLEnv: 'DEEPSEEK_BASE_URL',
    baseURL: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-pro',
    models: ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-flash']
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    category: 'Cloud API',
    description: 'Hosted open models on build.nvidia.com.',
    protocol: 'openai',
    apiKeyEnv: ['NVIDIA_API_KEY'],
    baseURLEnv: 'NVIDIA_BASE_URL',
    baseURL: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'nvidia/nemotron-3-super-120b-a12b',
    models: ['nvidia/nemotron-3-super-120b-a12b', 'moonshotai/kimi-k2.6', 'meta/llama-3.3-70b-instruct']
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    category: 'Cloud API',
    description: 'Serverless edge inference. Needs CLOUDFLARE_ACCOUNT_ID as well as the API key.',
    protocol: 'openai',
    apiKeyEnv: ['CLOUDFLARE_API_KEY', 'CLOUDFLARE_API_TOKEN'],
    baseURLEnv: 'CLOUDFLARE_BASE_URL',
    baseURL: 'https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1',
    defaultModel: '@cf/openai/gpt-oss-120b',
    models: ['@cf/openai/gpt-oss-120b', '@cf/moonshotai/kimi-k2.6', '@cf/zai-org/glm-4.7-flash']
  },
  {
    id: 'groq',
    name: 'Groq',
    category: 'Ultra-Fast',
    description: 'Low-latency inference for open models.',
    protocol: 'openai',
    apiKeyEnv: ['GROQ_API_KEY'],
    baseURLEnv: 'GROQ_BASE_URL',
    baseURL: 'https://api.groq.com/openai/v1',
    defaultModel: 'openai/gpt-oss-120b',
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    category: 'Ultra-Fast',
    description: 'Wafer-scale inference for open models.',
    protocol: 'openai',
    apiKeyEnv: ['CEREBRAS_API_KEY'],
    baseURLEnv: 'CEREBRAS_BASE_URL',
    baseURL: 'https://api.cerebras.ai/v1',
    defaultModel: 'gpt-oss-120b',
    models: ['gpt-oss-120b', 'qwen-3.8-27b']
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    category: 'Local / Offline',
    description: 'Offline models on localhost:11434. Pull a tool-calling model first, e.g. `ollama pull gpt-oss:20b`.',
    protocol: 'openai',
    apiKeyEnv: [],
    baseURLEnv: 'OLLAMA_BASE_URL',
    baseURL: 'http://localhost:11434/v1',
    defaultModel: 'gpt-oss:20b',
    models: ['gpt-oss:20b'],
    local: true
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (Local)',
    category: 'Local / Offline',
    description: 'Local model runner on localhost:1234. Uses whichever model is loaded.',
    protocol: 'openai',
    apiKeyEnv: [],
    baseURLEnv: 'LMSTUDIO_BASE_URL',
    baseURL: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    models: [],
    local: true
  },
  {
    id: 'vllm',
    name: 'vLLM (Local)',
    category: 'Local / Offline',
    description: 'Self-hosted inference server on localhost:8000. Set the model to the name vLLM was started with.',
    protocol: 'openai',
    apiKeyEnv: [],
    baseURLEnv: 'VLLM_BASE_URL',
    baseURL: 'http://localhost:8000/v1',
    defaultModel: 'default',
    models: [],
    local: true
  },
  {
    id: 'custom',
    name: 'Custom (OpenAI-compatible)',
    category: 'Cloud API',
    description: 'Any other endpoint that speaks OpenAI Chat Completions. Set DOCKYARD_BASE_URL and DOCKYARD_MODEL.',
    protocol: 'openai',
    apiKeyEnv: ['DOCKYARD_API_KEY', 'OPENAI_API_KEY'],
    baseURLEnv: 'DOCKYARD_BASE_URL',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-6.1-sol',
    models: []
  }
];

export const SUPPORTED_PROVIDERS: SupportedProviderType[] = PROVIDER_CATALOG.map(p => p.id);

const ALIASES: Record<string, SupportedProviderType> = {
  zai: 'glm',
  zhipu: 'glm',
  bigmodel: 'glm',
  dashscope: 'qwen',
  alibaba: 'qwen',
  google: 'gemini',
  claude: 'anthropic'
};

/** Accepts a provider id or a common alias (e.g. "zhipu", "dashscope") in any case. */
export function normalizeProvider(value: unknown): SupportedProviderType | undefined {
  if (typeof value !== 'string') return undefined;
  const key = value.trim().toLowerCase();
  if ((SUPPORTED_PROVIDERS as string[]).includes(key)) return key as SupportedProviderType;
  return ALIASES[key];
}

export function isSupportedProvider(value: unknown): value is SupportedProviderType {
  return typeof value === 'string' && (SUPPORTED_PROVIDERS as string[]).includes(value);
}

export function getProviderInfo(id: SupportedProviderType): ProviderInfo {
  const info = PROVIDER_CATALOG.find(p => p.id === id);
  if (!info) throw new Error(`Unknown provider "${id}". Supported: ${SUPPORTED_PROVIDERS.join(', ')}.`);
  return info;
}
