// Tests for the independent Koinos 0.1 implementation in src/koinos.
// Synthetic identities only: people Ada and Ben, agents scribe and helper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import {
  KoinosError,
  ERROR_CODES,
  LIMITS,
  PROTOCOL,
  BUNDLE_FORMAT,
  KINDS,
  KEY_PREFIX,
  utf8,
  fromUtf8,
  utf16Length,
  hex,
  fromHex,
  b64url,
  fromB64urlCanonical,
  canonicalize,
  isCanonicalTime,
  sha256Hex,
  isSmallOrderKey,
  idFromPublicKeyBytes,
  publicKeyBytesFromId,
  generateIdentity,
  signText,
  verifyText,
  exportPkcs8Pem,
  identityFromPkcs8Pem,
  niUri,
  hexFromNiUri,
  recordId,
  signingText,
  nextFields,
  draftRecord,
  signDraft,
  checkDraft,
  createRecord,
  verifyRecords,
  verifyBundle,
  verifyAppend,
  createBundle,
} from '../src/koinos/index.mjs';

// --- Fixtures ---------------------------------------------------------------

const keys = {
  ada: await generateIdentity(),
  ben: await generateIdentity(),
  scribe: await generateIdentity(),
  helper: await generateIdentity(),
  outsider: await generateIdentity(),
};
const id = (who) => keys[who].id;

const CHARTER = 'Charter: scope, acceptance criteria, how credit is recorded. Creates no economic right.\n';
const ARTIFACT = 'Synthetic artifact bytes for the recipe scaler.\n';
const TERMS = await sha256Hex(CHARTER);
const ART = await sha256Hex(ARTIFACT);
const SCOPE = ['contribution.submit'];
const EXPIRES = '2026-11-12T00:00:00.000Z';
const BASE = Date.UTC(2026, 9, 29);
const OTHER_PROJECT = '0b5d7a3e-2f4c-4d1a-9e8b-7c6d5e4f3a2b';

const people = {
  ada: { id: id('ada'), name: 'Ada', kind: 'human' },
  ben: { id: id('ben'), name: 'Ben', kind: 'human' },
  scribe: { id: id('scribe'), name: 'scribe', kind: 'agent' },
  helper: { id: id('helper'), name: 'helper', kind: 'agent' },
};

function genesisBody(names = ['ada', 'ben', 'scribe', 'helper']) {
  return {
    title: 'Recipe scaler',
    description: 'Synthetic first-slice project.',
    participants: names.map((n) => people[n]),
  };
}

const grantBody = (agreement, extra = {}) => ({ agent: id('scribe'), agreement, scope: [...SCOPE], expires: EXPIRES, ...extra });
const submitBody = (agreement, delegation = null, extra = {}) => ({
  title: 'Scaling module',
  summary: 'Scales ingredient quantities; tests included in the artifact.',
  artifact: { uri: niUri(ART), digest: ART },
  agreement,
  delegation,
  ...extra,
});
const reviewBody = (contribution, decision = 'approve', note = 'Checked the exact artifact bytes.') => ({ contribution, decision, note });

// Builds a history through createRecord, one second per record.
class Story {
  records = [];
  tick = 0;

  nextTime() {
    return new Date(BASE + 1000 * this.tick++).toISOString();
  }

  async add(who, kind, body, { time, project } = {}) {
    const record = await createRecord({ records: this.records, identity: keys[who], kind, body, time: time ?? this.nextTime(), project });
    this.records.push(record);
    return record;
  }
}

async function setup({ parties = ['ada', 'ben'], consent = true, grant = true, names } = {}) {
  const s = new Story();
  await s.add('ada', 'project.created', genesisBody(names));
  s.agreement = (await s.add('ada', 'agreement.proposed', { title: 'Charter', uri: niUri(TERMS), digest: TERMS, parties: parties.map(id) })).id;
  if (consent) for (const p of parties) await s.add(p, 'agreement.consented', { agreement: s.agreement });
  if (grant) s.delegation = (await s.add('ben', 'delegation.granted', grantBody(s.agreement))).id;
  return s;
}

// Signs an arbitrary envelope without any rule checks, to build invalid records.
async function forge(records, who, fields = {}) {
  const next = nextFields(records);
  const unsigned = {
    protocol: PROTOCOL,
    project: next.project,
    sequence: next.sequence,
    previous: next.previous,
    time: next.minTime,
    actor: id(who),
    kind: 'agreement.consented',
    body: {},
    ...fields,
  };
  const recId = await recordId(unsigned);
  return { ...unsigned, id: recId, signature: await signText(keys[who].privateKey, signingText(recId)) };
}

function rejects(promise, code) {
  return assert.rejects(promise, (error) => {
    assert.ok(error instanceof KoinosError, `expected KoinosError, got ${error}`);
    assert.equal(error.code, code, error.message);
    return true;
  });
}

function throwsCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof KoinosError, `expected KoinosError, got ${error}`);
    assert.equal(error.code, code, error.message);
    return true;
  });
}

const leInt = (bytes) => bytes.reduceRight((n, b) => (n << 8n) | BigInt(b), 0n);
const leBytes = (n, len) => Uint8Array.from({ length: len }, (_, i) => Number((n >> BigInt(8 * i)) & 0xffn));
const keyIdOf = (bytes) => KEY_PREFIX + b64url(bytes);

// --- Encodings -----------------------------------------------------------------

test('utf8 and fromUtf8 are strict, lossless and count UTF-16 units', () => {
  const text = 'café \u{1F35E}   ﻿';
  assert.equal(fromUtf8(utf8(text)), text);
  assert.equal(fromUtf8(Uint8Array.of(0xef, 0xbb, 0xbf, 0x61)), '﻿a');
  assert.equal(utf16Length('\u{1F35E}'), 2);
  throwsCode(() => fromUtf8(Uint8Array.of(0xff)), 'format');
  throwsCode(() => fromUtf8(Uint8Array.of(0xc0, 0x80)), 'format');
  throwsCode(() => utf8('\ud800'), 'canonical');
});

test('hex is lowercase and fromHex accepts only lowercase pairs', () => {
  assert.equal(hex(Uint8Array.of(0, 255, 16)), '00ff10');
  assert.deepEqual(fromHex('00ff10'), Uint8Array.of(0, 255, 16));
  for (const bad of ['ABCD', 'abc', 'zz', ' 00', 7]) throwsCode(() => fromHex(bad), 'format');
});

test('base64url is unpadded and decoding accepts only the canonical spelling', () => {
  assert.equal(b64url(Uint8Array.of(0xfb, 0xff)), '-_8');
  assert.deepEqual(fromB64urlCanonical('-_8', 2), Uint8Array.of(0xfb, 0xff));
  for (const bad of ['-_8=', '+/8', '-_9', 'A', '-_8 ', null]) throwsCode(() => fromB64urlCanonical(bad), 'format');
  throwsCode(() => fromB64urlCanonical('-_8', 3), 'format');
});

// --- Canonical JSON ---------------------------------------------------------------

test('canonicalize sorts keys by UTF-16 code units and keeps array order', () => {
  // U+FFFF sorts after U+1F600 in UTF-16 order (0xFFFF > 0xD83D), unlike code point order.
  assert.equal(
    canonicalize({ '￿': 1, '\u{1F600}': 2, b: 3, a: 4, B: 5, '': 6 }),
    '{"":6,"B":5,"a":4,"b":3,"\u{1F600}":2,"￿":1}',
  );
  assert.equal(canonicalize({ z: [3, 1, 2], a: { y: null, x: true } }), '{"a":{"x":true,"y":null},"z":[3,1,2]}');
  const bare = Object.create(null);
  bare.k = false;
  assert.equal(canonicalize(bare), '{"k":false}');
});

test('canonicalize escapes like JSON.stringify and keeps U+2028, emoji and non-ASCII raw', () => {
  const input = [' ', ' ', '\u{1F600}', 'é', '"\\', '\n\t\u0001\u001f', '\u007f', '﻿'];
  const expected = '[" "," ","\u{1F600}","é","\\"\\\\","\\n\\t\\u0001\\u001f","\u007f","﻿"]';
  assert.equal(canonicalize(input), expected);
  assert.equal(canonicalize([0, -1, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, true, false, null]), '[0,-1,9007199254740991,-9007199254740991,true,false,null]');
});

