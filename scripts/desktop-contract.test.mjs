import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('routine heartbeat listener stays out of application notifications', () => {
  const source = read('src/main.tsx');
  const app = source.slice(0, source.indexOf('function BackgroundStatus()'));
  assert.doesNotMatch(app, /listen[^;]*"wand:\/\/sync"/);
  assert.match(source.slice(source.indexOf('function BackgroundStatus()')), /"wand:\/\/sync"/);
});

test('post comment state is keyed by originating post, including async completion', () => {
  const source = read('src/main.tsx');
  assert.match(source, /commentDrafts\[selected\.id\]/);
  assert.match(source, /commentErrors\[selected\.id\]/);
  assert.match(source, /parentId: postId/);
  assert.match(source, /drafts\[postId\] === submittedDraft/);
  assert.match(source, /aria-label="Close post details"/);
});

test('installed UI has native window controls, not a second HTML title bar', () => {
  const config = JSON.parse(read('src-tauri/tauri.macos.conf.json'));
  assert.equal(config.app.windows[0].decorations, true);
  assert.equal(config.app.windows[0].transparent, false);
  assert.doesNotMatch(read('src/main.tsx'), /function WindowChrome/);
});

test('desktop permissions cover live events, folder browsing and approved updates', () => {
  const { permissions } = JSON.parse(read('src-tauri/capabilities/macos-window-chrome.json'));
  for (const permission of ['core:event:default', 'dialog:allow-open',
    'notification:allow-is-permission-granted', 'notification:allow-request-permission',
    'notification:allow-notify', 'updater:allow-check',
    'updater:allow-download-and-install', 'process:allow-restart']) {
    assert.ok(permissions.includes(permission), `Missing ${permission}`);
  }
});

test('desktop canvas has no grid backgrounds and minimal styling is last', () => {
  assert.doesNotMatch(read('src/native-ui.css'), /background-image:\s*(?:linear|radial)-gradient/);
  const imports = [...read('src/main.tsx').matchAll(/import "(.+\.css)"/g)];
  assert.equal(imports.at(-1)[1], './minimal-ui.css');
  assert.match(read('src/minimal-ui.css'), /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(read('src/styles.css'), /fonts\.googleapis\.com/);
});

test('desktop and website share the same sparkles-only icon source', () => {
  assert.equal(read('src-tauri/icons/wand.svg'), read('website/assets/wand-logo.svg'));
  assert.doesNotMatch(read('src/main.tsx'), /className="wand-d"/);
});

test('Tauri JavaScript and Rust packages have matching major/minor versions', () => {
  const rust = new Map([...read('src-tauri/Cargo.lock').matchAll(/\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"/g)].map((match) => [match[1], match[2]]));
  const { packages } = JSON.parse(read('package-lock.json'));
  for (const [name, entry] of Object.entries(packages)) {
    if (!name.startsWith('node_modules/@tauri-apps/plugin-') && name !== 'node_modules/@tauri-apps/api') continue;
    const crate = name.endsWith('/api') ? 'tauri' : name.replace('node_modules/@tauri-apps/', 'tauri-');
    assert.equal(entry.version.split('.').slice(0, 2).join('.'), rust.get(crate)?.split('.').slice(0, 2).join('.'), `${crate} must match its JavaScript package`);
  }
});
