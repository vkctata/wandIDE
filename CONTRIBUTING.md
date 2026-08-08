# Contributing to Wand

Thanks for helping build Wand. Start with an issue for substantial changes so
the approach can be discussed before implementation.

## Development

1. Fork or create a branch from `main`.
2. Keep changes focused and preserve the local-first security model.
3. Run `npm ci`, `npm run build`, and `cargo test --manifest-path src-tauri/Cargo.toml --lib --locked`.
4. Update the README when shipped behavior changes.
5. Open a pull request using the repository template.

Changes to `main` are made through pull requests. Do not commit credentials,
PATs, local database files, generated installers, or provider responses.

## Pull requests

Describe the user-visible behavior, verification performed, and platform
impact. UI changes should include a screenshot when practical. Security issues
should follow [`SECURITY.md`](SECURITY.md) rather than a public issue.
