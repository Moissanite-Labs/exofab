// Byte and text encodings shared by Node.js and browsers. Only TextEncoder,
// TextDecoder, atob and btoa are used.
import { fail } from './errors.mjs';

const encoder = new TextEncoder();
// ignoreBOM keeps a leading U+FEFF so decoding is lossless.
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function requireBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Expected a Uint8Array');
}

// Strict: a lone surrogate would otherwise be replaced silently with U+FFFD.
export function utf8(str) {
  if (typeof str !== 'string') throw new TypeError('Expected a string');
  if (!str.isWellFormed()) fail('canonical', 'String contains a lone surrogate');
  return encoder.encode(str);
}

export function fromUtf8(bytes) {
  requireBytes(bytes);
  try {
    return decoder.decode(bytes);
  } catch {
    fail('format', 'Invalid UTF-8');
  }
}

export function utf16Length(str) {
  if (typeof str !== 'string') throw new TypeError('Expected a string');
  return str.length;
}

export function hex(bytes) {
  requireBytes(bytes);
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

// Lowercase only, so every byte string has exactly one accepted spelling.
export function fromHex(str) {
  if (typeof str !== 'string' || !/^(?:[0-9a-f]{2})*$/.test(str)) {
    fail('format', 'Expected lowercase hexadecimal with an even number of digits');
  }
  const bytes = new Uint8Array(str.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(str.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function binaryString(bytes) {
  let out = '';
  // Chunked so large inputs do not exceed the argument limit of fromCharCode.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return out;
}

export function base64(bytes) {
  requireBytes(bytes);
  return btoa(binaryString(bytes));
}

// Standard padded base64; rejects any spelling that would not re-encode identically.
export function fromBase64Canonical(str) {
  if (typeof str !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(str) || str.length % 4 !== 0) {
    fail('format', 'Invalid base64');
  }
  const bytes = Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
  if (base64(bytes) !== str) fail('format', 'Non-canonical base64');
  return bytes;
}

export function b64url(bytes) {
  return base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const b64urlLength = (n) => Math.floor(n / 3) * 4 + (n % 3 === 0 ? 0 : (n % 3) + 1);

// Unpadded base64url. Throws unless the text is the one canonical encoding of
// its bytes (no padding, no stray trailing bits) and, if given, of that length.
export function fromB64urlCanonical(str, expectedLen) {
  if (typeof str !== 'string' || !/^[A-Za-z0-9_-]*$/.test(str) || str.length % 4 === 1) {
    fail('format', 'Invalid base64url');
  }
  if (expectedLen !== undefined && str.length !== b64urlLength(expectedLen)) {
    fail('format', `Expected base64url of ${expectedLen} bytes`);
  }
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  if (b64url(bytes) !== str) fail('format', 'Non-canonical base64url');
  return bytes;
}
