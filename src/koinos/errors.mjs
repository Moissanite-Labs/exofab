// Stable error codes let the hub, the command line, and tests branch on the
// kind of failure without parsing messages. Koinos itself has no codes; these
// are this implementation's own.
export const ERROR_CODES = Object.freeze([
  'format', // bundle shape, bundle format string, or byte encoding
  'canonical', // value cannot be represented as Koinos canonical JSON
  'limits', // a size, count, depth, or length limit is exceeded
  'envelope', // record fields or protocol string
  'field', // a body value has the wrong type or syntax
  'signature', // signature encoding or verification
  'id', // record id or key id malformed, small-order, or not matching content
  'chain', // sequence, previous link, or genesis position
  'project', // project id malformed or not the history's project
  'time', // timestamp format, calendar date, order, or expiry ordering
  'kind', // unsupported record kind
  'body', // body (or nested object) does not have exactly the expected fields
  'authority', // the signer may not make this statement
  'reference', // a referenced record or participant is unknown or of the wrong kind
  'state', // the referenced thing is not in a state that allows this record
  'pin', // expected head or project does not match
]);

const KNOWN = new Set(ERROR_CODES);

export class KoinosError extends Error {
  constructor(code, message, options = {}) {
    if (!KNOWN.has(code)) throw new TypeError(`Unknown Koinos error code: ${code}`);
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'KoinosError';
    this.code = code;
    // Position of the failing record in the verified history, when known.
    if (options.index !== undefined) this.index = options.index;
  }
}

export function fail(code, message, options) {
  throw new KoinosError(code, message, options);
}
