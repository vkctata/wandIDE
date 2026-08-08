# Wand

Wand is a lightweight, AI-first engineering workspace for Tauri 2, React, and TypeScript. It is designed around a simple idea: software work should move through a small team of focused agents, with each handoff visible and a final verifier running in the background.

## What is in this repository

The current build provides the desktop-ready product foundation:

- Tauri 2 desktop shell with a Rust command boundary
- React + TypeScript frontend powered by Vite
- Wand first-run onboarding walkthrough
- Premium dark workspace UI with subtle gradients and reduced-motion support
- Local repository workspace and task persistence
- Pre-built engineering agent catalog:
  - Planner
  - Builder
  - Code reviewer
  - Sentinel verifier
  - Docs writer
- Task creation with agent tagging and ordered handoff chains
- Scheduled task model with cron expressions
- Background Rust sync loop emitting `wand://sync` events to the UI
- Repository threads, activity timeline, notifications, and settings surfaces
- Tauri icon and desktop configuration for macOS and Windows
- GitHub Actions for web checks, Rust checks, and desktop packaging

The provider and CLI adapters are deliberately isolated behind the Tauri command boundary. This keeps credentials and process execution out of the browser layer and leaves room for GitHub, Azure DevOps, Claude, Codex, Kimi, and Gemini adapters.

## Architecture

```text
React / TypeScript UI
        │
        │ invoke + listen
        ▼
Tauri 2 / Rust boundary
        ├── agent execution commands
        ├── background sync thread
        ├── local persistence adapters
        └── provider + CLI integrations
```

The current background thread emits a provider-agnostic heartbeat every 30 seconds. The next adapter layer can use the same event channel to surface pull requests, comments, agent progress, and verification results without coupling provider APIs to the UI.

## Requirements

- Node.js 20+
- npm
- Rust stable and Cargo
- Tauri platform prerequisites for the operating system you are building on

On macOS, install the Rust toolchain with Homebrew if needed:

```bash
brew install rust
```

For Windows, install Rust through [rustup](https://www.rust-lang.org/tools/install) and install the Tauri Windows prerequisites described in the [Tauri guide](https://v2.tauri.app/start/prerequisites/).

## Local development

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173/` for the browser development shell.

To run the desktop application through Tauri:

```bash
npm run tauri dev
```

The first launch displays the Wand onboarding walkthrough. Completion is stored locally so it does not repeat on every start.

## Validation

Run the frontend build:

```bash
npm run build
```

Run the Rust/Tauri check:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

## Desktop builds

GitHub Actions is configured in `.github/workflows/ci.yml`.

Every push and pull request runs the web build and Rust check. The desktop job packages:

- Apple Silicon macOS (`aarch64-apple-darwin`)
- Windows x64 (`x86_64-pc-windows-msvc`)

The resulting bundles are uploaded as workflow artifacts and signed for the updater.

## Auto-updates

Wand uses the official Tauri updater plugin. On desktop startup it checks the GitHub Releases `latest.json` endpoint. If a newer signed release exists, Wand asks the user for approval, downloads the installer, verifies its signature, installs it, and relaunches. Browser development mode silently ignores updater errors because the Tauri plugin is not present there.

Updates are signed; unsigned artifacts are rejected. Configure these GitHub Actions secrets before publishing:

```text
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

The private key must never be committed. The public key is embedded in the desktop configuration and is safe to publish. The release workflow creates signed updater artifacts and drafts a GitHub Release for approval.

## Product concepts

### Agents

Agents are specialists with a role and a skill set. A task can tag one or more agents. Wand preserves their order and sends the output of one stage to the next:

```text
Planner → Builder → Code reviewer → Sentinel
```

Sentinel is the final verification stage and is intended to run independently in the background after the implementation handoff completes.

### Repositories

Repositories are selected from a local workspace folder and shown as navigable workspace tags. Each repository is a context boundary for threads, tasks, agent runs, and provider events.

### Integrations

GitHub and Azure DevOps are represented in Settings and will use PAT credentials stored through the operating system keychain in the desktop build. Provider polling belongs in Rust background adapters, with normalized events sent to React.

### Local-first data

The current browser shell persists repositories and tasks in local storage so the interaction is immediately usable. The production desktop persistence layer should move these records to SQLite through Tauri, while secrets remain in the OS keychain.

## Roadmap

1. Add SQLite migrations and repository/task/thread/run tables.
2. Add encrypted PAT storage through the OS keychain.
3. Implement GitHub and Azure DevOps pull request/comment sync.
4. Add Claude, Codex, Kimi, and Gemini CLI sidecar runners with streaming output.
5. Replace the demo sync heartbeat with provider and scheduler workers.
6. Add a worktree-aware editor, terminal panel, and agent run transcript.
7. Add signed installers and auto-update metadata for macOS and Windows.

## License

See [LICENSE](./LICENSE).
