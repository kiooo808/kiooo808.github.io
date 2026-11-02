'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { themeForHour } = require('../../source/js/time-color-scheme.js');

test('uses visitor time with exact morning and evening boundaries', () => {
  for (const [hour, expected] of [[0, 'dark'], [5, 'dark'], [6, 'light'], [12, 'light'], [17, 'light'], [18, 'dark'], [23, 'dark']]) {
    assert.equal(themeForHour(hour), expected, `hour ${hour}`);
  }
});

function bootstrap(hour, { manual = null, blocked = false } = {}) {
  const attributes = new Map();
  const local = new Map([['Fluid_Color_Scheme', 'light']]);
  const session = new Map(manual ? [['MyBlog_Visit_Color_Scheme', manual]] : []);
  const storage = map => ({
    getItem(key) { if (blocked) throw Error('blocked'); return map.get(key) ?? null; },
    setItem(key, value) { if (blocked) throw Error('blocked'); map.set(key, value); },
    removeItem(key) { if (blocked) throw Error('blocked'); map.delete(key); }
  });
  let click;
  const document = { documentElement: {
    setAttribute: (key, value) => attributes.set(key, value),
    getAttribute: key => attributes.get(key)
  }, addEventListener: (type, callback) => { if (type === 'click') click = callback; } };
  const window = { document, Date: class { getHours() { return hour; } }, localStorage: storage(local), sessionStorage: storage(session), queueMicrotask: callback => callback() };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../source/js/time-color-scheme.js'), 'utf8'), { window });
  return { attributes, local, session, click };
}

test('new visits use the clock instead of a stale saved Fluid setting', () => {
  const result = bootstrap(23);
  assert.equal(result.attributes.get('data-default-color-scheme'), 'dark');
  assert.equal(result.attributes.get('data-user-color-scheme'), 'dark');
  assert(!result.local.has('Fluid_Color_Scheme'));
});

test('manual override survives full-page navigation during the visit', () => {
  const result = bootstrap(23, { manual: 'light' });
  assert.equal(result.attributes.get('data-default-color-scheme'), 'dark');
  assert.equal(result.attributes.get('data-user-color-scheme'), 'light');
  assert.equal(result.local.get('Fluid_Color_Scheme'), 'light');
});

test('manual mode button records the resulting mode for this visit', () => {
  const result = bootstrap(12);
  result.attributes.set('data-user-color-scheme', 'dark');
  result.click({ target: { closest: () => ({}) } });
  assert.equal(result.session.get('MyBlog_Visit_Color_Scheme'), 'dark');
});

test('clock choice still works when browser storage is unavailable', () => {
  assert.equal(bootstrap(5, { blocked: true }).attributes.get('data-user-color-scheme'), 'dark');
  assert.equal(bootstrap(6, { blocked: true }).attributes.get('data-user-color-scheme'), 'light');
});
