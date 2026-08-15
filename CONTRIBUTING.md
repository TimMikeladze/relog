# Contributing to relog

Thank you for your interest in contributing to our project! This guide will help you get started with the development process.

## Development Setup

### Prerequisites

- Bun installed on your system

### Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/TimMikeladze/relog.git`
3. Navigate to the project directory: `cd relog`
4. Install dependencies: `bun run setup`
5. Start development: `bun run dev`

## Repository Layout

This is not a Bun workspace. The root package holds the server, CLI and SDK, while `app/` (the UI) and `docs/` (the marketing site) are independent packages with their own `package.json`, `bun.lock` and `node_modules`.

Because of that, a bare `bun install` only covers the root. Use `bun run setup` to install all three, and run dependency updates in each directory separately:

```bash
bun update --latest              # root
bun update --latest --cwd app    # UI
bun update --latest --cwd docs   # docs site
```

## Development Workflow

1. Create a new branch: `git checkout -b feature/your-feature-name`
2. Make your changes
3. Check code style and formatting: `bun run lint` and `bun run format`
4. Run tests: `bun run test` (backend). For the full suite including app UI tests, use `bun run test:all`
5. Build the project: `bun run build` (or `bun run build:bin` for a standalone binary)
6. Commit your changes using the conventions below
7. Push your branch to your fork
8. Open a pull request

## Commit Message Conventions

We follow [Conventional Commits](https://www.conventionalcommits.org/) for clear and structured commit messages:

- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation changes
- `style:` Code style changes (formatting, etc.)
- `refactor:` Code changes that neither fix bugs nor add features
- `perf:` Performance improvements
- `test:` Adding or updating tests
- `chore:` Maintenance tasks, dependencies, etc.

## Pull Request Guidelines

1. Update documentation if needed
2. Ensure all tests pass
3. Address any feedback from code reviews
4. Once approved, your PR will be merged

## Code of Conduct

Please be respectful and constructive in all interactions within our community.

## Questions?

If you have any questions, please [open an issue](https://github.com/TimMikeladze/relog/issues/new) for discussion.

Thank you for contributing to relog!
