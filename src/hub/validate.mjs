// Validators for hub requests. Text that can flow into Koinos records keeps
// to the Koinos limits (title 256, text 8192 UTF-16 code units); the hub also
// refuses control characters in single-line fields so names and titles
// display safely. Values are returned unchanged, never trimmed, so what a
// person typed is what is stored and signed.
import { LIMITS } from '../koinos/index.mjs';
import { isPlainObject } from '../koinos/fields.mjs';
import { invalid } from './errors.mjs';

export { isPlainObject };

const LINE_CONTROL = /[\u0000-\u001f\u007f]/;
const TEXT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/; // allows tab, LF, CR
const SKILL = /^[a-z0-9][a-z0-9+#.-]{0,47}$/;

export const TEXT_LIMITS = Object.freeze({
  name: LIMITS.title,
  title: LIMITS.title,
  line: LIMITS.title,
  text: LIMITS.text,
});

const quoted = (key) => JSON.stringify(String(key).slice(0, 64));

// Requires a plain object whose keys are all allowed and whose required keys are present.
export function fields(value, label, { allowed, required = [] }) {
  if (!isPlainObject(value)) throw invalid(`${label} must be a JSON object`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw invalid(`${label} has an unknown field ${quoted(key)}`);
  }
  for (const key of required) {
    if (value[key] === undefined) throw invalid(`${label} needs ${quoted(key)}`);
  }
  return value;
}

function textValue(value, label, max, control, optional) {
  if (typeof value !== 'string') throw invalid(`${label} must be text`);
  if (!value.isWellFormed()) throw invalid(`${label} contains an invalid character`);
  if (value === '' && optional) return value;
  if (value.trim() === '') throw invalid(`${label} must not be blank`);
  if (value.length > max) throw invalid(`${label} must be at most ${max} characters`);
  if (control.test(value)) throw invalid(`${label} contains a control character`);
  return value;
}

export const line = (value, label, { max = TEXT_LIMITS.line, optional = false } = {}) =>
  textValue(value, label, max, LINE_CONTROL, optional);

export const text = (value, label, { max = TEXT_LIMITS.text, optional = false } = {}) =>
  textValue(value, label, max, TEXT_CONTROL, optional);

export function bool(value, label) {
  if (typeof value !== 'boolean') throw invalid(`${label} must be true or false`);
  return value;
}

function list(value, label, max, item) {
  if (!Array.isArray(value)) throw invalid(`${label} must be a list`);
  if (value.length > max) throw invalid(`${label} may have at most ${max} entries`);
  const out = value.map((v) => item(v));
  if (new Set(out).size !== out.length) throw invalid(`${label} has a duplicate entry`);
  return out;
}

// Skills are lowercase tokens such as "exo-skills", "testing" or "node.js".
export function skills(value, label, { max = 30, min = 0 } = {}) {
  const out = list(value, label, max, (s) => {
    if (typeof s !== 'string' || !SKILL.test(s)) {
      throw invalid(`${label} must be lowercase tokens of letters, digits and + # . - (at most 48 characters)`);
    }
    return s;
  });
  if (out.length < min) throw invalid(`${label} needs at least ${min} ${min === 1 ? 'entry' : 'entries'}`);
  return out;
}

export const lines = (value, label, { max = 10 } = {}) => list(value, label, max, (s) => line(s, `Each entry of ${label}`));
