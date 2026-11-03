// Strict, size-bounded JSON parser (RFC 8259) for untrusted input.
//
// Unlike JSON.parse it refuses duplicate object keys (compared after
// unescaping), a byte order mark, lone surrogates, numbers that do not fit a
// finite double, nesting beyond a depth limit, and input over a byte limit, so
// every accepted text has exactly one meaning. It returns plain objects,
// arrays, strings, numbers, booleans and null. Runs in Node.js and browsers.

export const DEFAULT_MAX_BYTES = 1024 * 1024;
export const DEFAULT_MAX_DEPTH = 64;
const DEPTH_CEILING = 1000; // keeps recursion well inside the call stack

// Codes: type, too_large, bom, encoding, syntax, duplicate, depth, number.
export class StrictJsonError extends Error {
  constructor(code, message, offset) {
    super(offset === undefined ? message : `${message} at offset ${offset}`);
    this.name = 'StrictJsonError';
    this.code = code;
    if (offset !== undefined) this.offset = offset;
  }
}

const fail = (code, message, offset) => {
  throw new StrictJsonError(code, message, offset);
};

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

// UTF-8 length of a well-formed string; each half of a surrogate pair counts two.
function utf8Length(str) {
  let n = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    n += c < 0x80 ? 1 : c < 0x800 || (c >= 0xd800 && c <= 0xdfff) ? 2 : 3;
  }
  return n;
}

function toText(input, maxBytes) {
  if (input instanceof Uint8Array) {
    if (input.length > maxBytes) fail('too_large', `JSON input is larger than ${maxBytes} bytes`);
    if (input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf) fail('bom', 'JSON input must not start with a byte order mark');
    try {
      return decoder.decode(input);
    } catch {
      return fail('encoding', 'JSON input is not valid UTF-8');
    }
  }
  if (typeof input !== 'string') fail('type', 'JSON input must be a string or a Uint8Array');
  // Every UTF-16 code unit is at least one UTF-8 byte, so this bounds the scan below.
  if (input.length > maxBytes) fail('too_large', `JSON input is larger than ${maxBytes} bytes`);
  if (!input.isWellFormed()) fail('encoding', 'JSON input contains a lone surrogate');
  if (utf8Length(input) > maxBytes) fail('too_large', `JSON input is larger than ${maxBytes} bytes`);
  if (input.charCodeAt(0) === 0xfeff) fail('bom', 'JSON input must not start with a byte order mark');
  return input;
}

const ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
const isDigit = (c) => c >= 0x30 && c <= 0x39;

