// JSON helpers for reading Synbios exports, which are produced by Python.
//
// parseStrictJson accepts only what a Synbios bundle needs: duplicate keys,
// non-integer or unsafe numbers, lone surrogates, and deep nesting are
// refused instead of being silently resolved, so the parsed value is
// unambiguous. pythonCanonicalJson reproduces the form Synbios hashes:
// json.dumps(sort_keys=True, separators=(',', ':'), ensure_ascii=False).

export class StrictJsonError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StrictJsonError';
  }
}

const fail = (message) => {
  throw new StrictJsonError(message);
};

const WHITESPACE = /[ \t\n\r]*/y;
// Runs of plain characters are matched together so long strings do not
// need one regular-expression backtracking frame per character.
const STRING = /"(?:[^"\\\u0000-\u001f]+|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y;
const NUMBER = /-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/y;

export function parseStrictJson(text, { maxDepth = 64 } = {}) {
  if (typeof text !== 'string') fail('JSON input must be a string');
  let pos = 0;

  const match = (pattern) => {
    pattern.lastIndex = pos;
    const found = pattern.exec(text);
    if (found) pos = pattern.lastIndex;
    return found;
  };
  const skip = () => match(WHITESPACE);
  const expect = (char) => {
    skip();
    if (text[pos] !== char) fail(`Expected '${char}' at offset ${pos}`);
    pos++;
  };

  const string = () => {
    const token = match(STRING);
    if (!token) fail(`Invalid string at offset ${pos}`);
    const value = JSON.parse(token[0]);
    if (!value.isWellFormed()) fail('String contains a lone surrogate');
    return value;
  };

  const number = () => {
    const token = match(NUMBER);
    if (!token) fail(`Invalid JSON at offset ${pos}`);
    if (token[1] || token[2]) fail('Only integer numbers are supported');
    const value = Number(token[0]);
    if (!Number.isSafeInteger(value)) fail('Integer is outside the safe range');
    return value;
  };

  const object = (depth) => {
    pos++;
    const result = {};
    skip();
    if (text[pos] === '}') {
      pos++;
      return result;
    }
    for (;;) {
      skip();
      if (text[pos] !== '"') fail(`Expected object key at offset ${pos}`);
      const key = string();
      // Assigning __proto__ would change the prototype instead of adding a field.
      if (key === '__proto__') fail('Object key __proto__ is not allowed');
      if (Object.hasOwn(result, key)) fail(`Duplicate object key ${JSON.stringify(key.slice(0, 40))}`);
      expect(':');
      result[key] = value(depth);
      skip();
      if (text[pos] === ',') {
        pos++;
        continue;
      }
      expect('}');
      return result;
    }
  };

  const array = (depth) => {
    pos++;
    const result = [];
    skip();
    if (text[pos] === ']') {
      pos++;
      return result;
    }
    for (;;) {
      result.push(value(depth));
      skip();
      if (text[pos] === ',') {
        pos++;
        continue;
      }
      expect(']');
      return result;
    }
  };

  const value = (depth) => {
    if (depth >= maxDepth) fail('JSON is nested too deeply');
    skip();
    const char = text[pos];
    if (char === '{') return object(depth + 1);
    if (char === '[') return array(depth + 1);
    if (char === '"') return string();
    for (const [word, literal] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(word, pos)) {
        pos += word.length;
        return literal;
      }
    }
    return number();
  };

  const result = value(0);
  skip();
  if (pos !== text.length) fail(`Unexpected data after JSON value at offset ${pos}`);
  return result;
}

// Python orders str keys by code point; JavaScript's default sort compares
// UTF-16 code units, which differs for characters above U+FFFF.
function compareCodePoints(a, b) {
  const left = a[Symbol.iterator]();
  const right = b[Symbol.iterator]();
  for (;;) {
    const x = left.next();
    const y = right.next();
    if (x.done || y.done) return (x.done ? 0 : 1) - (y.done ? 0 : 1);
    const difference = x.value.codePointAt(0) - y.value.codePointAt(0);
    if (difference) return difference;
  }
}

export function pythonCanonicalJson(value) {
  if (value === null || typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) fail('Only safe integers can be canonicalized');
    return String(value);
  }
  if (typeof value === 'string') {
    if (!value.isWellFormed()) fail('String contains a lone surrogate');
    // For well-formed strings JSON.stringify escapes exactly what Python
    // escapes with ensure_ascii=False: quote, backslash, and C0 controls.
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(pythonCanonicalJson).join(',')}]`;
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const keys = Object.keys(value).sort(compareCodePoints);
    return `{${keys.map((key) => `${pythonCanonicalJson(key)}:${pythonCanonicalJson(value[key])}`).join(',')}}`;
  }
  return fail('Unsupported value for canonical JSON');
}
