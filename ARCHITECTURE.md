# Dockyard Architecture Overview

Dockyard is designed as a modular, open-source agentic coding harness inspired by OpenAI Codex, OpenCode, DeepSeek Harness, and Hermes.

## Key Subsystems

### 1. Hierarchical Planner & State Machine (`packages/core/src/planner`)
- Breaks top-level ambiguous requests into verifiable milestones.
- Maintains snapshot checkpoints (`WorkspaceCheckpoint`) enabling state rewind and resumption across multi-step horizon runs.

### 2. Multi-Tier Context & Memory Engine (`packages/core/src/memory`)
- **Working Memory**: Dynamic scratchpad keeping track of active thoughts.
- **Codebase Indexing**: Fast file search and symbol discovery.
- **Episodic Memory**: History of prior runs with success/failure tagging.
- **Distilled Heuristics**: Persistent, reusable domain knowledge stored in `.dockyard/memory.json`.

### 3. Cross-Platform Execution Sandbox (`packages/core/src/tools`)
- Path-safe filesystem read, write, and git-merge-diff editing.
- Normalizes path resolution for Windows and macOS.
- Safe shell execution with configurable timeout, output capping, and user approval checkpoints.

### 4. RL Trajectory Engine & Self-Improvement (`packages/core/src/rl`)
- Records structured execution trajectories: `thought -> tool call -> tool result -> state transition`.
- Scores trajectories using unit tests, linters, goal satisfaction, and human feedback.
- Exports DPO (Direct Preference Optimization) preference pairs.
- Autonomous reflection loop that analyzes failures and extracts new heuristics automatically.

### 5. Interfaces (`packages/cli` & `packages/desktop`)
- CLI: Interactive REPL and command-line runner.
- Desktop UI: Multi-view dashboard for agent interaction, plan tracking, RL inspection, and heuristic management.
