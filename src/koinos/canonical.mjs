// Koinos 0.1 canonical JSON: sorted keys (UTF-16 code unit order), no
// whitespace, JSON.stringify string escaping, and only null, booleans,
// well-formed strings, safe integers, arrays and plain objects.
import { fail } from './errors.mjs';

export const LIMITS = Object.freeze({
  records: 10000,
  bundleBytes: 16 * 1024 * 1024,
  depth: 20,
  nodes: 200000, // every value and every object key visited counts as one
  string: 65536, // UTF-16 code units
  array: 10000,
  participants: 1000,
  title: 256,
  text: 8192,
  uri: 4096,
});

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Each UTF-16 half of a surrogate pair is two UTF-8 bytes, so a pair is four.
function utf8Length(str) {
  let n = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    n += c < 0x80 ? 1 : c < 0x800 || (c >= 0xd800 && c <= 0xdfff) ? 2 : 3;
  }
  return n;
}

function isPlain(value) {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Descriptors are read instead of values so getters are never invoked.
function dataValue(target, key) {
  const d = Object.getOwnPropertyDescriptor(target, key);
  if (!d || !d.enumerable || !('value' in d)) {
    fail('canonical', 'Only enumerable data properties are allowed');
  }
  return d.value;
}

export function canonicalize(value) {
  let nodes = 0;

  function walk(v, depth) {
    if (++nodes > LIMITS.nodes) fail('limits', `More than ${LIMITS.nodes} JSON values`);
    if (depth > LIMITS.depth) fail('limits', `Nesting deeper than ${LIMITS.depth}`);
    if (v === null || v === true || v === false) return String(v);
    switch (typeof v) {
      case 'string':
        if (v.length > LIMITS.string) fail('limits', `String longer than ${LIMITS.string} UTF-16 units`);
        if (!v.isWellFormed()) fail('canonical', 'String contains a lone surrogate');
        return JSON.stringify(v);
      case 'number':
        if (!Number.isSafeInteger(v)) fail('canonical', 'Only safe integers are allowed');
        if (Object.is(v, -0)) fail('canonical', 'Negative zero is not allowed');
        return String(v);
      case 'object':
        return Array.isArray(v) ? walkArray(v, depth) : walkObject(v, depth);
      default:
        return fail('canonical', `Unsupported JSON value of type ${typeof v}`);
    }
  }

  function walkArray(v, depth) {
    if (v.length > LIMITS.array) fail('limits', `Array longer than ${LIMITS.array}`);
    // Own keys of a dense, unadorned array are its indexes plus "length".
    if (Reflect.ownKeys(v).length !== v.length + 1) {
      fail('canonical', 'Sparse arrays and arrays with extra properties are not allowed');
    }
    const items = [];
    for (let i = 0; i < v.length; i++) items.push(walk(dataValue(v, String(i)), depth + 1));
    return `[${items.join(',')}]`;
  }

  function walkObject(v, depth) {
    if (!isPlain(v)) fail('canonical', 'Only plain objects are allowed');
    const keys = Reflect.ownKeys(v);
    for (const key of keys) {
      if (typeof key !== 'string') fail('canonical', 'Symbol keys are not allowed');
      if (FORBIDDEN_KEYS.has(key)) fail('canonical', `Forbidden object key: ${key}`);
    }
    keys.sort(byCodeUnits);
    const members = keys.map((key) => `${walk(key, depth + 1)}:${walk(dataValue(v, key), depth + 1)}`);
    return `{${members.join(',')}}`;
  }

  const text = walk(value, 0);
  if (utf8Length(text) > LIMITS.bundleBytes) {
    fail('limits', `Canonical JSON larger than ${LIMITS.bundleBytes} bytes`);
  }
  return text;
}