test('canonicalize rejects values Koinos cannot represent', () => {
  class Thing {}
  const getter = Object.defineProperty({}, 'x', { get() { throw new Error('getter ran'); }, enumerable: true });
  const hidden = Object.defineProperty({ a: 1 }, 'b', { value: 2, enumerable: false });
  const symbolKey = { [Symbol('s')]: 1 };
  const extraArray = [1];
  extraArray.extra = 2;
  const accessorArray = [1];
  Object.defineProperty(accessorArray, '0', { get() { throw new Error('getter ran'); }, enumerable: true });
  for (const value of [
    -0, 1.5, NaN, Infinity, -Infinity, 2 ** 53, undefined, () => 1, Symbol('x'), 1n,
    new Date(0), new Map(), new Thing(), Object.create({}), '\ud800', 'a\udc00b', { x: undefined }, [undefined],
    JSON.parse('{"__proto__":1}'), { constructor: 1 }, { prototype: 1 }, new Array(2), extraArray, accessorArray,
    getter, hidden, symbolKey, { nested: { deeper: [1, -0] } },
  ]) {
    throwsCode(() => canonicalize(value), 'canonical');
  }
});

test('canonicalize enforces the depth limit of 20', () => {
  const nest = (n) => {
    let v = null;
    for (let i = 0; i < n; i++) v = [v];
    return v;
  };
  assert.equal(canonicalize(nest(20)).length, 44);
  throwsCode(() => canonicalize(nest(21)), 'limits');
  let deep = null;
  for (let i = 0; i < 21; i++) deep = { deep };
  throwsCode(() => canonicalize(deep), 'limits');
});

test('canonicalize enforces string and array length limits at their boundaries', () => {
  assert.ok(canonicalize('x'.repeat(LIMITS.string)));
  throwsCode(() => canonicalize('x'.repeat(LIMITS.string + 1)), 'limits');
  throwsCode(() => canonicalize({ ['k'.repeat(LIMITS.string + 1)]: 1 }), 'limits');
  assert.ok(canonicalize(new Array(LIMITS.array).fill(0)));
  throwsCode(() => canonicalize(new Array(LIMITS.array + 1).fill(0)), 'limits');
});

test('canonicalize counts every value and key toward the 200000 node limit', () => {
  // 1 root + 20 arrays of (1 + 9998 nulls) + 19 nulls = 200000 nodes.
  const atLimit = [...Array.from({ length: 20 }, () => new Array(9998).fill(null)), ...new Array(19).fill(null)];
  assert.ok(canonicalize(atLimit));
  throwsCode(() => canonicalize([...atLimit, null]), 'limits');
  // An object with n keys is 1 + 2n nodes: keys count too.
  const withKeys = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, null]));
  assert.ok(canonicalize(withKeys(99999)));
  throwsCode(() => canonicalize(withKeys(100000)), 'limits');
});

test('canonicalize enforces the 16 MiB UTF-8 byte limit', () => {
  const emoji = '\u{1F600}'.repeat(LIMITS.string / 2); // 65536 units, 131072 bytes
  assert.ok(canonicalize(new Array(127).fill(emoji)));
  throwsCode(() => canonicalize(new Array(128).fill(emoji)), 'limits');
});

test('LIMITS and constants match Koinos 0.1', () => {
  assert.deepEqual({ ...LIMITS }, {
    records: 10000, bundleBytes: 16777216, depth: 20, nodes: 200000, string: 65536,
    array: 10000, participants: 1000, title: 256, text: 8192, uri: 4096,
  });
  assert.ok(Object.isFrozen(LIMITS));
  assert.equal(PROTOCOL, 'koinos/0.1');
  assert.equal(BUNDLE_FORMAT, 'koinos-bundle/0.1');
  assert.equal(KINDS.length, 10);
  assert.equal(ERROR_CODES.length, 16);
  assert.throws(() => new KoinosError('nope', 'x'), TypeError);
});

// --- Timestamps ---------------------------------------------------------------

test('timestamps must be exactly YYYY-MM-DDTHH:mm:ss.sssZ on a real date', () => {
  for (const ok of [
    '2026-10-29T00:00:00.000Z', '2028-02-29T23:59:59.999Z', '2000-02-29T12:00:00.000Z', '0000-02-29T00:00:00.000Z',
    '9999-12-31T23:59:59.999Z', '2026-04-30T00:00:00.000Z',
  ]) assert.ok(isCanonicalTime(ok), ok);
  for (const bad of [
    '2026-10-29T00:00:00Z', '2026-10-29T00:00:00.000+00:00', '2026-10-29T00:00:00.000z', '2026-10-29 00:00:00.000Z',
    '2026-02-30T00:00:00.000Z', '2026-13-01T00:00:00.000Z', '2026-00-10T00:00:00.000Z', '2026-04-31T00:00:00.000Z',
    '2100-02-29T00:00:00.000Z', '2026-01-01T24:00:00.000Z', '2026-12-31T23:59:60.000Z', '2026-01-01T00:60:00.000Z',
    '+002026-01-01T00:00:00.000Z', '2026-1-01T00:00:00.000Z', '２026-01-01T00:00:00.000Z', 1, null,
  ]) assert.ok(!isCanonicalTime(bad), String(bad));
});

test('timestamp validation agrees with a Date round trip on generated inputs', () => {
  const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
  const pad = (n, w) => String(n).padStart(w, '0');
  for (let i = 0; i < 20000; i++) {
    const s = `${pad(pick([0, 1, 1900, 2000, 2024, 2026, 2100, 9999, Math.floor(Math.random() * 10000)]), 4)}-` +
      `${pad(pick([0, 1, 2, 4, 6, 9, 11, 12, 13, 99]), 2)}-${pad(pick([0, 1, 28, 29, 30, 31, 32]), 2)}T` +
      `${pad(pick([0, 12, 23, 24, 99]), 2)}:${pad(pick([0, 59, 60]), 2)}:${pad(pick([0, 59, 60, 61]), 2)}.${pad(pick([0, 999]), 3)}Z`;
    const viaDate = Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s;
    assert.equal(isCanonicalTime(s), viaDate, s);
  }
});

// --- Hashes, keys and signatures ----------------------------------------------------

test('sha256Hex matches FIPS 180-2 vectors for strings and bytes', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(await sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(await sha256Hex(utf8('abc')), await sha256Hex('abc'));
  await assert.rejects(sha256Hex(42), TypeError);
});

