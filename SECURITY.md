# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub's private vulnerability
reporting for this repository. Do not open a public issue containing credentials,
PATs, exploit details, or unpublished updater information.

Include the affected version, platform, reproduction steps, and impact. Wand
maintainers will acknowledge a report and coordinate a fix or mitigation before
public disclosure.

## Dependency maintenance

Dependabot monitors npm, Cargo, and GitHub Actions dependencies weekly. Wand's
desktop runtime currently inherits the Linux GTK 0.18 dependency line through
Tauri 2.11.5; the open `glib 0.18.x` advisory cannot be upgraded independently
to `glib 0.20` because GTK's Rust API pins the compatible major line. Wand does
not force an incompatible override. The Cargo update configuration keeps the
alert visible and will surface the upstream Tauri/GTK fix when available.

Provider PATs are stored through the native OS credential manager and are never
written to SQLite, browser storage, repository files, or release artifacts.
