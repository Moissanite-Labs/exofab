// File store for the hub. Layout under the data directory (directories 0700,
// files 0600):
//
//   hub.json                   hash-chained hub log {format, events}
//   credentials.json           SHA-256 of bearer tokens -> {id, kind}
//   pins.json                  last verified head of each project {pid: head}
//   projects/<pid>.json        koinos-bundle/0.1, canonical JSON
//   projects/<pid>.blobs.json  digests stored for that project
//   blobs/<sha256 hex>         content-addressed bytes
//
// Every write goes to a fresh temporary file (flag 'wx', mode 0600), is
// fsynced, then renamed over the target, and all writes are serialized by an
// in-process mutex. Reads parse with the strict JSON parser under a size cap
// and fail closed. Writes are refused (code 'full') before they would pass the
// same cap, so the store never writes a file it would then refuse to read. Project ids and digests are validated before they are used
// in a path. The store checks structure, chains and pins; signature and
// authority checks are the hub's, through src/koinos.
import { mkdir, open, rename, unlink, readdir, chmod, stat, constants } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { canonicalize, sha256Hex, isCanonicalTime, BUNDLE_FORMAT, LIMITS } from '../koinos/index.mjs';
import { isUuid, isHash, isPlainObject } from '../koinos/fields.mjs';
import { parseStrictJson } from '../json/strict.mjs';
import { Mutex } from './mutex.mjs';

export const HUB_FORMAT = 'exofab-hub/0.1';
export const CREDENTIALS_FORMAT = 'exofab-credentials/0.1';
export const PROJECT_BLOBS_FORMAT = 'exofab-project-blobs/0.1';
const EVENT_FIELDS = ['seq', 'prev', 'time', 'author', 'type', 'body', 'hash'];

const MiB = 1024 * 1024;
export const STORE_LIMITS = Object.freeze({
  hubBytes: 64 * MiB,
  credentialsBytes: 4 * MiB,
  pinsBytes: 4 * MiB,
  bundleBytes: LIMITS.bundleBytes + 1, // canonical JSON plus a final newline
  projectBlobsBytes: 4 * MiB,
  blobBytes: 16 * MiB,
});

// Codes: invalid (bad argument), hub-chain (hub log does not verify), corrupt
// (unreadable or inconsistent file), diverged (a write would not extend the
// stored history), pin (the trusted head is missing or would move back),
// exists (a credential is already stored), full (the write would make a file
// larger than its read cap; nothing was written).
export class StoreError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'StoreError';
    this.code = code;
  }
}

const fail = (code, message, options) => {
  throw new StoreError(code, message, options);
};

// O_NOFOLLOW where the platform has it, so a planted symlink is not followed.
const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);

const detached = (value) => JSON.parse(canonicalize(value));
const sameRecord = (a, b) => canonicalize(a) === canonicalize(b);

export function checkProjectId(pid) {
  if (!isUuid(pid)) fail('invalid', 'Project id must be a lowercase UUID');
  return pid;
}

export function checkDigest(digest) {
  if (!isHash(digest)) fail('invalid', 'Digest must be 64 lowercase hexadecimal characters');
  return digest;
}

export async function eventHash({ seq, prev, time, author, type, body }) {
  return sha256Hex(canonicalize({ seq, prev, time, author, type, body }));
}

// Writes data to path atomically: temp file, fsync, rename, directory fsync.
export async function atomicWrite(path, data) {
  const temp = `${path}.${globalThis.crypto.randomUUID()}.tmp`;
  const handle = await open(temp, 'wx', 0o600);
  let closed = false;
  let renamed = false;
  try {
    await handle.chmod(0o600); // independent of the process umask
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    closed = true;
    await rename(temp, path);
    renamed = true;
  } finally {
    if (!closed) await handle.close().catch(() => {});
    if (!renamed) await unlink(temp).catch(() => {});
  }
  await syncDirectory(dirname(path));
}

