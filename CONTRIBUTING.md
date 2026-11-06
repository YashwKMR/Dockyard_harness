# Contributing to Dockyard Harness

Thank you for your interest in contributing to **Dockyard Harness**! We welcome bug reports, feature requests, documentation improvements, and code contributions.

## Monorepo Architecture
The repository is managed as an npm monorepo under `packages/*`:
- `@dockyard/core`: Core harness runtime, models, planning, tools, memory, and RL trajectory recorder.
- `@dockyard/cli`: Terminal interface and daemon launcher (`dockyard run`, `dockyard chat`, `dockyard serve`).
- `@dockyard/desktop`: Desktop dashboard built with React + Vite.

## Development Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Build the packages:**
   ```bash
   npm run build
   ```

3. **Run the test suite:**
   ```bash
   npm test
   ```

4. **Typecheck:**
   ```bash
   npm run typecheck
   ```
