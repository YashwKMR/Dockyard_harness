# Dockyard Harness

> **Open-Source Autonomous Coding Harness & Agent Engine**  
> Built for Long-Horizon Engineering, Contextual Intelligence, Reinforcement Learning (RL) Signals, and Continuous Self-Improvement. Fully cross-platform on **macOS**, **Windows** (PowerShell / CMD), and **Linux**.

---

## Visual Overview

### 1. Autonomous Agent Execution & Hierarchical Planning
Dockyard breaks complex user objectives into milestones and steps, tracks real-time state, and logs all tool executions:

![Dockyard Agent Workspace](docs/images/dockyard_agent_tab.png)

### 2. Multi-Provider & Local Model Hub
Seamlessly route prompts to all major cloud AI providers or run fully offline on local inference runners:

![Model & API Provider Routing](docs/images/dockyard_providers_tab.png)

### 3. Reinforcement Learning Trajectories & DPO Export
Inspect step-by-step thoughts, tool actions, verifier scores, and export Direct Preference Optimization (DPO) datasets:

![RL Trajectories and Reward Modeling](docs/images/dockyard_trajectories_tab.png)

---

## Key Capabilities

- **CLI & Desktop Interfaces**:
  - Unified architecture with an interactive CLI terminal (`dockyard`) and a modern Desktop UI (`@dockyard/desktop`).
  - Seamless support for **macOS** and **Windows** (normalizes `\` and `/` file paths, PowerShell, CMD, Bash).
- **All Major Model Providers**:
  - **OpenRouter**: Access to DeepSeek, Claude 3.5, Llama 3.3, Hermes 3, and 200+ models.
  - **NVIDIA NIM**: Accelerated cloud inference for Llama, DeepSeek, and Nemotron.
  - **Anthropic**: Direct native Claude 3.5 Sonnet / Opus messages API.
  - **OpenAI**: GPT-4o, o1, o3-mini.
  - **Google Gemini**: Gemini 1.5 Pro / Flash.
  - **MiniMax**: abab6.5s high-context reasoning.
  - **Cloudflare Workers AI**: Edge inference across global servers.
  - **Groq & Cerebras**: Ultra-low latency, high-throughput engines.
  - **Local AI Models**: Offline inference with **Ollama** (`localhost:11434`), **LM Studio** (`localhost:1234`), and **vLLM** (`localhost:8000`).
- **Long-Horizon Agentic Work**: Hierarchical planning with milestone breakdown, checkpointing, and automatic state rewind/restoration.
- **Contextual Intelligence & Memory**: Multi-tiered memory architecture featuring active scratchpads, codebase indexing, episodic memories across sessions, and persistent repo-specific heuristics.
- **Reinforcement Learning (RL) Signals & Trajectories**: Comprehensive logging of thought-action-result trajectories, automated reward scoring (unit tests, linters, goal achievement, human feedback), and direct export of DPO (Direct Preference Optimization) preference pairs.
- **Self-Improvement Loop**: Post-trajectory critique passes that automatically extract reusable rules and anti-patterns, saving them directly into `.dockyard/memory.json`.

---

## Monorepo Architecture

```
Dockyard_harness/
├── packages/
│   ├── core/         # Agent loop, model providers, cross-platform tools, memory, RL & planner
│   ├── cli/          # Interactive terminal REPL, task runner, and local RPC server
│   └── desktop/      # React + Vite desktop-ready app with visual plan, chat, RL & provider routing
├── docs/
│   └── images/       # Screenshots and visual documentation
├── .github/
│   └── workflows/    # Multi-OS CI testing matrix (macOS, Windows, Ubuntu)
├── LICENSE           # MIT License
└── README.md
```

---

## Quickstart

### Prerequisites
- Node.js 20+ (supports Node 20 and 22)
- npm or pnpm

### Installation & Build

```bash
# Clone the repository
git clone https://github.com/yashwant0906/Dockyard_harness.git
cd Dockyard_harness

# Install dependencies and build all packages
npm install
npm run build
```

---

## Usage

### 1. Dockyard CLI

#### Run an Autonomous Engineering Task
```bash
# Run with OpenRouter
export OPENROUTER_API_KEY="your-key"
node packages/cli/dist/bin.js run "Refactor utility methods and verify unit tests"

# Or run with NVIDIA NIM
export NVIDIA_API_KEY="nvapi-your-key"
export DOCKYARD_PROVIDER="nvidia"
node packages/cli/dist/bin.js run "Audit security policies"

# Or run with local Ollama
export DOCKYARD_PROVIDER="ollama"
node packages/cli/dist/bin.js run "Generate unit tests"
```

#### Interactive Terminal Session (Chat Mode)
```bash
node packages/cli/dist/bin.js chat
```

#### Start Local RPC / API Server
```bash
node packages/cli/dist/bin.js serve 4040
```

### 2. Dockyard Desktop App

```bash
# Start desktop development client
npm run dev:desktop
```
Open [http://localhost:5173](http://localhost:5173) in your browser or package as a native desktop app with Electron / Tauri.

---

## Supported Providers & Environment Variables

| Provider | Environment Variable | Default Model |
| :--- | :--- | :--- |
| **OpenRouter** | `OPENROUTER_API_KEY` | `deepseek/deepseek-chat` |
| **NVIDIA NIM** | `NVIDIA_API_KEY` | `meta/llama-3.3-70b-instruct` |
| **Anthropic** | `ANTHROPIC_API_KEY` | `claude-3-5-sonnet-20241022` |
| **OpenAI** | `OPENAI_API_KEY` | `gpt-4o` |
| **Google Gemini** | `GEMINI_API_KEY` | `gemini-1.5-pro` |
| **MiniMax** | `MINIMAX_API_KEY` | `abab6.5s-chat` |
| **Cloudflare AI** | `CLOUDFLARE_API_KEY` & `CLOUDFLARE_ACCOUNT_ID` | `@cf/meta/llama-3.3-70b-instruct` |
| **Groq** | `GROQ_API_KEY` | `llama-3.3-70b-versatile` |
| **Cerebras** | `CEREBRAS_API_KEY` | `llama3.1-70b` |
| **Ollama (Local)** | `OLLAMA_BASE_URL` (default: `http://localhost:11434/v1`) | `deepseek-coder-v2` |
| **LM Studio (Local)**| `LMSTUDIO_BASE_URL` (default: `http://localhost:1234/v1`) | `local-model` |
| **vLLM (Local)** | `VLLM_BASE_URL` (default: `http://localhost:8000/v1`) | `default` |

---

## Reinforcement Learning & DPO Export

Dockyard logs full execution traces under `.dockyard/trajectories/`. To export preference pairs for offline fine-tuning:
- In the Desktop UI: Navigate to the **Trajectories** tab and click **Export DPO Pairs**.
- Via API: Fetch `GET /api/trajectories`.

---

## Testing

```bash
# Run tests across all packages
npm test
```

---

## Contributing

We welcome contributions from the open-source community! Please see [`CONTRIBUTING.md`](./CONTRIBUTING.md) for details on code standards, workflows, and PR submissions.

## License

Dockyard is open-source software licensed under the [MIT License](./LICENSE).
