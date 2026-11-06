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
- `@dockyard/core`: Agent runtime, models, planning, tools, memory, and RL trajectory recorder.
- `@dockyard/cli`: Terminal interface and daemon launcher.
- `@dockyard/desktop`: Desktop UI application.
