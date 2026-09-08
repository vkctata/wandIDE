import test from 'node:test';
import assert from 'node:assert/strict';
import { messageBlocks, messagePreview } from '../src/message-blocks.ts';

test('timeline previews keep prose separate from code and preserve full source', () => {
  const source = '\n## Verified result\n```ts\nconst answer = 42;\n```\nMore details.';
  assert.equal(messagePreview(source), 'Verified result');
  assert.equal(messageBlocks(source).find(block => block.kind === 'code').content, 'const answer = 42;');
  assert.equal(messagePreview('```ts\nconst answer = 42;\n```'), 'typescript snippet');
  assert.equal(messagePreview('```\ncode'), 'Code snippet');
  assert.equal(messagePreview('~~~py\nprint(1)\n~~~\nChecked successfully.'), 'Checked successfully.');
  assert.equal(messagePreview('   \n\t'), 'Empty post');
  assert.equal(messagePreview('x'.repeat(200)), 'x'.repeat(159) + '…');
  assert.equal(messagePreview('@Builder  Check this\nSecond line'), '@Builder Check this');
  assert.equal(messagePreview('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>');
});

test('keeps prose and HTML inert and preserves code content', () => {
  assert.deepEqual(messageBlocks('<script>alert(1)</script>'), [{kind:'text',content:'<script>alert(1)</script>',language:''}]);
  const blocks = messageBlocks('Result:\n```ts\nconst x = 1;\n```\nVerified.');
  assert.equal(blocks[0].content, 'Result:');
  assert.deepEqual(blocks[1], {kind:'code',content:'const x = 1;',language:'typescript'});
  assert.equal(blocks[2].content, 'Verified.');
});
test('supports tilde fences, CRLF and unfinished streaming blocks', () => {
  assert.equal(messageBlocks('~~~py\r\nprint(1)\r\n~~~')[0].language, 'python');
  assert.equal(messageBlocks('```rust\nfn main() {')[0].content, 'fn main() {');
});
test('closing fence must match type and minimum length', () => {
  const blocks = messageBlocks('````md\n```\nexample\n```\n````');
  assert.equal(blocks[0].content, '```\nexample\n```');
  assert.equal(messageBlocks('```\nx\n~~~')[0].content, 'x\n~~~');
});
test('does not mistake inline backticks for a block', () => {
  assert.equal(messageBlocks('Use `x` or ```y``` inline.')[0].kind, 'text');
  assert.equal(messageBlocks('```\n```')[0].content, '');
  assert.equal(messageBlocks('```inline``` text')[0].kind, 'text');
  assert.equal(messageBlocks('```js `invalid`\nx')[0].kind, 'text');
});

test('untrusted fence labels never resolve inherited object properties', () => {
  for (const name of ['__proto__', 'constructor', 'prototype', 'unknown-language']) {
    const block = messageBlocks('```' + name + '\nx\n```')[0];
    assert.equal(block.language, name);
    assert.equal(typeof block.language, 'string');
  }
});
