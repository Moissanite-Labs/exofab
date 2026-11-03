// SHA-256 and Ed25519 through WebCrypto (globalThis.crypto.subtle), so the same
// code runs in Node.js 22+ and modern browsers. Every function that touches
// WebCrypto is async.
import { fail } from './errors.mjs';
import { utf8, hex, fromHex, b64url, fromB64urlCanonical, base64, fromBase64Canonical } from './encoding.mjs';

export const KEY_PREFIX = 'koinos:ed25519:';
export const NI_PREFIX = 'ni:///sha-256;';
const ED25519 = { name: 'Ed25519' };

function subtle() {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('WebCrypto is unavailable (a browser needs a secure context)');
  return s;
}

export async function sha256Hex(input) {
  let bytes;
  if (typeof input === 'string') bytes = utf8(input);
  else if (input instanceof Uint8Array) bytes = input;
  else throw new TypeError('sha256Hex takes a string or a Uint8Array');
  return hex(new Uint8Array(await subtle().digest('SHA-256', bytes)));
}

// --- Key identities -------------------------------------------------------

const P = 2n ** 255n - 19n; // field prime
const L = 2n ** 252n + 27742317777372353535851937790883648493n; // group order
// y of the order-8 points (little-endian encoding 26e8958f...6d53fc05). The test
// suite checks that it solves d*y^4 + 2*y^2 - 1 = 0, the order-8 condition.
const ORDER8_Y = 0x5fc536d880238b13933c6d305acdfd5f098eff289f4c345b027b2c28f95e826n;
// A point and its negation share y, so these y values (mod p) cover all eight
// small-order points: identity (1), order 2 (p-1), order 4 (0), order 8.
const SMALL_ORDER_Y = new Set([0n, 1n, P - 1n, ORDER8_Y, P - ORDER8_Y]);

function littleEndian(bytes) {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]);
  return n;
}

// Small-order keys verify signatures made without any private key, in any of
// their encodings (sign bit set, or y written as y + p). WebCrypto does not
// reject them, so identities do.
export function isSmallOrderKey(bytes) {
  const y = littleEndian(bytes) & ((1n << 255n) - 1n);
  return SMALL_ORDER_Y.has(y % P);
}

export function idFromPublicKeyBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) fail('id', 'An Ed25519 public key is 32 bytes');
  if (isSmallOrderKey(bytes)) fail('id', 'Small-order Ed25519 public key');
  return KEY_PREFIX + b64url(bytes);
}

export function publicKeyBytesFromId(id) {
  if (typeof id !== 'string' || !id.startsWith(KEY_PREFIX)) fail('id', `Key id must start with ${KEY_PREFIX}`);
  let bytes;
  try {
    bytes = fromB64urlCanonical(id.slice(KEY_PREFIX.length), 32);
  } catch {
    fail('id', 'Key id must be canonical unpadded base64url of 32 bytes');
  }
  if (isSmallOrderKey(bytes)) fail('id', 'Small-order Ed25519 public key');
  return bytes;
}

export async function generateIdentity({ extractable = false } = {}) {
  const { publicKey, privateKey } = await subtle().generateKey(ED25519, extractable, ['sign', 'verify']);
  const raw = new Uint8Array(await subtle().exportKey('raw', publicKey));
  return { id: idFromPublicKeyBytes(raw), privateKey, publicKey };
}

// --- Signatures -------------------------------------------------------------

export async function signText(privateKey, text) {
  return b64url(new Uint8Array(await subtle().sign(ED25519, privateKey, utf8(text))));
}

// Imported verification keys, by id. Bounded so a long-running hub cannot grow it forever.
const verifyKeys = new Map();

function verifyingKey(id, bytes) {
  let key = verifyKeys.get(id);
  if (!key) {
    if (verifyKeys.size >= 4096) verifyKeys.clear();
    key = subtle().importKey('raw', bytes, ED25519, false, ['verify']);
    verifyKeys.set(id, key);
    key.catch(() => verifyKeys.delete(id));
  }
  return key;
}

