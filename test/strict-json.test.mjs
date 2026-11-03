// Tests for the strict, size-bounded JSON parser in src/json/strict.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStrictJson, StrictJsonError, DEFAULT_MAX_BYTES, DEFAULT_MAX_DEPTH } from '../src/json/strict.mjs';

const refuses = (input, code, options) =>
  assert.throws(
    () => parseStrictJson(input, options),
    (error) => error instanceof StrictJsonError && error.code === code,
    `expected ${code} for ${JSON.stringify(typeof input === 'string' ? input.slice(0, 80) : '<bytes>')}`,
  );

const bytes = (str) => new TextEncoder().encode(str);

test('parses every RFC 8259 value type like JSON.parse', () => {
  const samples = [
    '{"a":1,"b":[true,false,null],"c":{"d":"e"}}',
    '[]',
    '{}',
    '"text"',
    '0',
    '-0',
    '12.5e-3',
    '1E+2',
    'true',
    'null',
    ' \t\r\n[ 1 , 2 ]\n',
    '"\\"\\\\\\/\\b\\f\\n\\r\\t\\u00e9\\uD83D\\uDE00"',
    '"café 😀"',
    '[[[[[]]]]]',
    '{"":""}',
  ];
  for (const text of samples) {
    assert.deepEqual(parseStrictJson(text), JSON.parse(text), text);
    assert.deepEqual(parseStrictJson(bytes(text)), JSON.parse(text), `${text} as bytes`);
  }
  assert.ok(Object.is(parseStrictJson('-0'), -0));
});

test('returns plain objects and keeps "__proto__" an ordinary own key', () => {
  const value = parseStrictJson('{"__proto__":{"polluted":true},"constructor":1}');
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.deepEqual(Object.keys(value), ['__proto__', 'constructor']);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.getPrototypeOf(value).polluted, undefined);
  assert.deepEqual(Object.getOwnPropertyDescriptor(value, '__proto__').value, { polluted: true });
});

test('refuses duplicate keys, including spellings that differ only by escapes', () => {
  refuses('{"a":1,"a":2}', 'duplicate');
  refuses('{"a":1,"\\u0061":2}', 'duplicate');
  refuses('{"\\u0041":1,"A":2}', 'duplicate');
  refuses('{"\\/":1,"/":2}', 'duplicate');
  refuses('{"\\ud83d\\ude00":1,"😀":2}', 'duplicate');
  refuses('{"x":{"a":1,"b":2,"a":3}}', 'duplicate');
  refuses('[{"k":1},{"k":1,"k":1}]', 'duplicate');
  refuses('{"__proto__":1,"__proto__":2}', 'duplicate');
  // Same key in different objects, and keys differing in case, are fine.
  assert.deepEqual(parseStrictJson('[{"k":1},{"k":2}]'), [{ k: 1 }, { k: 2 }]);
  assert.deepEqual(parseStrictJson('{"a":1,"A":2}'), { a: 1, A: 2 });
});

test('reports the offset of a duplicate key', () => {
  try {
    parseStrictJson('{"a":1, "a":2}');
    assert.fail('expected an error');
  } catch (error) {
    assert.equal(error.code, 'duplicate');
    assert.equal(error.offset, 8);
    assert.match(error.message, /Duplicate object key "a" at offset 8/);
  }
});

test('refuses trailing data and garbage after the value', () => {
  for (const text of ['{} {}', '{}x', '[1]]', '1 2', 'true false', 'nullx', '"a""b"', '{},', '0 0', '{}\u0000']) {
    refuses(text, 'syntax');
  }
  assert.deepEqual(parseStrictJson('{}  \n\t\r'), {});
});

test('refuses a byte order mark as text and as bytes', () => {
  refuses('﻿{}', 'bom');
  refuses(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]), 'bom');
  // A U+FEFF inside a string is data, not a byte order mark.
  assert.equal(parseStrictJson('"﻿"'), '﻿');
  // Only RFC 8259 whitespace may surround values.
  refuses(' ﻿{}', 'syntax');
  refuses(' {}', 'syntax');
  refuses(' {}', 'syntax');
});

