import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { resolveAsset, safeReleaseUrl, releasePage } from '../website/releases.js';

const website = new URL('../website/', import.meta.url);
const html = readFileSync(new URL('index.html', website), 'utf8');

test('website local assets and section anchors resolve', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, new Set(ids).size, 'duplicate IDs');
  for (const [, anchor] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(anchor), anchor);
  for (const [, path] of html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g)) assert.ok(existsSync(new URL(path, website)), path);
  assert.ok(ids.includes('screenshots'));
});

test('release resolver uses exact platform suffixes and reports missing assets', () => {
  const url = 'https://github.com/vkctata/wandIDE/releases/download/v1/Wand_1_aarch64.dmg';
  const release = { assets: [{ name: 'Wand_1_aarch64.dmg', browser_download_url: url, size: 1048576 }] };
  assert.deepEqual(resolveAsset(release, 'aarch64.dmg'), { href: url, available: true, size: '1.0 MB' });
  assert.equal(resolveAsset(release, '_x64.dmg').available, false);
  assert.equal(resolveAsset(release, '').available, false);
  assert.equal(resolveAsset(null, '_x64.dmg').href, releasePage);
});

test('release URLs cannot redirect to another repository or credentials', () => {
  for (const url of ['https://github.com/other/repo/releases/latest', 'javascript:alert(1)', 'https://github.com.evil.test/vkctata/wandIDE/releases/latest', 'https://user:pass@github.com/vkctata/wandIDE/releases/latest', 'https://github.com/vkctata/wandIDE/releases/../../other']) {
    assert.equal(safeReleaseUrl(url), releasePage);
  }
});

function themeContext(saved, blocked = false) {
  const callbacks = {};
  const button = { hidden: true, setAttribute() {}, addEventListener(name, fn) { callbacks[name] = fn; } };
  const context = {
    document: { documentElement: { dataset: {} }, querySelector: (selector) => selector === '#theme-toggle' ? button : null, addEventListener(name, fn) { callbacks[name] = fn; } },
    window: { matchMedia: () => ({ matches: true, addEventListener(name, fn) { callbacks.system = fn; } }) },
    localStorage: { getItem() { if (blocked) throw Error('denied'); return saved; }, setItem(key, value) { if (blocked) throw Error('denied'); saved = value; } },
  };
  vm.runInNewContext(readFileSync(new URL('theme.js', website), 'utf8'), context);
  callbacks.DOMContentLoaded();
  return { context, callbacks, button };
}

test('theme follows system initially, remembers choice, and tolerates blocked storage', () => {
  for (const blocked of [false, true]) {
    const { context, callbacks, button } = themeContext(null, blocked);
    assert.equal(context.document.documentElement.dataset.theme, 'dark');
    assert.equal(button.hidden, false);
    callbacks.click();
    assert.equal(context.document.documentElement.dataset.theme, 'light');
    callbacks.system();
    assert.equal(context.document.documentElement.dataset.theme, 'light');
  }
  assert.equal(themeContext('light').context.document.documentElement.dataset.theme, 'light');
});

test('site does not pretend to stream live runs or collect unconfigured email', () => {
  assert.match(html, /ILLUSTRATIVE RUN/);
  assert.match(html, /newsletter-form" novalidate hidden/);
  assert.match(html, /Screenshots from earlier beta builds/);
  assert.doesNotMatch(readFileSync(new URL('styles.css', website), 'utf8'), /linear-gradient|radial-gradient|@keyframes/);
});
