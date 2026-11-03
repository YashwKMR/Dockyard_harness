# Contributing to Dockyard

Thank you for your interest in contributing to Dockyard!

## Development Workflow

1. Fork and clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build all workspace packages:
   ```bash
   npm run build
   ```
4. Run the test suite:
   ```bash
   npm test
   ```

## Coding Guidelines

- **TypeScript**: All core logic and CLI implementations must be strictly typed TypeScript.
- **Cross-Platform Compatibility**: Always ensure paths and commands support both Windows (`\\` path separators, `cmd.exe`/PowerShell) and macOS/Linux (`/` path separators, bash/zsh).
- **Testing**: Every new feature or tool must include unit and integration tests under `*.test.ts`.
- **Git Merge Diffs**: Preserve standard format for targeted file edits.

## Submitting Pull Requests

1. Create a feature branch: `git checkout -b feat/my-improvement`
2. Commit your changes with descriptive commit messages.
3. Verify tests pass: `npm test`
4. Open a pull request against the `main` branch.