test('key ids round-trip and reject every non-canonical spelling', async () => {
  const { id: keyId, privateKey, publicKey } = await generateIdentity();
  assert.equal(privateKey.extractable, false);
  assert.match(keyId, /^koinos:ed25519:[A-Za-z0-9_-]{43}$/);
  const bytes = publicKeyBytesFromId(keyId);
  assert.equal(bytes.length, 32);
  assert.deepEqual(new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', publicKey)), bytes);
  assert.equal(idFromPublicKeyBytes(bytes), keyId);
  const body = keyId.slice(KEY_PREFIX.length);
  const last = body.at(-1);
  // The last character carries 2 unused bits; flipping one gives a non-canonical spelling.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const noncanonical = alphabet[alphabet.indexOf(last) ^ 1];
  for (const bad of [
    `koinos:ed448:${body}`, `KOINOS:ED25519:${body}`, keyId.slice(0, -1), `${keyId}A`, `${keyId}=`,
    KEY_PREFIX + body.slice(0, -1) + noncanonical, KEY_PREFIX + body.replace(/[-_]/g, '+'), body, null,
  ]) {
    if (bad === KEY_PREFIX + body.replace(/[-_]/g, '+') && !/[-_]/.test(body)) continue;
    throwsCode(() => publicKeyBytesFromId(bad), 'id');
  }
  throwsCode(() => idFromPublicKeyBytes(bytes.subarray(1)), 'id');
});

const P = 2n ** 255n - 19n;
const SMALL_ORDER_CANONICAL = [
  '0100000000000000000000000000000000000000000000000000000000000000', // identity, order 1
  'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f', // order 2
  '0000000000000000000000000000000000000000000000000000000000000000', // order 4
  '0000000000000000000000000000000000000000000000000000000000000080', // order 4
  '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05', // order 8
  '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85', // order 8
  'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a', // order 8
  'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa', // order 8
];

test('the order-8 key encodings solve the order-8 curve equation', () => {
  const mod = (a) => ((a % P) + P) % P;
  const pow = (b, e) => {
    let r = 1n;
    for (b = mod(b); e > 0n; e >>= 1n, b = mod(b * b)) if (e & 1n) r = mod(r * b);
    return r;
  };
  const d = mod(-121665n * pow(121666n, P - 2n));
  // Doubling an order-8 point gives an order-4 point (y = 0), so d*y^4 + 2*y^2 - 1 = 0.
  for (const h of SMALL_ORDER_CANONICAL.slice(4)) {
    const y = leInt(fromHex(h)) & ((1n << 255n) - 1n);
    assert.equal(mod(d * y ** 4n + 2n * y ** 2n - 1n), 0n, h);
  }
});

test('small-order public keys are rejected in every encoding', async () => {
  const encodings = [...SMALL_ORDER_CANONICAL];
  // Non-canonical spellings of the same points: sign bit set, or y written as y + p.
  encodings.push(
    '0100000000000000000000000000000000000000000000000000000000000080',
    'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    hex(leBytes(P, 32)),
    hex(leBytes(P + 1n, 32)),
    hex(leBytes(P + 1n + (1n << 255n), 32)),
  );
  for (const h of encodings) {
    const bytes = fromHex(h);
    assert.ok(isSmallOrderKey(bytes), h);
    throwsCode(() => publicKeyBytesFromId(keyIdOf(bytes)), 'id');
    throwsCode(() => idFromPublicKeyBytes(bytes), 'id');
  }
  assert.ok(!isSmallOrderKey(publicKeyBytesFromId(id('ada'))));
  assert.ok(!isSmallOrderKey(leBytes(P + 2n, 32)));
});

test('a small-order key forgery is refused although it needs no private key', async (t) => {
  // With A = identity, R = identity and S = 0, the Ed25519 equation holds for any message.
  const forgedKey = Uint8Array.of(1, ...new Uint8Array(31));
  const forgedSig = Uint8Array.of(1, ...new Uint8Array(63));
  const message = signingText('a'.repeat(64));
  assert.equal(await verifyText(keyIdOf(forgedKey), message, b64url(forgedSig)), false);
  const subtle = globalThis.crypto.subtle;
  const raw = await subtle.importKey('raw', forgedKey, { name: 'Ed25519' }, false, ['verify'])
    .then((k) => subtle.verify({ name: 'Ed25519' }, k, forgedSig, utf8(message)))
    .catch(() => 'import refused');
  t.diagnostic(`WebCrypto on this platform, without the id check, returns: ${raw}`);
});

test('signText and verifyText sign and verify the exact text', async () => {
  const sig = await signText(keys.ada.privateKey, 'koinos/0.1\nabc');
  assert.match(sig, /^[A-Za-z0-9_-]{86}$/);
  assert.equal(await verifyText(id('ada'), 'koinos/0.1\nabc', sig), true);
  assert.equal(await verifyText(id('ada'), 'koinos/0.1\nabd', sig), false);
  assert.equal(await verifyText(id('ben'), 'koinos/0.1\nabc', sig), false);
  assert.equal(await verifyText('not a key', 'koinos/0.1\nabc', sig), false);
  assert.equal(await verifyText(id('ada'), '\ud800', sig), false);
});

test('verifyText refuses non-canonical signature encodings and scalars', async () => {
  const text = 'exofab test';
  const sig = await signText(keys.ben.privateKey, text);
  const bytes = fromB64urlCanonical(sig, 64);
  const L = 2n ** 252n + 27742317777372353535851937790883648493n;
  const malleable = Uint8Array.of(...bytes.subarray(0, 32), ...leBytes(leInt(bytes.subarray(32)) + L, 32));
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const trailing = sig.slice(0, -1) + alphabet[alphabet.indexOf(sig.at(-1)) ^ 1];
  for (const bad of [b64url(malleable), `${sig}==`, trailing, sig.slice(0, -2), `${sig}AA`, sig.replace(/-/g, '+'), 7]) {
    if (bad === sig) continue;
    assert.equal(await verifyText(id('ben'), text, bad), false, String(bad));
  }
  assert.equal(await verifyText(id('ben'), text, sig), true);
});

test('PKCS#8 PEM round trip keeps the id and the ability to sign', async () => {
  const original = await generateIdentity({ extractable: true });
  const pem = await exportPkcs8Pem(original.privateKey);
  assert.match(pem, /^-----BEGIN PRIVATE KEY-----\n[A-Za-z0-9+/=]{1,64}\n-----END PRIVATE KEY-----\n$/);
  const restored = await identityFromPkcs8Pem(pem);
  assert.equal(restored.id, original.id);
  assert.equal(restored.privateKey.extractable, false);
  const sig = await signText(restored.privateKey, 'round trip');
  assert.equal(await verifyText(original.id, 'round trip', sig), true);
  const extractable = await identityFromPkcs8Pem(pem.replace(/\n/g, '\r\n'), { extractable: true });
  assert.equal(extractable.id, original.id);
  assert.equal(extractable.privateKey.extractable, true);
  assert.equal(await exportPkcs8Pem(extractable.privateKey), pem);
  await assert.rejects(exportPkcs8Pem(keys.ada.privateKey), TypeError);
});

test('a PKCS#8 PEM written by node:crypto imports with the matching id', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = new Uint8Array(publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));
  const restored = await identityFromPkcs8Pem(privateKey.export({ format: 'pem', type: 'pkcs8' }));
  assert.equal(restored.id, idFromPublicKeyBytes(raw));
});

test('identityFromPkcs8Pem rejects malformed PEM and non-Ed25519 keys', async () => {
  const { privateKey } = await globalThis.crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const der = new Uint8Array(await globalThis.crypto.subtle.exportKey('pkcs8', privateKey));
  const ecPem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der)).replace(/.{1,64}/g, '$&\n')}-----END PRIVATE KEY-----\n`;
  const good = await exportPkcs8Pem((await generateIdentity({ extractable: true })).privateKey);
  for (const bad of [
    ecPem,
    good.replace('PRIVATE KEY', 'PUBLIC KEY'),
    good.replace(/\n[A-Za-z0-9+/]/, '\n!'),
    good.replace('-----END', 'junk\n-----END'),
    good.replace(/[A-Za-z0-9+/=]{4}\n-----END/, '\n-----END'),
    '',
    null,
  ]) await rejects(identityFromPkcs8Pem(bad), 'format');
});

test('ni URIs carry an RFC 6920 sha-256 digest and parse strictly', async () => {
  const digest = await sha256Hex('abc');
  const uri = niUri(digest);
  assert.equal(uri, 'ni:///sha-256;ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
  assert.equal(hexFromNiUri(uri), digest);
  for (const bad of [
    'ni://example.org/sha-256;ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0',
    `${uri}?ct=text/plain`,
    uri.replace('sha-256', 'sha-512'),
    `${uri}=`,
    uri.slice(0, -1),
    uri.slice(0, -1) + '1',
    `NI:///sha-256;${uri.slice(14)}`,
  ]) throwsCode(() => hexFromNiUri(bad), 'field');
  throwsCode(() => niUri(digest.toUpperCase()), 'field');
  throwsCode(() => niUri(digest.slice(2)), 'field');
});

// --- Lifecycle and API ----------------------------------------------------------

