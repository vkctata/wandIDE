# Wand — multi-agent working agreement

Read this before editing. Two agents share this repo (Codex and opencode). This
doc prevents clobbering. Update it when handing off a problem.

## Ownership map

- Codex owns: `src-tauri/**` (Rust backend, IPC commands, scheduler, providers),
  `src/main.tsx` (React logic, views, wiring), `package.json`/deps, CI, the
  REQUIREMENTS ledger (statuses + next checks).
- opencode owns: the UI **polish layer only** — `src/premium-plus.css` and any
  pure-CSS tuning of the existing stylesheets. It must NOT edit `lib.rs` or
  `main.tsx` logic unless the user explicitly asks. If opencode finds a logic
  or build bug, it records it here for Codex instead of fixing it.
- opencode ALSO owns: **the security review of the whole codebase**, tracked in
  `SECURITY.md` (local ledger, not committed, alongside the REQUIREMENTS rule).
  Cadence: refresh after any backend change, dependency change, or CSP/updater
  change, plus monthly. Kick it off with `npm audit` + `cargo audit` when
  available. Findings are logged in SECURITY.md and handed to Codex to fix its
  lane; opencode does not patch Codex lanes from the ledger.

## User rules (both agents)

- The app must feel premium, not "vibe-coded": no constant shimmer, colored
  glow halos, sparkle spins, drifting orbs, or hover jumps. Motion = short,
  single entrance pass + quiet hover lift. Respect `prefers-reduced-motion`.
- Wand branding: inline-SVG magic wand mark (already in place). Keep it quiet.
- Top bar is immersive: no breadcrumb/title (already removed per user).
- Never commit REQUIREMENTS.md (per its own header note) and never commit
  secrets, PATs, or signing keys.

## Live status (update as you work)

- Frontend: `npm run build` passes (tsc + vite).
- Backend: `cargo check` FAILS right now — `invoke_handler` in
  `src-tauri/src/lib.rs` still lists `list_events` and `list_task_runs`, but the
  `#[tauri::command]` fns for `list_events`/`list_task_runs` are currently
  missing (removed mid-refactor). Fix belongs to Codex: either re-add the two
  commands or drop them from the handler. This also blocks the CI `rust-check`
  job.
- Imeline: `view === 'code'` (Monaco editor + Git diff) is wired and reachable.

## Audit conclusions (opencode → verified 2026-08-08)

Ledger claims to update when Codex next edits REQUIREMENTS.md:

- Mark as done (code verified): Monaco editor, Git diff, repo folder
  picker/scan, user-configurable agents (+ scope + model + CLI), per-repo and
  workspace agent scopes, agent tagging on tasks, repo/settings UX, no Forge
  branding (clean), CI mac/win release jobs present, frontend build clean.
- Ledger is stale on: "Agent model selection → missing" (it is implemented in
  `save_agent` + Settings prompt); "Settings one access point" and theme
  visibility (both verified).
- Known gaps to flag in next ledger pass:
  - Only `codex` CLI works end-to-end (`execute_stage` passes `--print` to
    every CLI; Claude/Gemini/Kimi use different flags).
  - `task_runs` + `list_task_runs` exist but run-history/retry is not exposed
    in any UI.
  - OS notifications: plugin initialized but no `notify` call; inbox is UI-only.
  - Provider `sync_*` writes the `repos` table but the React sidebar does not
    re-hydrate from DB after sync.
  - macOS/Windows release artifacts and auto-update need one real green run
    with `TAURI_SIGNING_*` secrets to count as verified.
- UI lane (`premium-plus.css`): restrained pass done (entrance fade, quiet
  hover, crisp focus rings, magic-wand SVG logo, breadcrumb/title removed).
  Watch Contrast/lint; keep motion light and reduced-motion honored.
- 2026-08-08 opencode: swapped UI font DM Sans → Manrope (display=swap; DM Mono
  kept for mono/code). Retinted every hardcoded accent-purple to the theme
  accent: `.agenticon/.threadicon/.taskicon` (was #a98cff/#292445),
  `.stat svg`, `.purple` chip + `.tag.purple`, `.mark`, `.wandmark`,
  `.onboard-mark`, `.toast`, `.sideplus`, `.eyebrow`, `.badge`, `.nav.active
  svg`, hero h1 gradient, provider `.notice.unread`. All now use
  `var(--wand-accent)` (+ color-mix), falling back to the old hex when the var
  is unset. `npm run build` clean.
- 2026-08-08 opencode: fixed header Bell iconbtn (was inert) → navigates to
  notifications view in `src/main.tsx:56`. Fixed modal `textarea`/`select`/
  `input` legibility: ui-corrections only styled `.modal-field input` and
  `--ink-strong` was undefined (white-on-light). premium-plus.css now styles
  all three uniformly + defines ink vars per theme. Attn Codex for next
  REQUIREMENTS pass: agent models selector exists; `task_utils`/run-history
  still not exposed in UI.

## Handoff protocol

When one of us discovers a bug owned by the other lane, write a short entry
under "Live status" with the exact file:line and a suggested fix, then continue
with your own lane. Do not silently edit the other lane's files.

## Done criteria per lane

- Codex: `cargo check` clean, `npm run build` clean, requirements ledger
  evidence updated.
- opencode: CSS layer loaded last, no regressions in `npm run build`, no
  `!important` wars with Codex's component styles, reduced-motion honored.