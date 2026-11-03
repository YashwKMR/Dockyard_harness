# Contributing to Dockyard Harness

Thank you for your interest in contributing to **Dockyard Harness**! We welcome bug reports, feature requests, documentation improvements, and code contributions.

## Code of Conduct
Please be polite, constructive, and respectful to all community members and contributors.

## Monorepo Architecture
The repository is managed as an npm monorepo under `packages/*`:
- `@dockyard/core`: Core harness runtime, models, planning, tools, memory, and RL trajectory recorder.
- `@dockyard/cli`: Terminal interface and daemon launcher (`dockyard run`, `dockyard chat`, `dockyard serve`).
- `@dockyard/desktop`: Lightweight desktop dashboard built with React + Vite.

## Development Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yashwant0906/Dockyard_harness.git
   cd Dockyard_harness
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build the packages:**
   ```bash
   npm run build
   ```

4. **Run the test suite:**
   ```bash
   npm test
   ```

5. **Typecheck:**
   ```bash
   npm run typecheck
   ```

## Pull Request Guidelines
- Branch naming convention: `feat/<feature-name>`, `fix/<bug-fix>`, or `docs/<topic>`.
- Commit messages should follow Conventional Commits (e.g., `feat: ...`, `fix: ...`, `docs: ...`).
- Ensure all tests pass across platforms (macOS, Linux, Windows).
- If adding new features, include corresponding tests in `packages/core/src/index.test.ts` or `packages/cli/src/bin.test.ts`.