test('a signed eight-record lifecycle derives exactly the Koinos state', async () => {
  const s = new Story();
  const g = await s.add('ada', 'project.created', {
    title: 'Recipe scaler \u{1F35E}',
    description: 'Synthetic project: café bakers   scale recipes.',
    participants: [people.ada, people.ben, people.scribe],
  });
  const a = await s.add('ada', 'agreement.proposed', { title: 'Charter', uri: niUri(TERMS), digest: TERMS, parties: [id('ada'), id('ben')] });
  await s.add('ada', 'agreement.consented', { agreement: a.id });
  await s.add('ben', 'agreement.consented', { agreement: a.id });
  const d = await s.add('ben', 'delegation.granted', grantBody(a.id));
  const c = await s.add('scribe', 'contribution.submitted', submitBody(a.id, d.id));
  const r = await s.add('ada', 'contribution.reviewed', reviewBody(c.id, 'approve', 'Tests pass ✓'));
  const acc = await s.add('ada', 'contribution.accepted', { contribution: c.id, review: r.id });
  const state = await verifyBundle(await createBundle(s.records));
  assert.deepStrictEqual(state, {
    project: { id: g.project, title: 'Recipe scaler \u{1F35E}', description: 'Synthetic project: café bakers   scale recipes.', steward: id('ada') },
    participants: [people.ada, people.ben, people.scribe],
    agreements: [{ id: a.id, title: 'Charter', uri: niUri(TERMS), digest: TERMS, parties: [id('ada'), id('ben')], consents: [id('ada'), id('ben')] }],
    delegations: [{ id: d.id, agent: id('scribe'), agreement: a.id, scope: SCOPE, expires: EXPIRES, principal: id('ben'), revoked: false }],
    contributions: [{
      id: c.id,
      title: 'Scaling module',
      summary: 'Scales ingredient quantities; tests included in the artifact.',
      artifact: { uri: niUri(ART), digest: ART },
      agreement: a.id,
      delegation: d.id,
      actor: id('scribe'),
      principal: id('ben'),
      status: 'accepted',
      reviews: [{ id: r.id, actor: id('ada'), decision: 'approve', note: 'Tests pass ✓' }],
      acceptance: { id: acc.id, actor: id('ada'), review: r.id },
      dispute: null,
    }],
    head: acc.id,
    count: 8,
  });
  assert.deepEqual(s.records.map((x) => x.sequence), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.ok(s.records.every((x, i) => x.previous === (i ? s.records[i - 1].id : null)));
});

test('createBundle returns a verified, detached, canonical copy', async () => {
  const s = await setup();
  const bundle = await createBundle(s.records);
  assert.deepEqual(Object.keys(bundle), ['format', 'records']);
  assert.deepEqual(Object.keys(bundle.records[0]), [...Object.keys(bundle.records[0])].sort());
  bundle.records[0].body.title = 'changed';
  assert.notEqual(s.records[0].body.title, 'changed');
  await rejects(createBundle([...s.records, s.records[1]]), 'chain');
});

test('draftRecord fills the envelope from the history and signDraft refuses altered drafts', async () => {
  const s = await setup();
  const draft = await draftRecord({ records: s.records, actor: id('ben'), kind: 'agreement.withdrawn', body: { agreement: s.agreement, reason: 'Pausing' }, time: s.nextTime() });
  const next = nextFields(s.records);
  assert.equal(draft.sequence, next.sequence);
  assert.equal(draft.previous, s.records.at(-1).id);
  assert.equal(draft.project, s.records[0].project);
  assert.equal(draft.id, await recordId(draft));
  assert.equal('signature' in draft, false);
  const record = await signDraft(draft, keys.ben.privateKey);
  const state = await verifyAppend(s.records, record);
  assert.deepEqual(state.agreements[0].consents, [id('ada')]);
  await rejects(signDraft({ ...draft, body: { ...draft.body, reason: 'Changed' } }, keys.ben.privateKey), 'id');
  await rejects(signDraft({ ...draft, extra: 1 }, keys.ben.privateKey), 'envelope');
  await rejects(draftRecord({ records: s.records, actor: id('ben'), kind: 'agreement.consented', body: {}, project: OTHER_PROJECT }), 'project');
});

test('draftRecord defaults: a fresh v4 project id at genesis and a time never before the last record', async () => {
  const genesis = await draftRecord({ records: [], actor: id('ada'), kind: 'project.created', body: genesisBody() });
  assert.match(genesis.project, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.ok(isCanonicalTime(genesis.time));
  assert.equal(genesis.sequence, 0);
  assert.equal(genesis.previous, null);
  const future = new Story();
  await future.add('ada', 'project.created', genesisBody(), { time: '2099-01-01T00:00:00.000Z' });
  const next = await draftRecord({ records: future.records, actor: id('ada'), kind: 'agreement.proposed', body: {} });
  assert.equal(next.time, '2099-01-01T00:00:00.000Z');
  const now = await draftRecord({ records: (await setup()).records, actor: id('ada'), kind: 'agreement.proposed', body: {} });
  assert.ok(now.time >= '2026-10-31T00:00:00.000Z');
});

test('checkDraft applies every rule except the signature before anyone signs', async () => {
  const s = await setup();
  const fine = await draftRecord({ records: s.records, actor: id('scribe'), kind: 'contribution.submitted', body: submitBody(s.agreement, s.delegation), time: s.nextTime() });
  const state = await checkDraft(s.records, fine);
  assert.equal(state.contributions[0].status, 'submitted');
  const bad = await draftRecord({ records: s.records, actor: id('ben'), kind: 'agreement.proposed', body: { title: 'Mine', uri: niUri(TERMS), digest: TERMS, parties: [id('ben')] }, time: s.nextTime() });
  await rejects(checkDraft(s.records, bad), 'authority');
  await rejects(checkDraft(s.records, { ...fine, signature: 'x' }), 'envelope');
});

test('createRecord refuses a private key that does not belong to identity.id', async () => {
  const s = await setup();
  await rejects(
    createRecord({ records: s.records, identity: { id: id('ben'), privateKey: keys.ada.privateKey }, kind: 'agreement.withdrawn', body: { agreement: s.agreement, reason: 'x' }, time: s.nextTime() }),
    'signature',
  );
  await assert.rejects(createRecord({ records: s.records, identity: { id: id('ben') }, kind: 'x', body: {} }), TypeError);
});

test('createRecord refuses to extend an invalid history', async () => {
  const s = await setup();
  const tampered = structuredClone(s.records);
  tampered[2].body.agreement = s.records[0].id;
  await assert.rejects(
    createRecord({ records: tampered, identity: keys.ben, kind: 'agreement.withdrawn', body: { agreement: s.agreement, reason: 'x' }, time: s.nextTime() }),
    (e) => e.code === 'id' && e.index === 2,
  );
});

test('verifyAppend reports which record failed through error.index', async () => {
  const s = await setup();
  const good = await forge(s.records, 'ben', { kind: 'agreement.withdrawn', body: { agreement: s.agreement, reason: 'Pause' } });
  assert.equal((await verifyAppend(s.records, good)).count, s.records.length + 1);
  const bad = await forge(s.records, 'scribe', { kind: 'agreement.withdrawn', body: { agreement: s.agreement, reason: 'Pause' } });
  await assert.rejects(verifyAppend(s.records, bad), (e) => e.code === 'authority' && e.index === s.records.length && /^Record \d+: /.test(e.message));
});

// --- Bundles and envelopes ------------------------------------------------------

test('bundles are exactly {format, records} with 1 to 10000 records', async () => {
  const s = await setup({ grant: false, consent: false });
  assert.equal((await verifyBundle({ format: BUNDLE_FORMAT, records: s.records })).count, 2);
  await rejects(verifyBundle({ format: BUNDLE_FORMAT, records: s.records, extra: 1 }), 'format');
  await rejects(verifyBundle({ format: BUNDLE_FORMAT }), 'format');
  await rejects(verifyBundle({ format: 'koinos-bundle/0.2', records: s.records }), 'format');
  await rejects(verifyBundle({ format: BUNDLE_FORMAT, records: [] }), 'format');
  await rejects(verifyBundle({ format: BUNDLE_FORMAT, records: {} }), 'format');
  await rejects(verifyBundle([BUNDLE_FORMAT, s.records]), 'format');
  await rejects(verifyBundle(new Map()), 'canonical');
  await rejects(verifyBundle({ format: BUNDLE_FORMAT, records: new Array(10001).fill(null) }), 'limits');
  await rejects(verifyRecords([]), 'format');
});

test('records have exactly the ten envelope fields', async () => {
  const s = await setup({ grant: false, consent: false });
  const [g, a] = s.records;
  await rejects(verifyRecords([g, { ...a, extra: true }]), 'envelope');
  const { signature, ...unsigned } = a;
  await rejects(verifyRecords([g, unsigned]), 'envelope');
  await rejects(verifyRecords([g, null]), 'envelope');
  await rejects(verifyRecords([g, [a]]), 'envelope');
  assert.equal((await verifyRecords([g, a])).count, 2);
});

test('only the koinos/0.1 protocol is accepted, even when correctly signed', async () => {
  const s = await setup({ grant: false, consent: false });
  const ok = await forge(s.records, 'ada', { body: { agreement: s.agreement } });
  assert.equal((await verifyAppend(s.records, ok)).agreements[0].consents.length, 1);
  for (const protocol of ['koinos/0.2', 'koinos/0.1 ', 'Koinos/0.1']) {
    await rejects(verifyAppend(s.records, await forge(s.records, 'ada', { protocol, body: { agreement: s.agreement } })), 'envelope');
  }
});

test('project ids are lowercase UUIDs and the same on every record', async () => {
  const given = await new Story().add('ada', 'project.created', genesisBody(), { project: OTHER_PROJECT });
  assert.equal(given.project, OTHER_PROJECT);
  for (const project of [OTHER_PROJECT.toUpperCase(), '0b5d7a3e2f4c4d1a9e8b7c6d5e4f3a2b', '0b5d7a3e-2f4c-0d1a-9e8b-7c6d5e4f3a2b', 'project-1']) {
    await rejects(new Story().add('ada', 'project.created', genesisBody(), { project }), 'project');
  }
  const s = await setup({ grant: false, consent: false });
  await rejects(verifyAppend(s.records, await forge(s.records, 'ada', { project: OTHER_PROJECT, body: { agreement: s.agreement } })), 'project');
});

test('sequence and previous form one unbroken chain from genesis', async () => {
  const s = await setup();
  const r = s.records;
  await rejects(verifyRecords([r[0], r[2], r[1], ...r.slice(3)]), 'chain');
  await rejects(verifyRecords(r.slice(1)), 'chain');
  await rejects(verifyRecords([...r, r.at(-1)]), 'chain');
  await rejects(verifyAppend(r, await forge(r, 'ben', { sequence: r.length + 1, kind: 'agreement.withdrawn', body: { agreement: s.agreement, reason: 'x' } })), 'chain');
  await rejects(verifyAppend(r, await forge(r, 'ben', { previous: r[0].id, kind: 'agreement.withdrawn', body: { agreement: s.agreement, reason: 'x' } })), 'chain');
});

test('a fork verifies on each branch alone but the two branches cannot be combined', async () => {
  const s = await setup();
  const left = await forge(s.records, 'ben', { kind: 'agreement.withdrawn', body: { agreement: s.agreement, reason: 'Left' } });
  const right = await forge(s.records, 'ada', { kind: 'agreement.withdrawn', body: { agreement: s.agreement, reason: 'Right' } });
  const a = await verifyAppend(s.records, left);
  const b = await verifyAppend(s.records, right);
  assert.notEqual(a.head, b.head);
  await rejects(verifyRecords([...s.records, left, right]), 'chain');
  await rejects(verifyRecords([...s.records, left], { expectedHead: b.head }), 'pin');
});

test('record ids and signatures bind every envelope field', async () => {
  const s = await setup();
  const r = s.records;
  const tamper = async (index, mutate, code) => {
    const copy = structuredClone(r);
    mutate(copy[index]);
    await rejects(verifyRecords(copy), code);
  };
  await tamper(0, (x) => { x.body.title = 'Tampered'; }, 'id');
  await tamper(1, (x) => { x.time = '2026-10-29T00:00:01.001Z'; }, 'id');
  await tamper(1, (x) => { x.actor = id('ben'); }, 'id');
  await tamper(1, (x) => { x.signature = r[2].signature; }, 'signature');
  await tamper(1, (x) => { x.signature = `${x.signature}==`; }, 'signature');
  await tamper(1, (x) => { x.id = 'A'.repeat(64); }, 'id');
  // Re-hashing after a change still fails, because the signature covers the id.
  const copy = structuredClone(r);
  copy[1].body.title = 'Changed terms';
  copy[1].id = await recordId(copy[1]);
  await rejects(verifyRecords(copy.slice(0, 2)), 'signature');
});

test('unknown record kinds are rejected', async () => {
  const s = await setup({ grant: false, consent: false });
  for (const kind of ['contribution.merged', 'participant.added', 'Agreement.Consented', 7]) {
    await rejects(verifyAppend(s.records, await forge(s.records, 'ada', { kind, body: { agreement: s.agreement } })), 'kind');
  }
});

test('record times are canonical, real and nondecreasing; equal times are fine', async () => {
  const s = await setup({ grant: false, consent: false });
  const last = s.records.at(-1).time;
  await s.add('ada', 'agreement.consented', { agreement: s.agreement }, { time: last });
  for (const time of ['2026-10-28T23:59:59.999Z', '2026-10-29T00:00:05Z', '2026-02-30T00:00:00.000Z', '2026-10-29T00:00:05.000+00:00']) {
    await rejects(s.add('ben', 'agreement.consented', { agreement: s.agreement }, { time }), 'time');
  }
  await s.add('ben', 'agreement.consented', { agreement: s.agreement }, { time: '2026-10-29T00:00:05.000Z' });
});

test('a truncated history verifies alone but fails exact head and project pins', async () => {
  const s = await setup();
  const full = await verifyRecords(s.records);
  const short = s.records.slice(0, 3);
  assert.equal((await verifyRecords(short)).count, 3);
  await rejects(verifyRecords(short, { expectedHead: full.head }), 'pin');
  assert.equal((await verifyRecords(s.records, { expectedHead: full.head, expectedProject: full.project.id })).head, full.head);
  await rejects(verifyRecords(s.records, { expectedProject: OTHER_PROJECT }), 'pin');
  await rejects(verifyRecords(s.records, { expectedHead: null }), 'pin');
});

// --- Genesis --------------------------------------------------------------------

test('genesis comes first and only once', async () => {
  const s = await setup({ grant: false, consent: false });
  await rejects(s.add('ada', 'project.created', genesisBody()), 'chain');
  const stray = await forge([], 'ada', { project: OTHER_PROJECT, time: '2026-10-29T00:00:00.000Z', kind: 'agreement.consented', body: { agreement: s.agreement } });
  await rejects(verifyRecords([stray]), 'chain');
});

test('genesis is signed by a listed human, who becomes steward', async () => {
  const byBen = await new Story().add('ben', 'project.created', genesisBody());
  assert.equal((await verifyRecords([byBen])).project.steward, id('ben'));
  await rejects(new Story().add('scribe', 'project.created', genesisBody()), 'authority');
  await rejects(new Story().add('outsider', 'project.created', genesisBody()), 'authority');
});

test('genesis participants are unique, valid keys, human or agent, named, and at most 1000', async () => {
  const with_ = (participants) => new Story().add('ada', 'project.created', { ...genesisBody(), participants });
  const fakeKey = (i) => keyIdOf(Uint8Array.of(i & 0xff, i >> 8, ...new Array(30).fill(0x42)));
  const many = (n) => [people.ada, ...Array.from({ length: n - 1 }, (_, i) => ({ id: fakeKey(i), name: `p${i}`, kind: 'agent' }))];
  assert.equal((await verifyRecords([await with_(many(1000))])).participants.length, 1000);
  await rejects(with_(many(1001)), 'limits');
  await rejects(with_([]), 'field');
  await rejects(with_('ada'), 'field');
  await rejects(with_([people.ada, people.ada]), 'field');
  await rejects(with_([people.ada, { ...people.ben, kind: 'robot' }]), 'field');
  await rejects(with_([people.ada, { ...people.ben, name: '   ' }]), 'field');
  await rejects(with_([people.ada, { ...people.ben, name: 'B'.repeat(257) }]), 'limits');
  await rejects(with_([people.ada, { ...people.ben, role: 'builder' }]), 'body');
  await rejects(with_([people.ada, { id: keyIdOf(fromHex(SMALL_ORDER_CANONICAL[0])), name: 'Forged', kind: 'agent' }]), 'id');
  await rejects(with_([people.ada, { ...people.ben, id: `${id('ben')}=` }]), 'id');
});

test('titles and text need non-whitespace content within UTF-16 limits', async () => {
  const genesis = (extra) => new Story().add('ada', 'project.created', { ...genesisBody(), ...extra });
  await genesis({ title: '\u{1F35E}'.repeat(128) }); // 256 UTF-16 units
  await rejects(genesis({ title: `${'\u{1F35E}'.repeat(128)}x` }), 'limits');
  await genesis({ description: 'd'.repeat(8192) });
  await rejects(genesis({ description: 'd'.repeat(8193) }), 'limits');
  await rejects(genesis({ title: ' \t\n  ﻿' }), 'field');
  await rejects(genesis({ title: 7 }), 'field');
  await rejects(genesis({ summary: 'extra' }), 'body');
});

// --- Agreements and consent -------------------------------------------------------

test('only the steward proposes agreements, and the steward need not be a party', async () => {
  const s = await setup({ grant: false, consent: false });
  const propose = (who, parties) => s.add(who, 'agreement.proposed', { title: 'Terms', uri: niUri(TERMS), digest: TERMS, parties: parties.map(id) });
  await rejects(propose('ben', ['ben']), 'authority');
  await rejects(propose('scribe', ['ben']), 'authority');
  const own = await propose('ada', ['ben']);
  const state = await verifyRecords(s.records);
  assert.deepEqual(state.agreements.at(-1), { id: own.id, title: 'Terms', uri: niUri(TERMS), digest: TERMS, parties: [id('ben')], consents: [] });
});

test('agreement parties are distinct human participants', async () => {
  const s = await setup({ grant: false, consent: false });
  const propose = (parties) => s.add('ada', 'agreement.proposed', { title: 'Terms', uri: niUri(TERMS), digest: TERMS, parties });
  await rejects(propose([id('ada'), id('scribe')]), 'reference');
  await rejects(propose([id('outsider')]), 'reference');
  await rejects(propose([id('ada'), id('ada')]), 'field');
  await rejects(propose([]), 'field');
  await rejects(propose(id('ada')), 'field');
  await propose([id('ben'), id('ada')]);
});

test('agreement terms need a URI with a scheme and a lowercase SHA-256 digest', async () => {
  const s = await setup({ grant: false, consent: false });
  const propose = (uri, digest = TERMS) => s.add('ada', 'agreement.proposed', { title: 'Terms', uri, digest, parties: [id('ben')] });
  await propose('urn:exofab:charter');
  await propose(`https://example.invalid/${'a'.repeat(4096 - 24)}`);
  await rejects(propose(`https://example.invalid/${'a'.repeat(4096 - 23)}`), 'limits');
  for (const uri of ['charter.txt', 'urn:charter text', '1urn:x', ':x', 'urn:', 'urn:x y']) await rejects(propose(uri), 'field');
  for (const digest of [TERMS.toUpperCase(), TERMS.slice(1), `sha256:${TERMS}`]) await rejects(propose('urn:x', digest), 'field');
});

test('only listed human parties consent, once while consent is active', async () => {
  const s = await setup({ consent: false, grant: false });
  await rejects(s.add('outsider', 'agreement.consented', { agreement: s.agreement }), 'authority');
  await rejects(s.add('scribe', 'agreement.consented', { agreement: s.agreement }), 'authority');
  await s.add('ada', 'agreement.consented', { agreement: s.agreement });
  await rejects(s.add('ada', 'agreement.consented', { agreement: s.agreement }), 'state');
  const onlyBen = (await s.add('ada', 'agreement.proposed', { title: 'Ben only', uri: 'urn:x', digest: TERMS, parties: [id('ben')] })).id;
  await rejects(s.add('ada', 'agreement.consented', { agreement: onlyBen }), 'authority');
  await rejects(s.add('ben', 'agreement.consented', { agreement: s.agreement, note: 'yes' }), 'body');
});

test('withdrawal needs active consent and a reason; consent can be given again', async () => {
  const s = await setup({ consent: false, grant: false });
  await rejects(s.add('ada', 'agreement.withdrawn', { agreement: s.agreement, reason: 'Not yet' }), 'state');
  await s.add('ada', 'agreement.consented', { agreement: s.agreement });
  await s.add('ben', 'agreement.consented', { agreement: s.agreement });
  await rejects(s.add('ada', 'agreement.withdrawn', { agreement: s.agreement, reason: '  ' }), 'field');
  await rejects(s.add('ada', 'agreement.withdrawn', { agreement: s.agreement }), 'body');
  await s.add('ada', 'agreement.withdrawn', { agreement: s.agreement, reason: 'Reconsidering the scope' });
  assert.deepEqual((await verifyRecords(s.records)).agreements[0].consents, [id('ben')]);
  await s.add('ada', 'agreement.consented', { agreement: s.agreement });
  // Re-consent is appended, as in Koinos.
  assert.deepEqual((await verifyRecords(s.records)).agreements[0].consents, [id('ben'), id('ada')]);
});

test('consent must reference an earlier agreement in the same project', async () => {
  const s = await setup({ consent: false, grant: false });
  const other = await setup({ consent: false, grant: false });
  await rejects(s.add('ada', 'agreement.consented', { agreement: other.agreement }), 'reference');
  await rejects(s.add('ada', 'agreement.consented', { agreement: s.records[0].id }), 'reference');
  await rejects(s.add('ada', 'agreement.consented', { agreement: 'f'.repeat(64) }), 'reference');
  await rejects(s.add('ada', 'agreement.consented', { agreement: 7 }), 'reference');
});

// --- Delegation -------------------------------------------------------------------

test('delegation needs every party to consent at the time of the grant', async () => {
  const s = await setup({ consent: false, grant: false });
  await s.add('ben', 'agreement.consented', { agreement: s.agreement });
  await rejects(s.add('ben', 'delegation.granted', grantBody(s.agreement)), 'state');
  await s.add('ada', 'agreement.consented', { agreement: s.agreement });
  await s.add('ben', 'delegation.granted', grantBody(s.agreement));
  await s.add('ada', 'agreement.withdrawn', { agreement: s.agreement, reason: 'Pause' });
  await rejects(s.add('ben', 'delegation.granted', grantBody(s.agreement)), 'state');
});

test('only a human party delegates, and only to an agent participant', async () => {
  const s = await setup({ grant: false });
  await rejects(s.add('scribe', 'delegation.granted', grantBody(s.agreement)), 'authority');
  await rejects(s.add('outsider', 'delegation.granted', grantBody(s.agreement)), 'authority');
  await rejects(s.add('ben', 'delegation.granted', grantBody(s.agreement, { agent: id('ben') })), 'reference');
  await rejects(s.add('ben', 'delegation.granted', grantBody(s.agreement, { agent: id('outsider') })), 'reference');
  const g = await s.add('ada', 'delegation.granted', grantBody(s.agreement, { agent: id('helper') }));
  assert.equal((await verifyRecords(s.records)).delegations[0].principal, id('ada'));
  assert.equal((await verifyRecords(s.records)).delegations[0].id, g.id);
});

test('delegation scope is exactly ["contribution.submit"]', async () => {
  const s = await setup({ grant: false });
  for (const scope of [[], ['everything'], ['contribution.submit', 'contribution.review'], 'contribution.submit', ['Contribution.submit']]) {
    await rejects(s.add('ben', 'delegation.granted', grantBody(s.agreement, { scope })), 'field');
  }
  await s.add('ben', 'delegation.granted', grantBody(s.agreement));
});

test('delegation expiry is a canonical time strictly after the grant', async () => {
  const s = await setup({ grant: false });
  const at = '2026-10-29T01:00:00.000Z';
  await rejects(s.add('ben', 'delegation.granted', grantBody(s.agreement, { expires: at }), { time: at }), 'time');
  await rejects(s.add('ben', 'delegation.granted', grantBody(s.agreement, { expires: '2026-10-29T00:59:59.999Z' }), { time: at }), 'time');
  await rejects(s.add('ben', 'delegation.granted', grantBody(s.agreement, { expires: '2026-11-12' }), { time: at }), 'time');
  await s.add('ben', 'delegation.granted', grantBody(s.agreement, { expires: '2026-10-29T01:00:00.001Z' }), { time: at });
});

test('only the grantor revokes a delegation, once and irreversibly', async () => {
  const s = await setup();
  const revoke = (who, delegation = s.delegation, reason = 'No longer needed') => s.add(who, 'delegation.revoked', { delegation, reason });
  await rejects(revoke('ada'), 'authority');
  await rejects(revoke('scribe'), 'authority');
  await rejects(revoke('ben', s.agreement), 'reference');
  await rejects(revoke('ben', s.delegation, '\n'), 'field');
  await revoke('ben');
  assert.equal((await verifyRecords(s.records)).delegations[0].revoked, true);
  await rejects(revoke('ben'), 'state');
});

// --- Submission ---------------------------------------------------------------------

test('a human party submits with a null delegation and is their own principal', async () => {
  const s = await setup({ grant: true });
  const c = await s.add('ben', 'contribution.submitted', submitBody(s.agreement));
  const state = await verifyRecords(s.records);
  assert.equal(state.contributions[0].id, c.id);
  assert.equal(state.contributions[0].actor, id('ben'));
  assert.equal(state.contributions[0].principal, id('ben'));
  await rejects(s.add('ben', 'contribution.submitted', submitBody(s.agreement, s.delegation)), 'field');
  await rejects(s.add('outsider', 'contribution.submitted', submitBody(s.agreement)), 'authority');
  const adaOnly = await setup({ parties: ['ada'], grant: false });
  await rejects(adaOnly.add('ben', 'contribution.submitted', submitBody(adaOnly.agreement)), 'authority');
});

test('an agent submits only under its own grant for that agreement', async () => {
  const s = await setup();
  const c = await s.add('scribe', 'contribution.submitted', submitBody(s.agreement, s.delegation));
  assert.equal((await verifyRecords(s.records)).contributions[0].principal, id('ben'));
  assert.equal(c.actor, id('scribe'));
  await rejects(s.add('scribe', 'contribution.submitted', submitBody(s.agreement, null)), 'reference');
  await rejects(s.add('helper', 'contribution.submitted', submitBody(s.agreement, s.delegation)), 'authority');
  await rejects(s.add('outsider', 'contribution.submitted', submitBody(s.agreement, s.delegation)), 'authority');
  const second = (await s.add('ada', 'agreement.proposed', { title: 'Second', uri: 'urn:second', digest: TERMS, parties: [id('ada')] })).id;
  await s.add('ada', 'agreement.consented', { agreement: second });
  await rejects(s.add('scribe', 'contribution.submitted', submitBody(second, s.delegation)), 'authority');
});

test('a grant expires at its expires instant, not after it', async () => {
  const s = await setup({ grant: false });
  const expires = '2026-10-29T01:00:00.000Z';
  const d = (await s.add('ben', 'delegation.granted', grantBody(s.agreement, { expires }))).id;
  await s.add('scribe', 'contribution.submitted', submitBody(s.agreement, d), { time: '2026-10-29T00:59:59.999Z' });
  await rejects(s.add('scribe', 'contribution.submitted', submitBody(s.agreement, d), { time: expires }), 'authority');
});

test('revocation blocks new agent submissions', async () => {
  const s = await setup();
  await s.add('scribe', 'contribution.submitted', submitBody(s.agreement, s.delegation));
  await s.add('ben', 'delegation.revoked', { delegation: s.delegation, reason: 'Done' });
  await rejects(s.add('scribe', 'contribution.submitted', submitBody(s.agreement, s.delegation)), 'authority');
});

test('submission needs every party to consent, for humans and agents', async () => {
  const s = await setup();
  await s.add('ada', 'agreement.withdrawn', { agreement: s.agreement, reason: 'Pause' });
  await rejects(s.add('ben', 'contribution.submitted', submitBody(s.agreement)), 'state');
  await rejects(s.add('scribe', 'contribution.submitted', submitBody(s.agreement, s.delegation)), 'state');
  await s.add('ada', 'agreement.consented', { agreement: s.agreement });
  await s.add('scribe', 'contribution.submitted', submitBody(s.agreement, s.delegation));
});

test('a submission cites an artifact URI and digest exactly', async () => {
  const s = await setup();
  const submit = (artifact) => s.add('ben', 'contribution.submitted', submitBody(s.agreement, null, { artifact }));
  await rejects(submit({ uri: niUri(ART) }), 'body');
  await rejects(submit({ uri: niUri(ART), digest: ART, size: 10 }), 'body');
  await rejects(submit({ uri: niUri(ART), digest: ART.toUpperCase() }), 'field');
  await rejects(submit({ uri: 'artifact', digest: ART }), 'field');
  await rejects(submit(null), 'body');
  await submit({ uri: niUri(ART), digest: ART });
});

// --- Review --------------------------------------------------------------------------

test('a reviewer is a human party who is neither the submitter nor the principal', async () => {
  const s = await setup();
  const c = (await s.add('scribe', 'contribution.submitted', submitBody(s.agreement, s.delegation))).id;
  await rejects(s.add('ben', 'contribution.reviewed', reviewBody(c)), 'authority'); // principal
  await rejects(s.add('scribe', 'contribution.reviewed', reviewBody(c)), 'authority'); // agent submitter
  await rejects(s.add('outsider', 'contribution.reviewed', reviewBody(c)), 'authority');
  await s.add('ada', 'contribution.reviewed', reviewBody(c));
  const own = (await s.add('ben', 'contribution.submitted', submitBody(s.agreement))).id;
  await rejects(s.add('ben', 'contribution.reviewed', reviewBody(own)), 'authority'); // human submitter
  await s.add('ada', 'contribution.reviewed', reviewBody(own));
  const benOnly = await setup({ parties: ['ben'], grant: false });
  const theirs = (await benOnly.add('ben', 'contribution.submitted', submitBody(benOnly.agreement))).id;
  await rejects(benOnly.add('ada', 'contribution.reviewed', reviewBody(theirs)), 'authority'); // steward, not a party
});

test('a review decides approve or request_changes, with a note', async () => {
  const s = await setup();
  const c = (await s.add('scribe', 'contribution.submitted', submitBody(s.agreement, s.delegation))).id;
  for (const decision of ['reject', 'approved', 'APPROVE', null]) await rejects(s.add('ada', 'contribution.reviewed', reviewBody(c, decision)), 'field');
  await rejects(s.add('ada', 'contribution.reviewed', reviewBody(c, 'approve', ' ')), 'field');
  await rejects(s.add('ada', 'contribution.reviewed', { contribution: c, decision: 'approve' }), 'body');
  await rejects(s.add('ada', 'contribution.reviewed', reviewBody(s.agreement)), 'reference');
  await s.add('ada', 'contribution.reviewed', reviewBody(c, 'request_changes', 'Add a test for zero quantities.'));
});

test('the latest review controls status, and reviews do not need consent', async () => {
  const s = await setup();
  const c = (await s.add('scribe', 'contribution.submitted', submitBody(s.agreement, s.delegation))).id;
  const status = async () => (await verifyRecords(s.records)).contributions[0].status;
  assert.equal(await status(), 'submitted');
  await s.add('ada', 'contribution.reviewed', reviewBody(c, 'request_changes', 'Needs edge cases.'));
  assert.equal(await status(), 'changes_requested');
  await s.add('ada', 'agreement.withdrawn', { agreement: s.agreement, reason: 'Pause' });
  await s.add('ada', 'contribution.reviewed', reviewBody(c, 'approve', 'Edge cases covered.'));
  assert.equal(await status(), 'reviewed');
  assert.equal((await verifyRecords(s.records)).contributions[0].reviews.length, 2);
});

// --- Acceptance --------------------------------------------------------------------

async function reviewed() {
  const s = await setup();
  s.contribution = (await s.add('scribe', 'contribution.submitted', submitBody(s.agreement, s.delegation))).id;
  s.review = (await s.add('ada', 'contribution.reviewed', reviewBody(s.contribution))).id;
  s.accept = (who = 'ada', review = s.review, opts) => s.add(who, 'contribution.accepted', { contribution: s.contribution, review }, opts);
  return s;
}

test('only the steward accepts', async () => {
  const s = await reviewed();
  await rejects(s.accept('ben'), 'authority');
  await rejects(s.accept('scribe'), 'authority');
  await s.accept('ada');
  const c = (await verifyRecords(s.records)).contributions[0];
  assert.equal(c.status, 'accepted');
  assert.deepEqual(c.acceptance, { id: s.records.at(-1).id, actor: id('ada'), review: s.review });
});

test('acceptance cites the latest review, which must approve', async () => {
  const s = await setup();
  const c = (await s.add('scribe', 'contribution.submitted', submitBody(s.agreement, s.delegation))).id;
  const accept = (review) => s.add('ada', 'contribution.accepted', { contribution: c, review });
  await rejects(accept(s.records.at(-1).id), 'state'); // no review yet
  const first = (await s.add('ada', 'contribution.reviewed', reviewBody(c))).id;
  const changes = (await s.add('ada', 'contribution.reviewed', reviewBody(c, 'request_changes', 'One more fix.'))).id;
  await rejects(accept(first), 'state');
  await rejects(accept(changes), 'state');
  const last = (await s.add('ada', 'contribution.reviewed', reviewBody(c, 'approve', 'Fixed.'))).id;
  await rejects(accept(first), 'state');
  await rejects(s.add('ada', 'contribution.accepted', { contribution: s.agreement, review: last }), 'reference');
  await accept(last);
});

test('a contribution is accepted once and then cannot be reviewed', async () => {
  const s = await reviewed();
  await s.accept();
  await rejects(s.accept(), 'state');
  await rejects(s.add('ada', 'contribution.reviewed', reviewBody(s.contribution)), 'state');
});

test('acceptance needs every party to consent; restored consent allows it', async () => {
  const s = await reviewed();
  await s.add('ben', 'agreement.withdrawn', { agreement: s.agreement, reason: 'Pause' });
  await rejects(s.accept(), 'state');
  await s.add('ben', 'agreement.consented', { agreement: s.agreement });
  await s.accept();
});

test('an agent contribution needs its grant still active at acceptance', async () => {
  const revoked = await reviewed();
  await revoked.add('ben', 'delegation.revoked', { delegation: revoked.delegation, reason: 'Stop' });
  await rejects(revoked.accept(), 'authority');

  const expiring = await setup({ grant: false });
  const expires = '2026-10-29T01:00:00.000Z';
  const d = (await expiring.add('ben', 'delegation.granted', grantBody(expiring.agreement, { expires }))).id;
  const c = (await expiring.add('scribe', 'contribution.submitted', submitBody(expiring.agreement, d))).id;
  const r = (await expiring.add('ada', 'contribution.reviewed', reviewBody(c))).id;
  await rejects(expiring.add('ada', 'contribution.accepted', { contribution: c, review: r }, { time: expires }), 'authority');
  await expiring.add('ada', 'contribution.accepted', { contribution: c, review: r }, { time: '2026-10-29T00:59:59.999Z' });
});

// --- Disputes ---------------------------------------------------------------------

test('only an accepted contribution is disputed, by a human party', async () => {
  const s = await reviewed();
  const dispute = (who, reason = 'Coverage concern') => s.add(who, 'contribution.disputed', { contribution: s.contribution, reason });
  await rejects(dispute('ben'), 'state');
  await s.accept();
  await rejects(dispute('scribe'), 'authority');
  await rejects(dispute('outsider'), 'authority');
  await rejects(dispute('ben', ''), 'field');
  const d = await dispute('ben');
  const c = (await verifyRecords(s.records)).contributions[0];
  assert.equal(c.status, 'disputed');
  assert.deepEqual(c.dispute, { id: d.id, actor: id('ben'), reason: 'Coverage concern' });
});

test('disputed is terminal, and disputes remain possible after withdrawal', async () => {
  const s = await reviewed();
  await s.accept();
  await s.add('ada', 'agreement.withdrawn', { agreement: s.agreement, reason: 'Concern' });
  await s.add('ada', 'contribution.disputed', { contribution: s.contribution, reason: 'Steward concern' });
  await rejects(s.add('ben', 'contribution.disputed', { contribution: s.contribution, reason: 'Again' }), 'state');
  await rejects(s.add('ada', 'contribution.reviewed', reviewBody(s.contribution)), 'state');
  await s.add('ada', 'agreement.consented', { agreement: s.agreement });
  await rejects(s.accept(), 'state');
});

test('references resolve only to earlier records of the right kind in this project', async () => {
  const s = await reviewed();
  const other = await reviewed();
  await rejects(s.add('ada', 'contribution.accepted', { contribution: other.contribution, review: other.review }), 'reference');
  await rejects(s.add('ben', 'delegation.revoked', { delegation: s.agreement, reason: 'x' }), 'reference');
  await rejects(s.add('ada', 'contribution.reviewed', reviewBody(s.delegation)), 'reference');
  await rejects(s.add('ben', 'contribution.submitted', submitBody(s.contribution)), 'reference');
  await rejects(s.add('ben', 'contribution.disputed', { contribution: other.contribution, reason: 'x' }), 'reference');
});

// --- Reading the Koinos example as data ------------------------------------------------

test('the Koinos example bundle verifies with this implementation (data read from KOINOS_DIR)', async (t) => {
  const dir = process.env.KOINOS_DIR;
  if (!dir) {
    t.skip('KOINOS_DIR is not set; set it to a Koinos 0.1 checkout to check examples/accepted.bundle.json');
    return;
  }
  // Read as JSON data only; no Koinos code is loaded.
  const bundle = JSON.parse(await readFile(join(dir, 'examples', 'accepted.bundle.json'), 'utf8'));
  const state = await verifyBundle(bundle);
  assert.equal(state.count, 8);
  assert.equal(state.head, bundle.records.at(-1).id);
  assert.equal(state.project.steward, bundle.records[0].actor);
  const [c] = state.contributions;
  assert.equal(c.status, 'accepted');
  assert.equal(c.principal, state.project.steward);
  assert.equal(c.acceptance.review, c.reviews.at(-1).id);
  assert.equal(await sha256Hex(new Uint8Array(await readFile(join(dir, 'examples', 'terms.txt')))), state.agreements[0].digest);
  assert.equal(await sha256Hex(new Uint8Array(await readFile(join(dir, 'examples', 'seed-catalogue.schema.json')))), c.artifact.digest);
  assert.equal((await verifyBundle(bundle, { expectedHead: state.head, expectedProject: state.project.id })).head, state.head);
  for (const [name, mutate] of Object.entries({
    'changed body': (b) => { b.records[0].body.title = 'tampered'; },
    'bad signature': (b) => { b.records[1].signature = 'A'.repeat(86); },
    reordered: (b) => { [b.records[1], b.records[2]] = [b.records[2], b.records[1]]; },
    'unsupported format': (b) => { b.format = 'koinos-bundle/999'; },
    'unknown field': (b) => { b.records[0].hidden = true; },
  })) {
    const copy = structuredClone(bundle);
    mutate(copy);
    await assert.rejects(verifyBundle(copy), KoinosError, name);
  }
  await rejects(verifyBundle({ ...bundle, records: bundle.records.slice(0, -1) }, { expectedHead: state.head }), 'pin');
});
