# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Added

- Added an MIT `LICENSE` file and switched package metadata from ISC to MIT.
- Added contributor guidance in `AGENTS.md`.
- Added modular source layout for constants, types, database access, tool schemas, shared state, server setup, and tool handlers.

### Changed

- Reduced `src/index.ts` to the stdio bootstrap and moved MCP server registration into `src/server.ts`.
- Updated README usage docs to describe the credential-based tool API and Node.js 18 requirement.
- Changed `scp_copy` behavior to use SFTP through `ssh2` while preserving the public tool name.

### Security

- Removed local shell-string execution from SSH command handling.
- Hardened `ssh_exec` and `ssh_exec_raw` to run through `ssh2` with explicit timeout and output limits.
- Changed `rsync_copy` to use `spawn` with `shell: false`, `--protect-args`, and conservative path validation.
- Stopped logging raw MCP tool arguments.

### Removed

- Removed `MONETIZATION_STRATEGY.md`.
