import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { resolveAsset, safeReleaseUrl, releasePage } from '../website/releases.js';
import { enhanceTour } from '../website/tour.js';

const website = new URL('../website/', import.meta.url);
const html = readFileSync(new URL('index.html', website), 'utf8');

test('app tour supports selection, keyboard wrapping, and accessible panel relationships', () => {
  const element = () => ({
    attributes: {}, children: [], events: {}, hidden: false,
    setAttribute(key, value) { this.attributes[key] = value; },
    append(child) { this.children.push(child); },
    addEventListener(key, fn) { this.events[key] = fn; },
    focus() { this.focused = true; },
  });
  const panels = ['Tasks', 'Threads', 'Providers', 'Notifications'].map((title) => ({ ...element(), querySelector: () => ({ textContent: title }) }));
  let tabs;
  const gallery = { querySelectorAll: () => panels, before: (value) => { tabs = value; }, classList: { add() {} } };
  enhanceTour(gallery, { createElement: element });
  assert.equal(tabs.attributes.role, 'tablist');
  assert.deepEqual(panels.map(p => p.hidden), [false, true, true, true]);
  tabs.children[1].events.click();
  assert.deepEqual(panels.map(p => p.hidden), [true, false, true, true]);
  const press = (index, key) => tabs.children[index].events.keydown({ key, preventDefault() {} });
  press(1, 'End');
  assert.equal(tabs.children[3].focused, true);
  press(3, 'ArrowRight');
  assert.equal(panels[0].hidden, false);
  press(0, 'ArrowLeft');
  assert.equal(panels[3].hidden, false);
  press(3, 'Home');
  assert.equal(panels[0].hidden, false);
  tabs.children.forEach((button, i) => {
    assert.equal(button.attributes['aria-controls'], panels[i].id);
    assert.equal(panels[i].attributes['aria-labelledby'], button.id);
    assert.equal(button.tabIndex, i === 0 ? 0 : -1);
  });
  enhanceTour(null, {});
});

test('website local assets and section anchors resolve', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, new Set(ids).size, 'duplicate IDs');
  for (const [, anchor] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(anchor), anchor);
  for (const [, path] of html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g)) assert.ok(existsSync(new URL(path, website)), path);
  assert.ok(ids.includes('screenshots'));
});

test('setup answers are accessible without JavaScript and hero downloads identify their platform', () => {
  const questions = html.split('id="questions"')[1].split('</section>')[0];
  assert.equal([...questions.matchAll(/<details>/g)].length, 5);
  assert.equal([...questions.matchAll(/<summary>[^<]+<\/summary>/g)].length, 5);
  assert.match(questions, /computer awake/);
  assert.match(questions, /may send prompts and code/);
  const hero = html.split('class="hero-meta"')[1].split('</ul>')[0];
  assert.match(hero, /data-release-asset="_x64_en-US.msi"/);
  assert.match(hero, /data-release-asset="_amd64.AppImage"/);
  assert.match(hero, /href="#download" aria-label="Choose a macOS installer"/);
});

test('release resolver uses exact platform suffixes and reports missing assets', () => {
  const url = 'https://github.com/vkctata/wandIDE/releases/download/v1/Wand_1_aarch64.dmg';
  const release = { assets: [{ name: 'Wand_1_aarch64.dmg', browser_download_url: url, size: 1048576 }] };
  assert.deepEqual(resolveAsset(release, 'aarch64.dmg'), { href: url, available: true, size: '1.0 MB' });
  assert.equal(resolveAsset(release, '_x64.dmg').available, false);
  assert.equal(resolveAsset(release, '').available, false);
  assert.equal(resolveAsset(null, '_x64.dmg').href, releasePage);
});

test('release lookup updates hero links without adding download-card captions', async () => {
  const url = 'https://github.com/vkctata/wandIDE/releases/download/v1/Wand_1_x64_en-US.msi';
  const link = (card) => ({
    dataset: { releaseAsset: '_x64_en-US.msi' }, children: [],
    classList: { contains: () => card }, setAttribute() {}, removeAttribute() {},
    append(child) { this.children.push(child); },
  });
  const hero = link(false), card = link(true), status = {};
  const source = readFileSync(new URL('main.js', website), 'utf8').replace(/^import[^\n]+\n/, '');
  vm.runInNewContext(source, {
    releasePage, resolveAsset, AbortSignal,
    document: {
      querySelectorAll: () => [hero, card],
      querySelector: (selector) => selector === '#release-status' ? status : null,
      createElement: () => ({}),
    },
    fetch: async () => ({ ok: true, json: async () => ({ tag_name: 'v1', assets: [{ name: 'Wand_1_x64_en-US.msi', browser_download_url: url }] }) }),
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(hero.href, url);
  assert.equal(card.href, url);
  assert.equal(hero.children.length, 0);
  assert.equal(card.children.length, 1);
  assert.equal(status.textContent, 'Latest published release: v1');
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
