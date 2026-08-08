# Wand

Wand is a lightweight, AI-first engineering workspace for Tauri 2, React, and TypeScript. It is designed around a simple idea: software work should move through a small team of focused agents, with each handoff visible and a final verifier running in the background.

## What is in this repository

The current build provides the desktop-ready product foundation:

- Tauri 2 desktop shell with a Rust command boundary
- React + TypeScript frontend powered by Vite
- Wand first-run onboarding walkthrough
- Premium responsive workspace UI with configurable dark/light accent themes, subtle gradients, and reduced-motion support
- Borderless themed desktop chrome with in-app minimize, maximize, and close controls
- Local repository workspace and task persistence in SQLite through the Tauri boundary, including manually added repositories
- Pre-built engineering agent catalog:
  - Planner
  - Builder
  - Code reviewer
  - Sentinel verifier
  - Docs writer
- Task creation with agent tagging and ordered handoff chains; each stage uses its configured CLI and model
- Configurable agent responsibilities (textarea, capped at 1,000 characters), supported CLI runtimes, model choices, skills, and repository scopes; every agent can be edited after creation
- Repository-scoped agents created automatically when local repositories are scanned
- Scheduled task execution with five- and seven-field cron expressions, durable run history, and background Rust scheduling
- Background provider polling and normalized `wand://` events to the UI, with a persistent worker heartbeat indicator and provider health errors
- GitHub and Azure DevOps repository and pull-request comment synchronization
- Repository threads with live human/agent messages and persisted agent handoff comments
- Activity timeline, in-app notifications, OS notifications, notification preferences, and settings surfaces
- Monaco file editor with guarded repository saves and Git original-versus-modified diff viewer
- Local CLI detection and opt-in access for Claude, Codex, Kimi, and Gemini CLI
- Tauri icon and desktop configuration for macOS and Windows
- Linux x64 packaging through GitHub Actions (`.deb` and `.AppImage`)
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

The background Rust worker wakes every 30 seconds. It monitors recurring cron tasks, creates durable task-run records, launches eligible local CLI chains, polls connected provider activity, and emits provider-agnostic events for sync, scheduling, agent progress, notifications, and repository threads. The React layer subscribes to those events without receiving PAT values or spawning processes.

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

To build and launch a local macOS application bundle:

```bash
npm run tauri build -- --bundles app
open src-tauri/target/release/bundle/macos/Wand.app
```

Local packaging produces the application bundle even when updater signing secrets are not present. Release updater artifacts require `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

The first launch displays the Wand onboarding walkthrough. Completion is stored locally so it does not repeat on every start.

## Download Wand

Installers are published on the [Wand Releases page](https://github.com/vkctata/wandIDE/releases/latest). Choose the package for your platform:

- [macOS Apple Silicon](https://github.com/vkctata/wandIDE/releases/latest) — `.dmg`
- [macOS Intel](https://github.com/vkctata/wandIDE/releases/latest) — `.dmg`
- [Windows x64](https://github.com/vkctata/wandIDE/releases/latest) — `.msi` or `.exe`
- [Linux x64](https://github.com/vkctata/wandIDE/releases/latest) — `.deb` or `.AppImage`

GitHub Actions builds these installers for tagged releases and attaches them to the release. Linux users may need the WebKitGTK and related system libraries documented in the [Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux).

## Wand website

The static product site lives in `website/` and is published through
`.github/workflows/pages.yml` to GitHub Pages whenever the site changes on
`main`. It includes release-aware download links, product screenshots, and a
responsive newsletter signup surface. GitHub Pages cannot safely send email by
itself; configure `window.WAND_NEWSLETTER_ENDPOINT` in the site deployment to
point at a provider-owned HTTPS endpoint or a small serverless function. Keep
any provider API key on that service, never in the Pages bundle.

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

The resulting bundles are uploaded as workflow artifacts. Tagged releases produce the signed updater artifacts and downloadable installers.

The release matrix covers Apple Silicon macOS, Intel macOS, Windows x64, and Linux x64.

## Credential security

Provider PATs are never stored in Wand's SQLite database, browser storage, a `.pfx` file, or a repository. Wand stores them through the native OS credential manager: macOS Keychain, Windows Credential Manager, or the Linux Secret Service/keyring backend. Each installation gets a random installation namespace in the same OS credential manager, so one installation cannot accidentally reuse another installation's credential slot. Existing legacy Wand credentials are migrated into the installation-scoped slot on first use.

Wand intentionally does not create portable `.pfx` files for PATs. PFX is a certificate container and would require a separate password/key; keeping that password beside the file would be weaker than the native credential stores. No PAT value crosses into React or is written to disk by the Rust database layer.

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

Agents are persistent specialists with one responsibility, a skill set, model, CLI runtime, and scope. Responsibility text is capped at 1,000 characters and is used as the agent's execution instruction. A task can tag one or more applicable agents from the selected repository. Wand preserves their order and sends the output of one stage to the next:

```text
Planner → Builder → Code reviewer → Sentinel
```

Sentinel is always appended as the final verification stage. Each successful stage emits a handoff event, and Wand writes that finding into the repository thread so the work remains auditable.

#### Importing an agent workflow

Open Settings → Agent Team → Import workflow and choose a JSON file. Imported
agents are validated for supported CLI runtimes, model values, responsibility
length, and repository scope before they are saved. The portable format is:

```json
{
  "version": 1,
  "name": "Release train",
  "agents": [
    {
      "id": "release-planner",
      "name": "Release planner",
      "role": "Plan the release and identify verification work.",
      "skills": ["planning", "release"],
      "cli": "codex",
      "model": "default",
      "scope": "workspace"
    }
  ],
  "steps": ["release-planner"]
}
```

The imported workflow and its agents are stored locally in SQLite. Built-in
agents cannot be overwritten by an import.

### Repositories

Repositories are selected from a local workspace folder and scanned for Git repositories. Each repository becomes a navigable workspace tag, a repository-scoped engineering agent, and a context boundary for threads, tasks, agent runs, and provider events.

### Integrations

GitHub and Azure DevOps can be connected from Settings with PATs stored through the operating system credential manager. Repository sync and pull-request comment polling run in Rust background adapters, with normalized events sent to React.

### Local-first data

The browser shell keeps a small local-storage fallback for development. The desktop runtime persists repositories, tasks, events, threads, notifications, agents, provider settings, and task runs in SQLite through Tauri, while secrets remain in the OS credential manager.

## Remaining roadmap

1. Add streaming agent output and a durable per-stage transcript view.
2. Add worktree creation and patch application controls around the Monaco diff surface.
3. Add richer provider actions such as opening, approving, and commenting on pull requests from Wand.
4. Add configurable per-notification-category OS permission onboarding.

## License

See [LICENSE](./LICENSE).