test('refuses input over the byte limit, counting UTF-8 bytes', () => {
  refuses('[1,2,3]', 'too_large', { maxBytes: 6 });
  assert.deepEqual(parseStrictJson('[1,2,3]', { maxBytes: 7 }), [1, 2, 3]);
  // "é" is one UTF-16 unit but two UTF-8 bytes.
  refuses('"é"', 'too_large', { maxBytes: 3 });
  assert.equal(parseStrictJson('"é"', { maxBytes: 4 }), 'é');
  refuses(new Uint8Array(11).fill(0x20), 'too_large', { maxBytes: 10 });
  refuses(' '.repeat(DEFAULT_MAX_BYTES + 1), 'too_large');
  assert.equal(DEFAULT_MAX_BYTES, 1024 * 1024);
});

test('refuses nesting beyond the depth limit', () => {
  const nested = (n) => '['.repeat(n) + ']'.repeat(n);
  assert.deepEqual(parseStrictJson(nested(DEFAULT_MAX_DEPTH)).length, 1);
  refuses(nested(DEFAULT_MAX_DEPTH + 1), 'depth');
  refuses('{"a":{"b":{"c":1}}}', 'depth', { maxDepth: 2 });
  assert.deepEqual(parseStrictJson('{"a":{"b":1}}', { maxDepth: 2 }), { a: { b: 1 } });
  refuses('[]', 'depth', { maxDepth: 0 });
  assert.equal(parseStrictJson('1', { maxDepth: 0 }), 1);
  // A deep attack is refused without exhausting the call stack.
  refuses(nested(100000), 'depth', { maxBytes: 1e6 });
});

test('refuses malformed syntax', () => {
  const bad = [
    '',
    ' ',
    '{',
    '}',
    '[',
    '[1,]',
    '[,1]',
    '{"a":1,}',
    '{"a"}',
    '{"a" 1}',
    '{a:1}',
    "{'a':1}",
    '{1:1}',
    '[1 2]',
    '"unterminated',
    '"bad \\x escape"',
    '"bad \\u12 escape"',
    '"bad \\u12G4 escape"',
    '"raw \u0001 control"',
    '"raw \n newline"',
    '"tab\tinside"',
    'tru',
    'True',
    'NULL',
    'undefined',
    'NaN',
    'Infinity',
    '-Infinity',
    '01',
    '-',
    '+1',
    '1.',
    '.5',
    '1e',
    '1e+',
    '0x10',
    '1_000',
    '/* comment */ 1',
    '// comment\n1',
  ];
  for (const text of bad) refuses(text, 'syntax');
});

test('refuses numbers outside the finite double range', () => {
  refuses('1e400', 'number');
  refuses('-1e400', 'number');
  refuses('[1, 2e999]', 'number');
  assert.equal(parseStrictJson('1e308'), 1e308);
  assert.equal(parseStrictJson('1e-400'), 0);
});

test('refuses invalid UTF-8 and lone surrogates', () => {
  refuses(new Uint8Array([0x22, 0xff, 0x22]), 'encoding');
  refuses(new Uint8Array([0x22, 0xc0, 0xaf, 0x22]), 'encoding'); // overlong "/"
  refuses(new Uint8Array([0x22, 0xed, 0xa0, 0x80, 0x22]), 'encoding'); // encoded surrogate
  refuses('"\\ud800"', 'encoding');
  refuses('"\\udc00\\ud800"', 'encoding');
  refuses('{"\\ud800":1}', 'encoding');
  refuses('"\ud800"', 'encoding');
});

test('refuses inputs that are neither text nor bytes, and bad options', () => {
  refuses(42, 'type');
  refuses(null, 'type');
  refuses({ length: 2 }, 'type');
  assert.throws(() => parseStrictJson('{}', { maxBytes: 0 }), TypeError);
  assert.throws(() => parseStrictJson('{}', { maxBytes: 1.5 }), TypeError);
  assert.throws(() => parseStrictJson('{}', { maxDepth: -1 }), TypeError);
  assert.throws(() => parseStrictJson('{}', { maxDepth: 100000 }), TypeError);
});

test('parses large flat input quickly and agrees with JSON.parse', () => {
  const value = { items: Array.from({ length: 5000 }, (_, i) => ({ i, s: `item ${i} é😀 "q"`, b: i % 2 === 0 })) };
  const text = JSON.stringify(value);
  const started = performance.now();
  assert.deepEqual(parseStrictJson(text), value);
  assert.ok(performance.now() - started < 2000);
  assert.equal(parseStrictJson(`"${'x'.repeat(500000)}"`).length, 500000);
});
