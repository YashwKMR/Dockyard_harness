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
- **`tools/`**: Tool registry with permission modes (`read-only` / `ask` / `auto`). File tools are confined to the workspace (symlinks resolved); commands run through the platform shell after approval and are not OS-sandboxed.
- **`planner/`**: Step plan the agent maintains through the `update_plan` tool, with a checkpoint recorded as each step completes.
- **`agents/`**: Agent definitions (`.dockyard/agents/*.json`): role prompt, tool allowlist, model, permission cap. The agent loop exposes them to the lead as teammates via `delegate_task`; each runs as its own `DockyardAgent` with its own memory and trajectory.
- **`memory/`**: Episodic memory and long-term heuristics persisted per workspace and per named agent, plus the in-session scratchpad.
- **`rl/`**: Trajectory recorder capturing thoughts, actions and results; a reward computed only from measured signals (completion, verify command, tool errors, human feedback); a reflection pass; and DPO pair export.
- **`models/catalog.ts`**: The one list of providers, endpoints, API key variables and default model IDs. The CLI, server and app all read it.
- **`server/`**: Loopback-only REST server with bearer-token auth. Runs tasks in the background, exposes live run state, takes approvals for writes and commands, and serves the built app. Its start mode is a ceiling that requests cannot exceed.

### 2. `@dockyard/cli`
Interactive command-line tool (`dockyard`) featuring:
- `dockyard run <prompt>`: Execute autonomous task runs headlessly.
- `dockyard chat`: Interactive terminal conversation with tool approval prompts.
- `dockyard agent create|list|show|delete`: Manage custom agents.
- `dockyard export-dpo`: Write preference pairs from recorded trajectories.
- `dockyard serve`: Launch the local RPC / REST harness server.

### 3. `@dockyard/desktop`
Web dashboard served by `dockyard app` and driven entirely by the local server's API:
- **Agent Chat & Milestones**: Live view of plan execution, subtask states, and real-time tool logs.
- **Multi-Provider Hub**: Choose the provider and model for each task; shows which providers have a key configured.
- **Teammates**: Create and remove custom agents.
- **RL Trajectories & DPO Exporter**: Inspect captured trajectories, inspect critique scoring, and export paired datasets.
- **Memory & Heuristics**: Dynamic inspection and tuning of learned heuristics.