async function syncDirectory(dir) {
  let handle;
  try {
    handle = await open(dir, constants.O_RDONLY);
    await handle.sync();
  } catch {
    // Some platforms cannot fsync a directory; the rename is still atomic.
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function readCapped(path, cap, label) {
  let handle;
  try {
    handle = await open(path, READ_FLAGS);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error.code === 'ELOOP') fail('corrupt', `${label} is a symbolic link`);
    throw error;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) fail('corrupt', `${label} is not a regular file`);
    if (info.size > cap) fail('corrupt', `${label} is larger than ${cap} bytes`);
    const bytes = await handle.readFile();
    if (bytes.length > cap) fail('corrupt', `${label} is larger than ${cap} bytes`);
    return bytes;
  } finally {
    await handle.close();
  }
}

function parseFile(bytes, cap, label, code = 'corrupt') {
  try {
    return parseStrictJson(bytes, { maxBytes: cap });
  } catch (error) {
    return fail(code, `${label} is not valid strict JSON: ${error.message}`, { cause: error });
  }
}

function exactKeys(value, names, code, label) {
  if (!isPlainObject(value)) fail(code, `${label} must be an object`);
  const keys = Object.keys(value);
  if (keys.length !== names.length || !names.every((n) => Object.hasOwn(value, n))) {
    fail(code, `${label} must have exactly the fields: ${names.join(', ')}`);
  }
}

// Structure only; the hub verifies records with Koinos before writing them.
function checkBundleShape(bundle, pid, code) {
  exactKeys(bundle, ['format', 'records'], code, 'Bundle');
  if (bundle.format !== BUNDLE_FORMAT) fail(code, `Bundle format must be ${BUNDLE_FORMAT}`);
  if (!Array.isArray(bundle.records) || bundle.records.length === 0) fail(code, 'Bundle must contain at least one record');
  for (const record of bundle.records) {
    if (!isPlainObject(record) || !isHash(record.id)) fail(code, 'Every record must be an object with a SHA-256 id');
    if (record.project !== pid) fail(code, 'Every record must belong to the bundle project');
  }
}

