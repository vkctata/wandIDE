# Wand security review ledger

Local security review notes. Keep this file out of commits unless a security
finding is intentionally being documented for release work.

## Open findings

| Area | Severity | Finding | Next check |
|---|---|---|---|
| Monaco editor | high | Confirm the editor is bundled locally and does not load third-party code from a CDN. | Verify offline in a release build. |
| Webview CSP | high | Add and verify a strict production Content-Security-Policy. | Test the packaged app and required Tauri assets. |
| File IPC | medium | Resolve repository paths against SQLite records rather than trusting renderer-supplied roots. | Exercise read/write/diff commands with an unregistered path. |
| Azure DevOps URL | medium | Validate HTTPS and an approved Azure DevOps host before sending credentials. | Add URL validation tests. |
| HTTP clients | low | Use bounded request timeouts and a controlled redirect policy. | Exercise provider sync failure and timeout paths. |
| Tauri permissions | info | Review explicit plugin capabilities for the packaged application. | Verify only required IPC permissions are enabled. |

## Verified controls

- Provider PATs are stored in installation-scoped native credential storage.
- SQL queries use prepared parameters.
- CLI execution uses an allowlist and does not invoke a shell.
- Repository file paths are canonicalized and checked against a root.
- React renders provider data as escaped text.
- Updater artifacts use signature verification.
