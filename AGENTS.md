# Wand engineering notes

This repository is maintained by one owner. Keep changes focused, preserve
unrelated working-tree edits, and validate both the React build and Rust tests
before publishing.

## Product guardrails

- Wand is a Tauri 2, React, and TypeScript desktop engineering IDE.
- Keep provider credentials in native OS credential storage and keep process
  execution behind the Rust IPC boundary.
- Preserve repository and agent scope checks when changing task execution.
- Keep Settings as the single control center for themes, providers, CLI access,
  agents, notifications, and workspace selection.
- Keep motion restrained and honor `prefers-reduced-motion`.
- Never commit `REQUIREMENTS.md`, secrets, PATs, or signing keys.

## Verification

```bash
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Changes to desktop packaging should also be verified with the appropriate
Tauri bundle command and the GitHub Actions workflow.