// Returns false for any malformed id, signature or text; it never throws for
// bad input. Signatures must be canonical base64url of 64 bytes with S < L,
// which is checked here so the result does not depend on the platform.
export async function verifyText(id, text, signature) {
  try {
    const keyBytes = publicKeyBytesFromId(id);
    const sig = fromB64urlCanonical(signature, 64);
    if (littleEndian(sig.subarray(32)) >= L) return false;
    const message = utf8(text);
    return await subtle().verify(ED25519, await verifyingKey(id, keyBytes), sig, message);
  } catch {
    return false;
  }
}

// --- PKCS#8 PEM ---------------------------------------------------------------

const PEM = /^-----BEGIN PRIVATE KEY-----\r?\n((?:[A-Za-z0-9+/=]+\r?\n)+)-----END PRIVATE KEY-----\r?\n?$/;

// Some WebCrypto implementations ignore bytes after the key structure, so
// check that the outer DER SEQUENCE spans the decoded bytes exactly.
function isSingleDerSequence(der) {
  if (der.length < 2 || der[0] !== 0x30) return false;
  let length = der[1];
  let header = 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count < 1 || count > 2 || der.length < 2 + count) return false;
    length = 0;
    for (let i = 0; i < count; i++) length = (length << 8) | der[2 + i];
    header += count;
  }
  return header + length === der.length;
}

export async function exportPkcs8Pem(privateKey) {
  if (!privateKey?.extractable) throw new TypeError('Only an extractable private key can be exported');
  const der = new Uint8Array(await subtle().exportKey('pkcs8', privateKey));
  const body = base64(der).replace(/.{1,64}/g, '$&\n');
  der.fill(0);
  return `-----BEGIN PRIVATE KEY-----\n${body}-----END PRIVATE KEY-----\n`;
}

// WebCrypto cannot derive a public key from a private CryptoKey, so the key is
// first imported extractable to read the JWK "x" member, then re-imported with
// the requested extractability.
export async function identityFromPkcs8Pem(pem, { extractable = false } = {}) {
  const match = typeof pem === 'string' ? PEM.exec(pem) : null;
  if (!match) fail('format', 'Expected a PKCS#8 PEM private key');
  const der = fromBase64Canonical(match[1].replace(/\r?\n/g, ''));
  try {
    if (!isSingleDerSequence(der)) fail('format', 'PKCS#8 data has trailing or missing bytes');
    let privateKey;
    try {
      privateKey = await subtle().importKey('pkcs8', der, ED25519, true, ['sign']);
    } catch {
      fail('format', 'Expected an Ed25519 PKCS#8 private key');
    }
    const { x } = await subtle().exportKey('jwk', privateKey);
    const id = KEY_PREFIX + x;
    publicKeyBytesFromId(id);
    if (!extractable) privateKey = await subtle().importKey('pkcs8', der, ED25519, false, ['sign']);
    return { id, privateKey };
  } finally {
    der.fill(0);
  }
}

// --- RFC 6920 named-information URIs ------------------------------------------

export function niUri(hexDigest) {
  if (typeof hexDigest !== 'string' || !/^[0-9a-f]{64}$/.test(hexDigest)) {
    fail('field', 'Digest must be lowercase SHA-256 hex');
  }
  return NI_PREFIX + b64url(fromHex(hexDigest));
}

// Strict: no authority, no query parameters, canonical base64url of 32 bytes.
export function hexFromNiUri(uri) {
  if (typeof uri !== 'string' || !uri.startsWith(NI_PREFIX)) fail('field', `URI must start with ${NI_PREFIX}`);
  try {
    return hex(fromB64urlCanonical(uri.slice(NI_PREFIX.length), 32));
  } catch {
    fail('field', 'ni URI must carry canonical base64url of a 32-byte digest');
  }
}
