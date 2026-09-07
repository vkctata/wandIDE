# Wand

The desktop interface uses flat, neutral surfaces and system typography by default. Theme and interaction colors change immediately, without transition animations that can leave inactive native windows displaying stale colors. A shared sparkles-only icon is generated for the platform installers. Home shows persisted agents and recent activity instead of placeholder agent cards. Native desktop permissions cover repository browsing, live events, notification consent, and restarting after an approved update.

Desktop reliability: macOS uses native window controls and rounded corners. Agent stages have a 30-minute deadline covering both process execution and output draining; timed-out process trees are terminated so inherited output pipes cannot leave a run waiting indefinitely. Provider-agent creation is covered by a database regression test.

Repository posts use the available width until a post opens in a detail pane with persistent comments. On narrow windows the detail pane stacks above the list. Unsent comment drafts stay with their selected post while switching between posts (drafts are session-only). Findings from tagged-agent tasks are saved as replies to the originating post by the native worker, including when the frontend is closed. Comments are restricted to root posts in the same repository. Tasks without an originating post retain their output in run transcripts. Routine worker heartbeats update the sidebar quietly; actionable task and provider events retain notifications.

Post submission disables the composer while saving and rejects overlapping clicks
before the next render. A rejected submission keeps its draft and tags for retry.
Comments also reject overlapping submissions. Failed history refreshes preserve
loaded posts with a retry action; a delayed snapshot cannot erase newer live replies.
Agent mentions follow the text cursor, preserve the rest of the draft, and support
multi-word name searches. The picker supports keyboard and accessible click selection.
Appearance changes apply after persistence succeeds. Settings reports saving and
failure states; failed writes retain the previous theme/font instead of silently
showing an unsaved choice. Browser preview preferences are separate from native storage.

Wand is a lightweight, AI-first engineering workspace for Tauri 2, React, and TypeScript. It is designed around a simple idea: software work should move through a small team of focused agents, with each handoff visible and a final verifier running in the background.

## What is in this repository

The current build provides the desktop-ready product foundation:

- Tauri 2 desktop shell with a Rust command boundary
- React + TypeScript frontend powered by Vite
- Wand first-run onboarding walkthrough
- Minimal responsive UI with neutral dark/light surfaces, restrained accents, clear separators, and reduced-motion support
- Native macOS window controls and rounded corners, with platform-specific desktop chrome
- Local repository workspace and task persistence in SQLite through the Tauri boundary, including manually added repositories
- Pre-built engineering agent catalog:
  - Planner
  - Builder
  - Code reviewer
  - Sentinel verifier
  - Docs writer
- Task creation with agent tagging and ordered handoff chains; each stage uses its configured CLI and model, streams bounded live output into Run history, and persists its final transcript
- Configurable agent responsibilities (textarea, capped at 1,000 characters), supported CLI runtimes, model choices, skills, and repository scopes; every agent can be edited after creation
- Repository-scoped agents created automatically when local repositories are scanned
- Scheduled task execution with five- and seven-field cron expressions, durable run history, and background Rust scheduling
- Background provider polling and normalized `wand://` events to the UI, with a persistent worker heartbeat indicator and provider health errors
- GitHub, Azure DevOps, and Linear synchronization (Linear teams/issues via GraphQL)
- Repository threads with live human/agent messages and persisted agent handoff comments
- Tagging an agent in a repository thread creates a persisted one-off task and starts the ordered handoff plus final Sentinel verification chain; tagged work appears immediately in Tasks
- Activity timeline, in-app notifications, OS notifications, notification preferences, and settings surfaces
- Activity stage summaries display configured agent names while preserving original event history and output.
- Home distinguishes loading, unavailable, and empty history; stale refresh responses cannot replace newer activity.
- Search shows local matches while history loads, identifies unavailable categories, and supports native keyboard activation of result buttons.
- Search supports Up/Down result navigation, Home/End within results, and Escape to dismiss results and return focus to the input.
- Monaco file editor with guarded repository saves and Git original-versus-modified diff viewer
- Local CLI detection and opt-in access for Claude, Codex, Kimi, and Gemini CLI
- Tauri icon and desktop configuration for macOS and Windows
- Linux x64 packaging through GitHub Actions (`.deb` and `.AppImage`)
- GitHub Actions for web checks, Rust checks, and desktop packaging

