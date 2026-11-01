// Errors the hub returns to callers. The HTTP layer sends
// {"error": {code, message, ...details}} with `status`.
import { KoinosError } from '../koinos/index.mjs';

export const HUB_ERROR_STATUS = Object.freeze({
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  too_large: 413,
  invalid: 422,
  koinos: 422,
});

// Extra fields a HubError may carry: head and sequence on a conflict (the
// client rebuilds the record on that head), koinosCode on a Koinos refusal.
const DETAILS = ['head', 'sequence', 'koinosCode'];

export class HubError extends Error {
  constructor(code, message, details = {}) {
    if (!Object.hasOwn(HUB_ERROR_STATUS, code)) throw new TypeError(`Unknown hub error code: ${code}`);
    super(message);
    this.name = 'HubError';
    this.code = code;
    this.status = HUB_ERROR_STATUS[code];
    for (const key of DETAILS) if (details[key] !== undefined) this[key] = details[key];
  }

  toJSON() {
    const out = { code: this.code, message: this.message };
    for (const key of DETAILS) if (this[key] !== undefined) out[key] = this[key];
    return out;
  }
}

export const unauthenticated = (message = 'Sign in first') => new HubError('unauthenticated', message);
export const forbidden = (message) => new HubError('forbidden', message);
export const notFound = (message) => new HubError('not_found', message);
export const conflict = (message, details) => new HubError('conflict', message, details);
export const invalid = (message) => new HubError('invalid', message);
export const tooLarge = (message) => new HubError('too_large', message);

// A Koinos refusal of a submitted record or bundle; other errors pass through.
export function fromKoinos(error) {
  if (!(error instanceof KoinosError)) return error;
  return new HubError('koinos', error.message, { koinosCode: error.code });
}