export function parseStrictJson(input, { maxBytes = DEFAULT_MAX_BYTES, maxDepth = DEFAULT_MAX_DEPTH } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError('maxBytes must be a positive integer');
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || maxDepth > DEPTH_CEILING) {
    throw new TypeError(`maxDepth must be an integer from 0 to ${DEPTH_CEILING}`);
  }
  const text = toText(input, maxBytes);
  const end = text.length;
  let pos = 0;

  // RFC 8259 whitespace only: space, tab, line feed, carriage return.
  const skipSpace = () => {
    while (pos < end) {
      const c = text.charCodeAt(pos);
      if (c !== 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) break;
      pos++;
    }
  };

  const unexpected = () => (pos >= end ? fail('syntax', 'Unexpected end of JSON input') : fail('syntax', 'Unexpected character', pos));

  function value(depth) {
    skipSpace();
    switch (text[pos]) {
      case '{':
        return object(depth + 1);
      case '[':
        return array(depth + 1);
      case '"':
        return string();
      case 't':
        return literal('true', true);
      case 'f':
        return literal('false', false);
      case 'n':
        return literal('null', null);
      default:
        if (text[pos] === '-' || isDigit(text.charCodeAt(pos))) return number();
        return unexpected();
    }
  }

  function literal(word, result) {
    if (text.startsWith(word, pos)) {
      pos += word.length;
      return result;
    }
    return fail('syntax', 'Invalid literal', pos);
  }

  function number() {
    const start = pos;
    if (text[pos] === '-') pos++;
    if (text[pos] === '0') pos++;
    else if (isDigit(text.charCodeAt(pos))) while (isDigit(text.charCodeAt(pos))) pos++;
    else fail('syntax', 'Invalid number', start);
    if (text[pos] === '.') {
      pos++;
      if (!isDigit(text.charCodeAt(pos))) fail('syntax', 'Invalid number', start);
      while (isDigit(text.charCodeAt(pos))) pos++;
    }
    if (text[pos] === 'e' || text[pos] === 'E') {
      pos++;
      if (text[pos] === '+' || text[pos] === '-') pos++;
      if (!isDigit(text.charCodeAt(pos))) fail('syntax', 'Invalid number', start);
      while (isDigit(text.charCodeAt(pos))) pos++;
    }
    const n = Number(text.slice(start, pos));
    if (!Number.isFinite(n)) fail('number', 'Number is out of range', start);
    return n;
  }

  function string() {
    const start = pos;
    pos++; // opening quote
    let out = '';
    let run = pos;
    for (;;) {
      if (pos >= end) fail('syntax', 'Unterminated string', start);
      const c = text.charCodeAt(pos);
      if (c === 0x22) break;
      if (c < 0x20) fail('syntax', 'Unescaped control character in string', pos);
      if (c !== 0x5c) {
        pos++;
        continue;
      }
      out += text.slice(run, pos);
      const e = text[pos + 1];
      if (e === 'u') {
        const digits = text.slice(pos + 2, pos + 6);
        if (!/^[0-9A-Fa-f]{4}$/.test(digits)) fail('syntax', 'Invalid \\u escape', pos);
        out += String.fromCharCode(parseInt(digits, 16));
        pos += 6;
      } else if (e !== undefined && Object.hasOwn(ESCAPES, e)) {
        out += ESCAPES[e];
        pos += 2;
      } else {
        fail('syntax', 'Invalid escape', pos);
      }
      run = pos;
    }
    out += text.slice(run, pos);
    pos++; // closing quote
    // Escapes can spell a lone surrogate, which has no Unicode meaning.
    if (!out.isWellFormed()) fail('encoding', 'String contains a lone surrogate', start);
    return out;
  }

  function enter(depth) {
    if (depth > maxDepth) fail('depth', `Nesting deeper than ${maxDepth}`, pos);
    pos++; // opening bracket
    skipSpace();
  }

  // After a member or element: a comma (then more) or the closing bracket.
  function more(close) {
    skipSpace();
    if (text[pos] === ',') {
      pos++;
      return true;
    }
    if (text[pos] === close) {
      pos++;
      return false;
    }
    return unexpected();
  }

  function array(depth) {
    enter(depth);
    const out = [];
    if (text[pos] === ']') {
      pos++;
      return out;
    }
    do out.push(value(depth));
    while (more(']'));
    return out;
  }

  function object(depth) {
    enter(depth);
    const out = {};
    const seen = new Set();
    if (text[pos] === '}') {
      pos++;
      return out;
    }
    do {
      skipSpace();
      if (text[pos] !== '"') unexpected();
      const keyAt = pos;
      const key = string();
      if (seen.has(key)) fail('duplicate', `Duplicate object key ${JSON.stringify(key.slice(0, 64))}`, keyAt);
      seen.add(key);
      skipSpace();
      if (text[pos] !== ':') unexpected();
      pos++;
      // defineProperty keeps "__proto__" an ordinary own key, as JSON.parse does.
      Object.defineProperty(out, key, { value: value(depth), writable: true, enumerable: true, configurable: true });
    } while (more('}'));
    return out;
  }

  const result = value(0);
  skipSpace();
  if (pos < end) fail('syntax', 'Unexpected data after the JSON value', pos);
  return result;
}