The provider and CLI adapters are deliberately isolated behind the Tauri command boundary. This keeps credentials and process execution out of the browser layer and leaves room for GitHub, Azure DevOps, Linear, Claude, Codex, Kimi, and Gemini adapters.

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

- Node.js 24+ (CI uses Node 24)
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

## Agent code output

Monaco workers are bundled locally for diff computation and language services.
The desktop CSP permits Monaco's generated inline styles: only Tauri's `style-src`
nonce injection is disabled, preserving the existing style policy. Script nonce/hash
injection and the restrictive script policy remain enabled; no remote editor code,
inline scripts, or eval are allowed. See [Tauri's CSP guidance](https://v2.tauri.app/security/csp/).

The file editor keeps Git HEAD as its diff baseline after saving. Save is disabled
until a file has loaded successfully, and stale file-load responses are ignored.
Switching repositories resets the editor to that repository's file context.
Editors remeasure their visible container on mount before drawing code, including
both diff panes, so native first paint does not rely on a deferred resize frame.

Fenced code in post details, comments, and saved agent transcripts uses lazy,
read-only Monaco snippets that follow the desktop appearance. Timeline cards show a short prose title (or a code
snippet label) instead of flattening fenced source code into their one-line preview.
The complete post remains in its detail pane. Large snippets
and additional blocks offer an explicit “Format code” action to limit editor
overhead. Plain text remains available during loading or if the editor fails.
Live streaming output remains a plain-text log until persisted; unfenced output
is not guessed to be code, and message HTML is never executed.

Provider health checks and credential errors do not produce successful-sync
notifications; those notices require a completed repository sync with a valid count.
Failures are tracked per provider: recovery or dismissal of one warning leaves
other provider failures visible, with a count when multiple connections need attention.

Approved updates show download progress and a separate installation state.
If installation succeeds but restarting fails, the button retries only the restart,
not the download or installation. Network checks and downloads use timeouts;
signature verification still belongs to Tauri's updater.

Onboarding finishes only after the desktop database saves your name. A failed
save keeps the walkthrough open with a retryable error; repeated submission is
blocked while saving. Browser previews store their name separately and cannot
mark native onboarding complete.

## Wand website

The product tour groups screenshots into keyboard-accessible tabs for tasks,
repository conversations, providers, and notifications. Without JavaScript,
all screenshots remain available as a gallery. Installation guidance covers
macOS, Windows, Linux, and the first repository task. Earlier beta captures
are labeled so they are not mistaken for the current release UI.

The static product site lives in `website/` and is published through
`.github/workflows/pages.yml` to GitHub Pages whenever the site changes on
`main`. It uses a responsive, neutral layout and a light/dark switch that follows
the system initially and saves the visitor's choice locally. An app tour covers
tasks, conversations, providers, and notifications; historical beta screenshots
are labeled accordingly. Download cards resolve the published release, package
size, and architecture, with an explicit fallback when an installer is missing
or GitHub cannot be reached. Run `node --test scripts/website.test.mjs` to check
assets, anchors, theme behavior, and release URL handling.

Email signup is hidden until connected, with GitHub release updates offered
instead. GitHub Pages cannot safely send email by itself; configure
`window.WAND_NEWSLETTER_ENDPOINT` in an external same-origin script loaded before
`main.js` (inline scripts are blocked by the site's CSP) to
point at a provider-owned HTTPS endpoint or a small serverless function. Keep
any provider API key on that service, never in the Pages bundle.

## Validation

Run the frontend build:

```bash
npm run build
npm run test:desktop
npm run check:ipc
```

Run the Rust/Tauri check:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib --locked
```

## Desktop builds

GitHub Actions is configured in `.github/workflows/ci.yml`.

Every push and pull request runs the web build and Rust check. The desktop job packages:

- Apple Silicon macOS (`aarch64-apple-darwin`)
- Windows x64 (`x86_64-pc-windows-msvc`)

The resulting bundles are uploaded as workflow artifacts. Tagged releases produce the signed updater artifacts and downloadable installers.

The release matrix covers Apple Silicon macOS, Intel macOS, Windows x64, and Linux x64.

Tagged releases are published automatically after the desktop matrix completes. The public release page includes macOS DMG and app archives, Windows EXE/MSI installers, Linux DEB/RPM/AppImage packages, and signed updater metadata.

### CLI runtime discovery

Settings detects Claude, Codex, Kimi, and Gemini CLI installations from the desktop process environment. Because macOS apps launched from Finder do not inherit an interactive shell's PATH, Wand also checks standard Homebrew, npm, Bun, Cargo, pnpm, and nvm locations. Windows npm command shims (`.exe`, `.cmd`, and `.bat`) are supported. Users still explicitly enable detected runtimes in Settings before an agent can execute.

## Credential security

Provider PATs can be disconnected from Settings at any time; disconnect removes the installation-scoped credential and clears Azure organization settings. New tokens are saved through macOS Keychain, Windows Credential Manager, or Linux Secret Service, never SQLite, browser storage, or a repository. A random installation namespace is retained in the local settings store. Tokens saved by earlier builds in the encrypted local file migrate on first access: Wand removes the file copy only after the native credential store accepts the token. If the system store is locked or unavailable, Wand reports the error without falling back to file storage. Linux users need a running, unlocked Secret Service such as GNOME Keyring or KWallet.

Wand intentionally does not create portable `.pfx` files for PATs. PFX is a certificate container and would require a separate password/key; keeping that password beside the file would be weaker than the native credential stores. No PAT value crosses into React or is written to disk by the Rust database layer.

## Auto-updates

Wand uses the official Tauri updater plugin. On desktop startup it checks the GitHub Releases `latest.json` endpoint. If a newer signed release exists, Wand asks the user for approval, downloads the installer, verifies its signature, installs it, and relaunches. Browser development mode silently ignores updater errors because the Tauri plugin is not present there.

Updates are signed; unsigned artifacts are rejected. Configure these GitHub Actions secrets before publishing:

```text
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

The private key must never be committed. The public key is embedded in the desktop configuration and is safe to publish. The release workflow creates signed updater artifacts and publishes a GitHub Release after the matrix succeeds.

## Product concepts

### Agents

Agents are persistent specialists with one responsibility, a skill set, model, CLI runtime, and scope. Responsibility text is capped at 1,000 characters and is used as the agent's execution instruction; there is no separate user-facing system-prompt field. A task can tag one or more applicable agents from the selected repository. Wand preserves their order and sends the output of one stage to the next:

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

GitHub, Azure DevOps, and Linear can be connected from Settings with PATs/API keys stored through the operating system credential manager. GitHub/Azure repository sync and pull-request comment polling plus Linear team synchronization run in Rust adapters, with normalized events sent to React.

### Local-first data

The browser shell keeps a small local-storage fallback for development. The desktop runtime persists repositories, tasks, events, threads, notifications, agents, provider settings, and task runs in SQLite through Tauri, while secrets remain in the OS credential manager.

## Remaining roadmap

1. Add worktree creation and patch application controls around the Monaco diff surface.
2. Add richer provider actions such as opening, approving, and commenting on pull requests from Wand.
3. Add configurable per-notification-category OS permission onboarding.

## License

See [LICENSE](./LICENSE).
