# Dockyard Harness Architecture

## Overview
**Dockyard Harness** is a modular, high-reliability agentic harness designed for autonomous software engineering, multi-turn reasoning, and reinforcement learning data synthesis.

```
                          ┌────────────────────────┐
                          │   @dockyard/cli / UI   │
                          └───────────┬────────────┘
                                      │
                                      ▼
                          ┌────────────────────────┐
                          │     @dockyard/core     │
                          │      Agent Loop        │
                          └─────┬─────┬─────┬──────┘
                                │     │     │
          ┌─────────────────────┘     │     └─────────────────────┐
          ▼                           ▼                           ▼
┌───────────────────┐       ┌───────────────────┐       ┌───────────────────┐
│ Hierarchical Plan │       │ Tool Sandbox      │       │ Multi-Tier Memory │
│ - Milestones      │       │ - Cross-platform  │       │ - Working memory  │
│ - Subtasks        │       │   Bash/Cmd/PowerSh│       │ - Scratchpad      │
│ - Checkpoints     │       │ - FS operations   │       │ - Heuristics      │
└───────────────────┘       └───────────────────┘       └───────────────────┘
          │                           │                           │
          └─────────────────────┬─────┴───────────────────────────┘
                                ▼
                    ┌───────────────────────┐
                    │ Multi-Provider Router │
                    │ - OpenRouter, Anthropic│
                    │ - NVIDIA, Gemini, Groq│
                    │ - Cerebras, Ollama, LM│
                    └───────────┬───────────┘
                                ▼
                    ┌───────────────────────┐
                    │ RL Trajectory Engine  │
                    │ - Step logging & state│
                    │ - Verifier rewards    │
                    │ - DPO export (jsonl)  │
                    │ - Self-Improvement loop│
                    └───────────────────────┘
```

## Packages

### 1. `@dockyard/core`
The computational backbone of Dockyard Harness:
- **`models/`**: Uniform model invocation layer across cloud and local providers (OpenRouter, NVIDIA, Anthropic, Gemini, Groq, Cerebras, Ollama, LMStudio).
- **`tools/`**: Secure sandbox executing commands across POSIX shell, Windows Cmd, and PowerShell, plus guarded filesystem access.
- **`planner/`**: Hierarchical milestone planner generating DAGs, step verification, and snapshotting.
- **`memory/`**: Multi-tier memory engine maintaining working memory, structured scratchpad, and long-term heuristics.
- **`rl/`**: Trajectory recorder capturing observations, actions, rewards, and critique steps, with direct export into Direct Preference Optimization (DPO) and SFT datasets.
- **`server/`**: REST and JSON-RPC daemon enabling headless remote control and UI connectivity.

### 2. `@dockyard/cli`
Interactive command-line tool (`dockyard`) featuring:
- `dockyard run <prompt>`: Execute autonomous task runs headlessly.
- `dockyard chat`: Interactive terminal conversation with tool approval hooks.
- `dockyard serve`: Launch the local RPC / REST harness server.

### 3. `@dockyard/desktop`
Modern desktop dashboard for visual agent management:
- **Agent Chat & Milestones**: Live view of plan execution, subtask states, and real-time tool logs.
- **Multi-Provider Hub**: Configure and benchmark model providers with latency and token usage metrics.
- **RL Trajectories & DPO Exporter**: Inspect captured trajectories, inspect critique scoring, and export paired datasets.
- **Memory & Heuristics**: Dynamic inspection and tuning of learned heuristics.
