import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hasAgentMention } from '../src/mentions.ts';
import { isRepositorySync } from '../src/provider-events.ts';

test('provider health and credential failures cannot announce successful repository sync', () => {
  for (const provider of ['github', 'azure-devops', 'linear']) {
    assert.equal(isRepositorySync({ provider, count: 0 }), true);
    assert.equal(isRepositorySync({ provider, count: 4 }), true);
    assert.equal(isRepositorySync({ provider, status: 'ok' }), false);
    assert.equal(isRepositorySync({ provider, status: 'error', error: 'No credential connected' }), false);
    assert.equal(isRepositorySync({ provider, count: 4, status: 'error' }), false);
    assert.equal(isRepositorySync({ provider, count: 4, error: 'failed' }), false);
    for (const count of [-1, NaN, Infinity, 1.5, '4', null]) assert.equal(isRepositorySync({ provider, count }), false);
  }
  assert.equal(isRepositorySync(null), false);
  assert.equal(isRepositorySync({ count: 4 }), false);
  const source = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(source, /if \(!isRepositorySync\(event.payload\)\) return;\s+refreshRepos\(\)/);
});

test('deleted and partial mentions cannot leave an agent selected', () => {
  assert.equal(hasAgentMention('', 'Builder'), false);
  assert.equal(hasAgentMention('Write documentation', 'Builder'), false);
  assert.equal(hasAgentMention('@Builder helper', 'Builder'), true);
  assert.equal(hasAgentMention('@BuilderExtra helper', 'Builder'), false);
  assert.equal(hasAgentMention('@Moon Cheese Inspector engineer inspect this', 'Moon Cheese Inspector engineer'), true);
  assert.equal(hasAgentMention('@Moon Cheese inspect this', 'Moon Cheese Inspector engineer'), false);
  assert.equal(hasAgentMention('(@QA [review]), inspect', 'QA [review]'), true);
  assert.equal(hasAgentMention('email@Builder', 'Builder'), false);
});

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Monaco permits generated styles without weakening script policy', () => {
  const { security } = JSON.parse(read('src-tauri/tauri.conf.json')).app;
  assert.deepEqual(security.dangerousDisableAssetCspModification, ['style-src']);
  const script = security.csp.split(';').find((directive) => directive.trim().startsWith('script-src'));
  assert.equal(script.trim(), "script-src 'self'");
  assert.match(security.csp, /style-src 'self' 'unsafe-inline'/);
  const editor = read('src/editor.tsx');
  for (const worker of ['editor', 'json', 'css', 'html', 'ts']) assert.ok(editor.includes(`${worker}.worker.js?worker`));
  assert.match(editor, /MonacoEnvironment/);
});

test('editor preserves HEAD on save and cannot save a pending or failed load', () => {
  const source = read('src/main.tsx');
  const editor = source.slice(source.indexOf('function CodeWorkspace('), source.indexOf('function Threads('));
  const save = editor.slice(editor.indexOf('const save ='), editor.indexOf('const createWorktree ='));
  assert.doesNotMatch(save, /setOriginal\(/);
  assert.match(save, /if \(saving \|\| loading \|\| !path\) return/);
  assert.match(editor, /if \(request !== loadRequest.current\) return/);
  assert.match(editor, /const \[path, setPath\] = useState\(""\)/);
  assert.match(source, /CodeWorkspace key=\{`\$\{repo.name\}:\$\{repo.path\}`\}/);
});

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
