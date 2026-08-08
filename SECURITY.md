# Wand security review ledger

Local security audit ledger (opencode lane). Not committed (same rule as
REQUIREMENTS.md). Review cadence: re-verify after every backend or deps change,
and monthly. Keep the table current.

Severity: `critical` / `high` / `medium` / `low` / `info`.

## First audit — 2026-08-08

Reviewed: `src-tauri/src/lib.rs`, `src/main.tsx`, `tauri.conf.json`,
`package.json`, CI workflow, CSS surface. Threat model = local desktop app,
renderer is untrusted only if XSS occurs (CSP enabled would be the backstop).

### Findings

| # | Severity | Area | Finding | Status | Evidence / next check |
|---|---|---|---|---|---|
| S1 | high | Monaco editor | `@monaco-editor/loader` defaults to CDN: loads `https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs` at runtime (`node_modules/@monaco-editor/loader/lib/es/config/index.js:3`). Remote third-party code executes inside the webview, and any DNS/registry compromise silently changes editor code. | open | Fix candidates (Codex lane): `loader.config({ monaco })` with bundled `monaco-editor` from `node_modules`, or copy `monaco-editor/min/vs` into `src/assets` and set `paths` locally. Verify offline + let safer fallback. |
| S2 | high | Webview CSP | `tauri.conf.json` `app.security.csp: null` — no Content-Security-Policy. Any renderer XSS becomes full local app RCE (arbitrary invoke + fs access). | open | Add a strict CSP (Tauri 2) covering `default-src 'self'` + local assets; permits `asset:` for Monaco if bundled. Codex lane. |
| S3 | medium | File read/write | `read_repo_file`/`write_repo_file`/`git_file_versions` accept arbitrary `repo_path` from renderer and `canonicalize`+`starts_with` guard keeps you inside *that root* — but the root is renderer-supplied, so a compromised renderer can point it at any directory (e.g. pass repo_path from a repo row). Not a traversal bug, but relies on renderer being honest. | open | Resolve/validate `repo_path` against the `repos` table (renderer sends repo `name`; backend flips to stored `path`). So renderer cannot nominate arbitrary roots. Codex lane. |
| S4 | medium | CNN exfil | `sync_azure_devops`/`sync_azure_activity`/`background_azure_activity` send the stored Azure PAT to a user-supplied base URL (`provider_url`) in `Basic` + it's followed into sub-requests. If a user pastes a malicious "org URL", PAT goes to that host (only base is user-controlled; attacker host confirm). | open | On save, validate `provider_url` scheme=HTTPS and host ends with `dev.azure.com`. Re-check at each sync. Codex lane. |
| S5 | low | HTTP client | `reqwest::Client::new()` everywhere — no timeouts, no redirect policy cap. Slow/hostile endpoints can hold sync threads. | open | Centralize a client with `timeout(Duration::from_secs(60))` and `redirect::Policy::none-or-limited`. Codex lane. |
| S6 | low | Crawl-rate permit | Background GitHub/Azure worker polls each repo every 5 min with the user PAT; burst concurrency `for` loop sequential but slow internet with 100 repos can stack. Rate is fine outside provided limits; still add per-request/retry-limit. | open | Add small retry + per-pull throughput. Codex lane. |
| S7 | info | Ledger claim vs reality | REQUIREMENTS claim "credentials never exposed to React" — relatyv tokens do transit the renderer (are) on `save_provider_token` (renderer post is the source). Stored access returns only bool; good. But the claim overstates. | note | Adjust ledger wording: "persisted/stored tokens never re-entrust to renderer; input necessarily transits." |
| S8 | info | ACLs un/cap | No Tauri `capabilities/` folder committed; plugin permissions (updater, notification, dialog, process) rely on defaults. Confirm real release runs ship an explicit capability set. | verify | Add `capabilities/*.json` with only `core:default` + `updater:default` + used plugin perms; ban unused. Codex lane. |

### Verified good posture (no action)

- **Keychain isolation**: provider tokens in OS keyring (keyring crate), service names installation-scoped via UUID; legacy tokens auto-migrated. Nonce repo row: strong. ✗
- **SQL Injection**: every query uses prepared statements +`params![]`. No concatenation anywhere. Clean.
- **Command execution**: external CLIs (`claude/codex/kimi/gemini`) gated by `cli_args` allowlist `allowed_cli`; run via `std::process::Command` without a shell. Cron expressions parsed before arbitrary scheduling. Clean.
- **Path traversal guard**: `/git_file_versions`, `read_repo_file`, `write_repo_file` canonicalize and assert `starts_with(root)` — a real guard (see S3 for the root-trust nuance).
- **Secrets in repo**: `gitignore` blocks `target/`, `dist/`, `node_modules/`; no PAT/key in tree; CI uses `TAURI_SIGNING_*` env secrets with updater pubkey configured.
- **JSX**: React escapes rendered text; no `dangerouslySetInnerHTML`; `notification` bodies/types are rendered as text (nil XSS from provider data today).
- **Render surface**: window decorations false; no `dangerousDisableAssetCspModification`; update signed with configured pubkey.

### Re-check triggers
- New IPC command added or existing one changed.
- New dependency (npm or Cargo) → run `npm audit` + `cargo audit`. Not installed yet; recommend both.
- Any change to `tauri.conf.json` (CSP/Udater).
- Every release-quality build: run the app and verify Monaco loads WITHOUT network (after S1 fix).

### Next actions (owner = Codex, recorded here only — opencode must not edit Codex lane files)
1. S1: bundle Monaco locally, kill the CDN dependency.
2. S2: enable a strict CSP.
3. S3: backend resolves repo path from DB by name.
4. S4: restrict Azure org URL to `https` + `dev.azure.com`.
5. S8: commit a capabilities file.
6. Add `cargo audit` + `npm audit` to the CI.