async function ensureDirectory(path, { recursive = false } = {}) {
  let created;
  try {
    created = await mkdir(path, { mode: 0o700, recursive });
    if (!recursive) created = path;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  if (created) await chmod(path, 0o700);
  if (!(await stat(path)).isDirectory()) fail('corrupt', `${path} is not a directory`);
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

// Refuses, before writing, a file the capped reader would later refuse.
async function writeCapped(path, text, cap, label) {
  if (Buffer.byteLength(text, 'utf8') > cap) fail('full', `${label} would grow past its limit of ${cap} bytes; the change was not stored`);
  await atomicWrite(path, text);
}

export class FileStore {
  #lock = new Mutex();
  #hubCache = null; // {bytes, events} of the last verified hub log
  #limits;

  // `limits` overrides STORE_LIMITS (tests use small caps).
  constructor(dir, { limits = {} } = {}) {
    if (typeof dir !== 'string' || dir === '') throw new TypeError('FileStore needs a data directory');
    this.dir = dir;
    this.#limits = Object.freeze({ ...STORE_LIMITS, ...limits });
  }

  #path(...parts) {
    return join(this.dir, ...parts);
  }

  #bundlePath(pid) {
    return this.#path('projects', `${checkProjectId(pid)}.json`);
  }

  #blobListPath(pid) {
    return this.#path('projects', `${checkProjectId(pid)}.blobs.json`);
  }

  #blobPath(digest) {
    return this.#path('blobs', checkDigest(digest));
  }

  init() {
    return this.#lock.run(async () => {
      await ensureDirectory(this.dir, { recursive: true });
      await ensureDirectory(this.#path('projects'));
      await ensureDirectory(this.#path('blobs'));
      const initial = [
        ['hub.json', { format: HUB_FORMAT, events: [] }],
        ['credentials.json', { format: CREDENTIALS_FORMAT, tokens: {} }],
        ['pins.json', {}],
      ];
      for (const [name, value] of initial) {
        const path = this.#path(name);
        try {
          await stat(path);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          await atomicWrite(path, json(value));
        }
      }
    });
  }

  // --- Hub log -----------------------------------------------------------------

  readHubEvents() {
    return this.#lock.run(async () => structuredClone(await this.#readHub()));
  }

  async #readHub() {
    const label = 'Hub log';
    const bytes = await readCapped(this.#path('hub.json'), this.#limits.hubBytes, label);
    if (bytes === null) fail('hub-chain', 'Hub log is missing; run init first');
    if (this.#hubCache && this.#hubCache.bytes.equals(bytes)) return this.#hubCache.events;
    const doc = parseFile(bytes, this.#limits.hubBytes, label, 'hub-chain');
    exactKeys(doc, ['format', 'events'], 'hub-chain', label);
    if (doc.format !== HUB_FORMAT) fail('hub-chain', `Hub log format must be ${HUB_FORMAT}`);
    if (!Array.isArray(doc.events)) fail('hub-chain', 'Hub log events must be an array');
    let prev = null;
    for (const [i, event] of doc.events.entries()) {
      const where = `Hub event ${i}`;
      exactKeys(event, EVENT_FIELDS, 'hub-chain', where);
      if (event.seq !== i) fail('hub-chain', `${where} has sequence ${event.seq}`);
      if (event.prev !== prev) fail('hub-chain', `${where} does not link to the previous event`);
      if (!isCanonicalTime(event.time)) fail('hub-chain', `${where} has an invalid time`);
      if (typeof event.type !== 'string' || !isPlainObject(event.body)) fail('hub-chain', `${where} has an invalid type or body`);
      let hash;
      try {
        hash = await eventHash(event);
      } catch (error) {
        fail('hub-chain', `${where} cannot be hashed: ${error.message}`, { cause: error });
      }
      if (hash !== event.hash) fail('hub-chain', `${where} hash does not match its content`);
      prev = event.hash;
    }
    this.#hubCache = { bytes, events: doc.events };
    return doc.events;
  }

  async appendHubEvent({ time, author, type, body }) {
    if (!isCanonicalTime(time)) fail('invalid', 'Event time must be a canonical UTC timestamp');
    if (author !== null && (typeof author !== 'string' || author === '')) fail('invalid', 'Event author must be an id or null');
    if (typeof type !== 'string' || !/^[a-z]+(?:\.[a-z]+)+$/.test(type)) fail('invalid', 'Event type must look like noun.verb');
    if (!isPlainObject(body)) fail('invalid', 'Event body must be an object');
    return this.#lock.run(async () => {
      const events = await this.#readHub();
      const event = { seq: events.length, prev: events.at(-1)?.hash ?? null, time, author, type, body: detached(body) };
      event.hash = await eventHash(event);
      const next = [...events, event];
      const text = json({ format: HUB_FORMAT, events: next });
      await writeCapped(this.#path('hub.json'), text, this.#limits.hubBytes, 'Hub log');
      this.#hubCache = { bytes: Buffer.from(text), events: next };
      return structuredClone(event);
    });
  }

  // --- Projects ------------------------------------------------------------------

  // Projects with a stored history or a trusted head. A pinned project whose
  // file is gone is still listed, so reading it fails closed.
  listProjects() {
    return this.#lock.run(async () => {
      const ids = new Set(Object.keys(await this.#readPins()));
      for (const name of await readdir(this.#path('projects'))) {
        const match = /^(.+)\.json$/.exec(name);
        if (match && isUuid(match[1])) ids.add(match[1]);
      }
      return [...ids].sort();
    });
  }

  async readBundle(pid) {
    checkProjectId(pid);
    return this.#lock.run(() => this.#readBundle(pid));
  }

  async #readBundle(pid) {
    const label = `Project ${pid}`;
    const pin = (await this.#readPins())[pid];
    const bytes = await readCapped(this.#bundlePath(pid), this.#limits.bundleBytes, label);
    if (bytes === null) {
      if (pin !== undefined) fail('pin', `${label} has a trusted head but no stored history`);
      return null;
    }
    const bundle = parseFile(bytes, this.#limits.bundleBytes, label);
    checkBundleShape(bundle, pid, 'corrupt');
    if (pin !== undefined && !bundle.records.some((r) => r.id === pin)) {
      fail('pin', `${label}: stored history does not extend the trusted head`);
    }
    return bundle;
  }

  // Stores a bundle only if it extends the stored records exactly (an equal
  // history is a no-op rewrite) and still contains the trusted head.
  async writeBundle(pid, bundle) {
    checkProjectId(pid);
    checkBundleShape(bundle, pid, 'invalid');
    let text;
    try {
      text = canonicalize(bundle);
    } catch (error) {
      fail('invalid', `Bundle is not canonical JSON: ${error.message}`, { cause: error });
    }
    return this.#lock.run(async () => {
      const stored = await this.#readBundle(pid);
      if (stored) {
        if (bundle.records.length < stored.records.length) fail('diverged', 'Bundle is shorter than the stored history');
        stored.records.forEach((record, i) => {
          if (!sameRecord(record, bundle.records[i])) fail('diverged', `Bundle differs from the stored history at record ${i}`);
        });
      }
      const pin = (await this.#readPins())[pid];
      if (pin !== undefined && !bundle.records.some((r) => r.id === pin)) fail('pin', 'Bundle does not extend the trusted head');
      await writeCapped(this.#bundlePath(pid), `${text}\n`, this.#limits.bundleBytes, `Project ${pid}`);
    });
  }

  // --- Trusted heads -------------------------------------------------------------

  readPins() {
    return this.#lock.run(async () => ({ ...(await this.#readPins()) }));
  }

  async #readPins() {
    const label = 'Pins file';
    const bytes = await readCapped(this.#path('pins.json'), this.#limits.pinsBytes, label);
    if (bytes === null) fail('corrupt', 'Pins file is missing; run init first');
    const pins = parseFile(bytes, this.#limits.pinsBytes, label);
    if (!isPlainObject(pins)) fail('corrupt', 'Pins file must be an object');
    for (const [pid, head] of Object.entries(pins)) {
      if (!isUuid(pid) || !isHash(head)) fail('corrupt', 'Pins file must map project ids to record ids');
    }
    return pins;
  }

  // Moves a project's trusted head forward to a record of its stored history.
  async writePin(pid, head) {
    checkProjectId(pid);
    checkDigest(head);
    return this.#lock.run(async () => {
      const bundle = await this.#readBundle(pid);
      if (!bundle) fail('invalid', 'There is no stored history for this project');
      const ids = bundle.records.map((r) => r.id);
      const at = ids.indexOf(head);
      if (at < 0) fail('pin', 'The new head is not in the stored history');
      const pins = await this.#readPins();
      if (pins[pid] !== undefined && ids.indexOf(pins[pid]) > at) fail('pin', 'The new head would move the trusted head back');
      pins[pid] = head;
      const sorted = Object.fromEntries(Object.entries(pins).sort(([a], [b]) => (a < b ? -1 : 1)));
      await writeCapped(this.#path('pins.json'), json(sorted), this.#limits.pinsBytes, 'Pins file');
    });
  }

  // --- Blobs ---------------------------------------------------------------------

  async putBlob(bytes) {
    if (!(bytes instanceof Uint8Array)) fail('invalid', 'Blob must be a Uint8Array');
    if (bytes.length > this.#limits.blobBytes) fail('invalid', `Blob is larger than ${this.#limits.blobBytes} bytes`);
    const copy = new Uint8Array(bytes); // later changes by the caller cannot alter what is hashed
    const digest = await sha256Hex(copy);
    await this.#lock.run(() => atomicWrite(this.#blobPath(digest), copy));
    return { digest, size: copy.length };
  }

  // Returns the bytes, or null if absent. Bytes that no longer match their
  // digest are refused rather than served.
  async getBlob(digest) {
    const path = this.#blobPath(digest);
    const bytes = await readCapped(path, this.#limits.blobBytes, `Blob ${digest}`);
    if (bytes === null) return null;
    const copy = new Uint8Array(bytes);
    if ((await sha256Hex(copy)) !== digest) fail('corrupt', `Blob ${digest} does not match its digest`);
    return copy;
  }

  // Records that a blob was stored for a project (hub policies 5 and 6).
  async linkBlob(pid, digest) {
    checkProjectId(pid);
    checkDigest(digest);
    return this.#lock.run(async () => {
      const digests = await this.#readProjectBlobs(pid);
      if (digests.includes(digest)) return;
      const next = [...digests, digest].sort();
      const text = json({ format: PROJECT_BLOBS_FORMAT, digests: next });
      await writeCapped(this.#blobListPath(pid), text, this.#limits.projectBlobsBytes, `Blob list of project ${pid}`);
    });
  }

  async readProjectBlobs(pid) {
    checkProjectId(pid);
    return this.#lock.run(() => this.#readProjectBlobs(pid));
  }

  async #readProjectBlobs(pid) {
    const label = `Blob list of project ${pid}`;
    const bytes = await readCapped(this.#blobListPath(pid), this.#limits.projectBlobsBytes, label);
    if (bytes === null) return [];
    const doc = parseFile(bytes, this.#limits.projectBlobsBytes, label);
    exactKeys(doc, ['format', 'digests'], 'corrupt', label);
    if (doc.format !== PROJECT_BLOBS_FORMAT || !Array.isArray(doc.digests) || !doc.digests.every(isHash)) {
      fail('corrupt', `${label} is malformed`);
    }
    return doc.digests;
  }

  // --- Credentials ---------------------------------------------------------------

  readCredentials() {
    return this.#lock.run(async () => structuredClone(await this.#readCredentials()));
  }

  async #readCredentials() {
    const label = 'Credentials file';
    const bytes = await readCapped(this.#path('credentials.json'), this.#limits.credentialsBytes, label);
    if (bytes === null) fail('corrupt', 'Credentials file is missing; run init first');
    const doc = parseFile(bytes, this.#limits.credentialsBytes, label);
    exactKeys(doc, ['format', 'tokens'], 'corrupt', label);
    if (doc.format !== CREDENTIALS_FORMAT || !isPlainObject(doc.tokens)) fail('corrupt', `${label} is malformed`);
    for (const [hash, entry] of Object.entries(doc.tokens)) {
      if (!isHash(hash) || !isPlainObject(entry) || !isCredential(entry)) fail('corrupt', `${label} has a malformed entry`);
    }
    return doc;
  }

  async putCredential(tokenHash, { id, kind } = {}) {
    checkDigest(tokenHash);
    if (!isCredential({ id, kind })) fail('invalid', 'A credential needs an id and a kind of human or agent');
    return this.#lock.run(async () => {
      const doc = await this.#readCredentials();
      if (Object.hasOwn(doc.tokens, tokenHash)) fail('exists', 'This token hash is already stored');
      doc.tokens[tokenHash] = { id, kind };
      await writeCapped(this.#path('credentials.json'), json(doc), this.#limits.credentialsBytes, 'Credentials file');
    });
  }
}

function isCredential(entry) {
  const keys = Object.keys(entry);
  return (
    keys.length === 2 &&
    typeof entry.id === 'string' && entry.id !== '' && entry.id.length <= 512 &&
    (entry.kind === 'human' || entry.kind === 'agent')
  );
}
