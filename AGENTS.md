# Repository Guidelines

## Project Structure & Module Organization

This is a TypeScript MCP server for SSH and rsync operations. Runtime source lives in `src/`, with `src/index.ts` currently containing the MCP server setup, tool schemas, SQLite credential storage, and command execution handlers. Compiled JavaScript is emitted to `build/` by TypeScript and should be treated as generated output. Root configuration includes `package.json`, `package-lock.json`, and `tsconfig.json`. Documentation lives in root Markdown files such as `README.md`.

## Build, Test, and Development Commands

- `npm install`: install runtime and development dependencies from `package-lock.json`.
- `npm run build`: compile `src/**/*.ts` to `build/` using `tsc`; run this before shipping changes.
- `npm start`: run the built server with `node build/index.js` over stdio.
- `npx tsc --noEmit`: optional type-check-only pass when you do not want to update `build/`.

There is currently no `npm test` script. Until a test harness is added, `npm run build` is the minimum verification step.

## Coding Style & Naming Conventions

Use TypeScript with `strict` mode enabled. Keep indentation at 4 spaces to match the existing source. Prefer clear camelCase names for functions and variables, PascalCase for interfaces and types, and snake_case only for MCP tool names such as `ssh_exec` and `rsync_copy`. Keep tool schemas and handler argument types aligned when adding or changing tools.

## Testing Guidelines

Add tests when changing command construction, path validation, database behavior, or MCP tool schemas. Prefer focused tests around pure helpers and command-building logic before integration tests that touch real SSH hosts. Name tests after the behavior under test, for example `validatePrivateKeyPath.test.ts` or `rsyncCommand.test.ts`, and wire them into a future `npm test` script.

## Commit & Pull Request Guidelines

Recent commits use short imperative subjects such as `Update README`, `Add Dockerfile`, and `rsync fix`. Prefer descriptive imperative messages, for example `Fix rsync remote path quoting`. Pull requests should describe the tool behavior changed, list local verification commands, and mention any SSH, SQLite, Docker, or Smithery impact.

## Security & Configuration Tips

The server stores credentials in `~/ssh.db` and validates private key paths on disk. Do not commit private keys, local databases, `node_modules/`, or generated `build/` artifacts. Be careful when editing command construction: quote paths deliberately, avoid logging secrets, and verify both success and failure output paths.
