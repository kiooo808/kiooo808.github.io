const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkDirectory, validatePost } = require('./check-posts.cjs');

test('accepts valid metadata and ordinary Markdown without metadata', () => {
  validatePost('---\ntitle: 日记\ndescription: hello world！\n---\n正文');
  validatePost('# 日记\n正文');
});

test('rejects the original diary metadata error', () => {
  assert.throws(() => validatePost('---\ntitle: 日记\ndescription:\nhello world！\n---\n正文'));
});

test('rejects an unclosed metadata block', () => {
  assert.throws(() => validatePost('---\ntitle: 日记\n正文'), /结束分隔线/);
});

test('checks nested uploads with Windows newlines and a UTF-8 BOM', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'myblog-posts-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, '日记'));
  const filename = path.join(directory, '日记', 'test.md');
  fs.writeFileSync(filename, '\uFEFF---\r\ntitle: 日记\r\ndescription:\r\nhello world！\r\n---\r\n正文');
  assert.deepEqual(checkDirectory(directory), { count: 1, errors: 1 });
  fs.writeFileSync(filename, '\uFEFF---\r\ntitle: 日记\r\ndescription: hello world！\r\n---\r\n正文');
  assert.deepEqual(checkDirectory(directory), { count: 1, errors: 0 });
});
