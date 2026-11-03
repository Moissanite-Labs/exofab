// Field validators shared by the record verifier.
import { fail } from './errors.mjs';
import { LIMITS } from './canonical.mjs';

const HASH = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{3}Z$/;
// A scheme and a non-whitespace remainder. Not an allowlist: URIs are data.
const URI = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$/;

export const isHash = (x) => typeof x === 'string' && HASH.test(x);
export const isUuid = (x) => typeof x === 'string' && UUID.test(x);

export function isPlainObject(v) {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

export function exactFields(value, names, code, label) {
  if (!isPlainObject(value)) fail(code, `${label} must be an object`);
  const keys = Object.keys(value);
  if (keys.length !== names.length || !keys.every((k) => names.includes(k))) {
    fail(code, `${label} must have exactly the fields: ${names.join(', ')}`);
  }
}

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y, m) => (m === 2 ? (isLeap(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31);

// Exactly YYYY-MM-DDTHH:mm:ss.sssZ in UTC with a real calendar date (proleptic
// Gregorian, years 0000-9999) and no leap seconds or 24:00.
export function isCanonicalTime(x) {
  if (typeof x !== 'string') return false;
  const m = TIME.exec(x);
  if (!m) return false;
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number);
  return (
    month >= 1 && month <= 12 &&
    day >= 1 && day <= daysIn(year, month) &&
    hour <= 23 && minute <= 59 && second <= 59
  );
}

export function checkTime(x, label) {
  if (!isCanonicalTime(x)) fail('time', `${label} must be a canonical UTC timestamp (YYYY-MM-DDTHH:mm:ss.sssZ) on a real date`);
}

// Koinos text: a string with some non-whitespace (ECMAScript trim) within a
// UTF-16 length limit.
export function checkText(x, label, max) {
  if (typeof x !== 'string' || x.trim() === '') fail('field', `${label} must contain non-whitespace text`);
  if (x.length > max) fail('limits', `${label} exceeds ${max} UTF-16 code units`);
}

export function checkUri(x, label) {
  checkText(x, label, LIMITS.uri);
  if (!URI.test(x)) fail('field', `${label} must be a URI with a scheme and no whitespace`);
}

export function checkHash(x, label) {
  if (!isHash(x)) fail('field', `${label} must be lowercase SHA-256 hex`);
}
