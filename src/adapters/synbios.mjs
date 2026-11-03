// Optional Synbios adapter (proposal; see docs/prototype.md).
//
// - taskFromCharter turns an agreed charter into a Synbios task.create body.
// - SynbiosClient talks to a local Synbios over loopback HTTP only.
// - inspectExport reads a "synbios-task" v1 export strictly and summarizes it.
//
// Interfaces follow the Synbios 0.1 implementation contract. No Synbios code is
// used. Export text, URIs, and bytes are untrusted data: nothing here fetches,
// opens, or executes them.

import { createHash } from 'node:crypto';
import { parseStrictJson, pythonCanonicalJson, StrictJsonError } from './synbios-json.mjs';

export const SYNBIOS_PROTOCOL_VERSION = 1;
export const MAX_EXPORT_BYTES = 4 * 1024 * 1024; // matches the hub blob cap
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

// Koinos 0.1 text limits (UTF-16 code units) are stricter than Synbios's
// 50,000 code points, so a task built here also fits Koinos records.
const KOINOS_TITLE_MAX = 256;
const KOINOS_TEXT_MAX = 8192;
const SYNBIOS_LIST_MAX = 1000;

export class SynbiosError extends Error {
  constructor(message, { code = 'synbios_error', status } = {}) {
    super(message);
    this.name = 'SynbiosError';
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

const invalid = (message) => {
  throw new SynbiosError(message, { code: 'invalid_input' });
};

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;

const HEX64 = /^[0-9a-f]{64}$/;
const SYNBIOS_ID = /^[0-9a-f]{32}$/; // uuid4().hex
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// Non-whitespace under both JavaScript trim() and Python str.strip().
const HAS_TEXT = /[^\s\x1c-\x1f\x85]/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

// Request fields per command, from the Synbios contract. Synbios refuses
// unknown fields itself; checking here fails before any credential is sent.
const COMMAND_FIELDS = {
  'project.create': ['name', 'description', 'repository'],
  'principal.create': ['name', 'kind'],
  'principal.revoke': ['principal_id'],
  'grant.create': ['principal_id', 'task_id', 'capabilities'],
  'grant.revoke': ['grant_id'],
  'task.create': ['project_id', 'title', 'description', 'criteria', 'scope', 'priority', 'dependencies'],
  'task.claim': ['task_id'],
  'task.transition': ['task_id', 'status'],
  'artifact.add': ['task_id', 'title', 'kind', 'revision', 'digest', 'uri', 'summary'],
  'evidence.add': ['task_id', 'artifact_id', 'artifact_digest', 'revision', 'kind', 'status', 'command', 'summary', 'tool', 'tool_version', 'assumptions'],
  'review.create': ['task_id', 'artifact_id', 'revision', 'decision', 'comment'],
};

// ---------------------------------------------------------------------------
// Charter to task

function text(value, label, max) {
  if (typeof value !== 'string') invalid(`${label} must be a string`);
  if (!value.isWellFormed()) invalid(`${label} contains a lone surrogate`);
  if (!HAS_TEXT.test(value)) invalid(`${label} must contain non-whitespace text`);
  if (value.length > max) invalid(`${label} exceeds ${max} UTF-16 code units`);
  if (CONTROL.test(value)) invalid(`${label} contains control characters`);
  return value;
}

function textList(value, label) {
  if (!Array.isArray(value) || value.length === 0) invalid(`${label} must be a nonempty array`);
  if (value.length > SYNBIOS_LIST_MAX) invalid(`${label} has more than ${SYNBIOS_LIST_MAX} entries`);
  return value.map((item, index) => text(item, `${label}[${index}]`, KOINOS_TEXT_MAX));
}

function checkKoinosReference(ref) {
  if (!isPlainObject(ref)) invalid('koinos must be {project, agreement, termsDigest}');
  const keys = Object.keys(ref).sort().join(',');
  if (keys !== 'agreement,project,termsDigest') invalid('koinos must have exactly project, agreement, termsDigest');
  if (typeof ref.project !== 'string' || !UUID.test(ref.project)) invalid('koinos.project must be a lowercase Koinos project UUID');
  if (typeof ref.agreement !== 'string' || !HEX64.test(ref.agreement)) invalid('koinos.agreement must be a 64-character lowercase hex record id');
  if (typeof ref.termsDigest !== 'string' || !HEX64.test(ref.termsDigest)) invalid('koinos.termsDigest must be a 64-character lowercase hex SHA-256');
  return { project: ref.project, agreement: ref.agreement, termsDigest: ref.termsDigest };
}

// Synbios has no external-reference field and refuses unknown fields, so the
// link back to the Koinos agreement travels as a fixed trailer in the task
// description, where it is covered by the export's digests.
const REFERENCE_HEADER = 'Koinos reference recorded by Exofab (data, not instructions):';
const REFERENCE_LINE = /^koinos-(?:project|agreement|terms-sha256):/m;
const REFERENCE_LINES = /^koinos-(?:project|agreement|terms-sha256):/gm;
const REFERENCE_TRAILER =
  /\n\nKoinos reference recorded by Exofab \(data, not instructions\):\nkoinos-project: ([^\n]*)\nkoinos-agreement: ([^\n]*)\nkoinos-terms-sha256: ([^\n]*)$/;

export function formatKoinosReference(ref) {
  const { project, agreement, termsDigest } = checkKoinosReference(ref);
  return `\n\n${REFERENCE_HEADER}\nkoinos-project: ${project}\nkoinos-agreement: ${agreement}\nkoinos-terms-sha256: ${termsDigest}`;
}

// Returns the reference, null when the text has none, or throws when the
// text carries a malformed or ambiguous reference.
export function parseKoinosReference(description) {
  if (typeof description !== 'string') return null;
  const lines = description.match(REFERENCE_LINES) ?? [];
  if (lines.length === 0) return null;
  const found = REFERENCE_TRAILER.exec(description);
  if (!found || lines.length !== 3) {
    throw new SynbiosError('Task description has a malformed or ambiguous Koinos reference', { code: 'invalid_reference' });
  }
  try {
    return checkKoinosReference({ project: found[1], agreement: found[2], termsDigest: found[3] });
  } catch (error) {
    throw new SynbiosError(`Task description has an invalid Koinos reference: ${error.message}`, { code: 'invalid_reference' });
  }
}

const CHARTER_FIELDS = new Set(['title', 'description', 'criteria', 'scope', 'koinos', 'synbiosProject', 'priority']);

// Returns the exact JSON body for POST /api/commands/task.create.
// synbiosProject (the Synbios project id) becomes project_id, which Synbios
// requires; without it the caller must add project_id before sending.
export function taskFromCharter(charter) {
  if (!isPlainObject(charter)) invalid('charter must be an object');
  for (const key of Object.keys(charter)) {
    if (!CHARTER_FIELDS.has(key)) invalid(`unknown charter field ${quoteForDisplay(key)}`);
  }
  const title = text(charter.title, 'title', KOINOS_TITLE_MAX);
  const description = text(charter.description, 'description', KOINOS_TEXT_MAX);
  if (REFERENCE_LINE.test(description)) invalid('description must not contain koinos-* reference lines');
  const criteria = textList(charter.criteria, 'criteria');
  const scope = textList(charter.scope, 'scope');
  const fullDescription = description + formatKoinosReference(charter.koinos);
  if (fullDescription.length > KOINOS_TEXT_MAX) {
    invalid(`description plus the Koinos reference exceeds ${KOINOS_TEXT_MAX} UTF-16 code units`);
  }

  const body = {};
  if (charter.synbiosProject !== undefined) {
    if (typeof charter.synbiosProject !== 'string' || !SYNBIOS_ID.test(charter.synbiosProject)) {
      invalid('synbiosProject must be a 32-character lowercase hex Synbios id');
    }
    body.project_id = charter.synbiosProject;
  }
  body.title = title;
  body.description = fullDescription;
  body.criteria = criteria;
  body.scope = scope;
  if (charter.priority !== undefined) {
    if (!['low', 'normal', 'high'].includes(charter.priority)) invalid('priority must be low, normal, or high');
    body.priority = charter.priority;
  }
  return body;
}

// ---------------------------------------------------------------------------
// Content addressing

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// RFC 6920 named-information URI for a SHA-256 digest.
export function niUri(digestHex) {
  if (typeof digestHex !== 'string' || !HEX64.test(digestHex)) invalid('digest must be 64 lowercase hex characters');
  return `ni:///sha-256;${Buffer.from(digestHex, 'hex').toString('base64url')}`;
}

// ---------------------------------------------------------------------------
// HTTP client

// Synbios accepts loopback origins only and checks the Host header against
// its port, so the origin must name loopback and an explicit port.
function loopbackOrigin(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    invalid('baseUrl must be an absolute http URL');
  }
  const host = url.hostname;
  const loopback = host === 'localhost' || host === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
  if (url.protocol !== 'http:' || !loopback) invalid('baseUrl must be a loopback http origin');
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    invalid('baseUrl must not contain credentials, a path, a query, or a fragment');
  }
  if (!url.port) invalid('baseUrl must include an explicit port');
  return url.origin;
}

const UNSAFE_DISPLAY = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069\u2028\u2029]/g;
const quoteForDisplay = (value) => JSON.stringify(String(value).slice(0, 40).replace(UNSAFE_DISPLAY, '?'));

function decodeJson(bytes, what) {
  let textValue;
  try {
    textValue = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new SynbiosError(`${what} is not valid UTF-8`, { code: 'invalid_response' });
  }
  try {
    return parseStrictJson(textValue);
  } catch (error) {
    if (!(error instanceof StrictJsonError)) throw error;
    throw new SynbiosError(`${what} is not acceptable JSON: ${error.message}`, { code: 'invalid_response' });
  }
}

async function readCapped(response, cap) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > cap) {
    await response.body?.cancel();
    throw new SynbiosError(`Synbios response exceeds ${cap} bytes`, { code: 'too_large' });
  }
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel();
      throw new SynbiosError(`Synbios response exceeds ${cap} bytes`, { code: 'too_large' });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export class SynbiosClient {
  // Private fields keep the credential out of util.inspect and JSON output.
  #origin;
  #token;
  #fetch;
  #timeoutMs;
  #maxExportBytes;

  constructor({ baseUrl, token, fetch = globalThis.fetch, timeoutMs = 20_000, maxExportBytes = MAX_EXPORT_BYTES } = {}) {
    this.#origin = loopbackOrigin(baseUrl);
    if (token !== undefined && token !== null && (typeof token !== 'string' || !/^[\x21-\x7e]{1,512}$/.test(token))) {
      invalid('token must be printable ASCII without spaces');
    }
    if (typeof fetch !== 'function') invalid('fetch must be a function');
    for (const [label, value] of [['timeoutMs', timeoutMs], ['maxExportBytes', maxExportBytes]]) {
      if (!Number.isSafeInteger(value) || value <= 0) invalid(`${label} must be a positive integer`);
    }
    this.#token = token ?? null;
    this.#fetch = fetch;
    this.#timeoutMs = timeoutMs;
    this.#maxExportBytes = maxExportBytes;
  }

  get baseUrl() {
    return this.#origin;
  }

  toJSON() {
    return { baseUrl: this.#origin };
  }

  async discover() {
    const doc = decodeJson(await this.#request('GET', '/.well-known/synbios.json'), 'Synbios discovery document');
    if (!isPlainObject(doc)) throw new SynbiosError('Synbios discovery document is not an object', { code: 'protocol' });
    if (doc.protocol_version !== SYNBIOS_PROTOCOL_VERSION) {
      throw new SynbiosError(`Unsupported Synbios protocol_version; expected ${SYNBIOS_PROTOCOL_VERSION}`, { code: 'protocol' });
    }
    if (doc.local_only !== true) throw new SynbiosError('Synbios does not declare local_only: true', { code: 'protocol' });
    return doc;
  }

  async health() {
    return decodeJson(await this.#request('GET', '/api/health'), 'Synbios health response');
  }

  async state() {
    return decodeJson(await this.#request('GET', '/api/state', { auth: true }), 'Synbios state');
  }

  async command(name, body) {
    const fields = typeof name === 'string' && Object.hasOwn(COMMAND_FIELDS, name) ? COMMAND_FIELDS[name] : null;
    if (!fields) invalid('unknown Synbios command');
    if (!isPlainObject(body)) invalid('command body must be a plain object');
    const unknown = Object.keys(body).filter((key) => !fields.includes(key));
    if (unknown.length) invalid(`unknown ${name} fields: ${unknown.map(quoteForDisplay).join(', ')}`);
    const bytes = await this.#request('POST', `/api/commands/${name}`, { auth: true, body });
    return decodeJson(bytes, `Synbios ${name} response`);
  }

  // Returns the exact response bytes, so they can be stored and cited as an
  // artifact; the digest and ni: URI are computed over those bytes.
  async exportTask(taskId) {
    if (typeof taskId !== 'string' || !SYNBIOS_ID.test(taskId)) invalid('taskId must be a 32-character lowercase hex Synbios id');
    const bytes = await this.#request('GET', `/api/tasks/${taskId}/export`, { auth: true, cap: this.#maxExportBytes });
    const bundle = decodeJson(bytes, 'Synbios export');
    if (!isPlainObject(bundle) || bundle.format !== 'synbios-task' || bundle.version !== 1) {
      throw new SynbiosError('Synbios export is not a synbios-task version 1 bundle', { code: 'invalid_response' });
    }
    const digest = sha256Hex(bytes);
    return { bytes, digest, uri: niUri(digest) };
  }

  async #request(method, path, { auth = false, body, cap = MAX_RESPONSE_BYTES } = {}) {
    const headers = { accept: 'application/json' };
    if (auth) {
      if (!this.#token) invalid('a Synbios token is required for this request');
      headers.authorization = `Bearer ${this.#token}`;
    }
    let payload;
    if (body !== undefined) {
      // A byte body gives an exact Content-Length and no chunked encoding,
      // both of which Synbios requires.
      payload = new TextEncoder().encode(JSON.stringify(body));
      headers['content-type'] = 'application/json';
    }
    let response;
    try {
      response = await this.#fetch(this.#origin + path, {
        method,
        headers,
        body: payload,
        redirect: 'manual',
        credentials: 'omit',
        cache: 'no-store',
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      // Report only the failure class; never the request or its headers.
      const reason = error?.cause?.code ?? error?.name ?? 'error';
      throw new SynbiosError(`Synbios request failed (${String(reason).slice(0, 40)})`, { code: 'network' });
    }
    if (response.type === 'opaqueredirect' || response.redirected || (response.status >= 300 && response.status < 400)) {
      await response.body?.cancel();
      throw new SynbiosError('Synbios redirect refused', { code: 'redirect', status: response.status });
    }
    const encoding = response.headers.get('content-encoding');
    if (encoding && encoding.toLowerCase() !== 'identity') {
      await response.body?.cancel();
      throw new SynbiosError('Encoded Synbios responses are refused', { code: 'invalid_response', status: response.status });
    }
    const bytes = await readCapped(response, cap);
    if (!response.ok) {
      throw new SynbiosError(`Synbios refused the request (${response.status}): ${this.#errorText(bytes)}`, {
        code: 'http',
        status: response.status,
      });
    }
    if (!/^application\/json\s*(?:;|$)/i.test(response.headers.get('content-type') ?? '')) {
      throw new SynbiosError('Synbios response is not application/json', { code: 'invalid_response', status: response.status });
    }
    return bytes;
  }

  // Server error text is untrusted; keep it short and printable, and make sure
  // a server that echoes the credential cannot put it into an error message.
  #errorText(bytes) {
    let message = 'no error message';
    try {
      const parsed = decodeJson(bytes, 'error');
      if (isPlainObject(parsed) && typeof parsed.error === 'string') message = parsed.error;
    } catch {
      // keep the generic message
    }
    if (this.#token) message = message.split(this.#token).join('[redacted]');
    return message.replace(UNSAFE_DISPLAY, '?').slice(0, 200);
  }
}

// ---------------------------------------------------------------------------
// Export inspection

const exportError = (message) => {
  throw new SynbiosError(`Invalid Synbios export: ${message}`, { code: 'invalid_export' });
};

const TASK_STATUSES = ['open', 'claimed', 'in_progress', 'in_review', 'changes_requested', 'accepted', 'cancelled'];
const ZERO_HASH = '0'.repeat(64);

// Field shapes of the synbios-task v1 bundle. Every listed field is required
// and no other field is accepted (event payloads excepted, see below).
const isString = (value) => typeof value === 'string';
const isId = (value) => isString(value) && SYNBIOS_ID.test(value);
const isHex64 = (value) => isString(value) && HEX64.test(value);
const isPositiveInt = (value) => Number.isSafeInteger(value) && value > 0;
const oneOf = (...options) => (value) => options.includes(value);
const listOf = (check) => (value) => Array.isArray(value) && value.every(check);
const nullOr = (check) => (value) => value === null || check(value);

const SHAPES = {
  bundle: {
    version: (value) => value === 1,
    format: (value) => value === 'synbios-task',
    exported_at: isString,
    task: isPlainObject,
    project: isPlainObject,
    principals: Array.isArray,
    events: Array.isArray,
    audit_chain: Array.isArray,
    limitations: listOf(isString),
    bundle_digest: isHex64,
  },
  task: {
    id: isId,
    project_id: isId,
    title: isString,
    description: isString,
    criteria: listOf(isString),
    scope: listOf(isString),
    status: oneOf(...TASK_STATUSES),
    priority: oneOf('low', 'normal', 'high'),
    assignee_id: nullOr(isId),
    dependencies: listOf(isId),
    created_by: isId,
    created_at: isString,
    updated_at: isString,
    artifacts: Array.isArray,
    evidence: Array.isArray,
    reviews: Array.isArray,
  },
  artifact: {
    id: isId,
    task_id: isId,
    title: isString,
    kind: oneOf('git_commit', 'document'),
    revision: isString,
    digest: isHex64,
    uri: isString,
    summary: isString,
    created_by: isId,
    created_at: isString,
  },
  evidence: {
    id: isId,
    task_id: isId,
    artifact_id: isId,
    artifact_digest: isHex64,
    revision: isString,
    kind: oneOf('test', 'proof', 'analysis'),
    status: oneOf('passed', 'failed', 'unavailable'),
    command: isString,
    summary: isString,
    tool: isString,
    tool_version: isString,
    assumptions: listOf(isString),
    created_by: isId,
    created_at: isString,
  },
  review: {
    id: isId,
    task_id: isId,
    artifact_id: isId,
    revision: isString,
    decision: oneOf('approved', 'changes_requested'),
    comment: isString,
    created_by: isId,
    created_at: isString,
  },
  principal: { id: isId, name: isString, kind: oneOf('human', 'agent'), active: (value) => typeof value === 'boolean', created_at: isString },
  project: { id: isId, name: isString, description: isString, repository: isString, created_at: isString },
  event: {
    seq: isPositiveInt,
    id: isId,
    type: isString,
    actor_id: isId,
    task_id: nullOr(isId),
    created_at: isString,
    payload: isPlainObject,
    previous_hash: isHex64,
    hash: isHex64,
  },
  link: { seq: isPositiveInt, hash: isHex64, previous_hash: isHex64 },
};
const PAYLOAD_FIELDS = new Set(['state_digest', 'entity', 'task', 'sym2p_packet_hash', 'sym2p_packet_key', 'sym2p_audit']);

function checkShape(value, shapeName, path) {
  if (!isPlainObject(value)) exportError(`${path} must be an object`);
  const shape = SHAPES[shapeName];
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(shape, key)) exportError(`${path} has an unexpected field ${quoteForDisplay(key)}`);
  }
  for (const [key, check] of Object.entries(shape)) {
    if (!Object.hasOwn(value, key)) exportError(`${path}.${key} is missing`);
    if (!check(value[key])) exportError(`${path}.${key} is malformed`);
  }
}

function checkRevision(kind, revision, path) {
  const pattern = kind === 'git_commit' ? /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/ : HEX64;
  if (!pattern.test(revision)) exportError(`${path}.revision is not a full lowercase revision`);
}

function checkStructure(bundle) {
  checkShape(bundle, 'bundle', 'bundle');
  const { task } = bundle;
  checkShape(task, 'task', 'task');
  task.artifacts.forEach((artifact, index) => {
    checkShape(artifact, 'artifact', `task.artifacts[${index}]`);
    checkRevision(artifact.kind, artifact.revision, `task.artifacts[${index}]`);
  });
  task.evidence.forEach((item, index) => checkShape(item, 'evidence', `task.evidence[${index}]`));
  task.reviews.forEach((item, index) => checkShape(item, 'review', `task.reviews[${index}]`));
  checkShape(bundle.project, 'project', 'project');
  bundle.principals.forEach((item, index) => checkShape(item, 'principal', `principals[${index}]`));
  bundle.events.forEach((event, index) => {
    checkShape(event, 'event', `events[${index}]`);
    for (const key of Object.keys(event.payload)) {
      if (!PAYLOAD_FIELDS.has(key)) exportError(`events[${index}].payload has an unexpected field ${quoteForDisplay(key)}`);
    }
    if (Object.hasOwn(event.payload, 'task') && !isPlainObject(event.payload.task)) exportError(`events[${index}].payload.task must be an object`);
  });
  bundle.audit_chain.forEach((link, index) => checkShape(link, 'link', `audit_chain[${index}]`));
}

const hashOf = (value) => sha256Hex(pythonCanonicalJson(value));
const without = (object, field) => Object.fromEntries(Object.entries(object).filter(([key]) => key !== field));

// Internal consistency, the same properties the Synbios verifier checks.
// A bundle is unsigned: anyone can recompute every hash, so passing these
// checks shows consistency, not who produced the bundle.
function checkIntegrity(bundle) {
  const errors = new Set();
  const { task, events, audit_chain: links } = bundle;

  if (links.length === 0) errors.add('audit_chain is empty');
  let previous = ZERO_HASH;
  links.forEach((link, index) => {
    if (link.seq !== index + 1 || link.previous_hash !== previous) errors.add('audit_chain is not a contiguous hash chain');
    previous = link.hash;
  });

  if (events.length === 0) errors.add('bundle has no task events');
  let lastSeq = 0;
  for (const event of events) {
    if (event.seq <= lastSeq || event.seq > links.length) errors.add('task events are out of order or outside audit_chain');
    lastSeq = event.seq;
    if (hashOf(without(event, 'hash')) !== event.hash) errors.add('a task event hash does not match its contents');
    const link = links[event.seq - 1];
    if (!link || link.hash !== event.hash || link.previous_hash !== event.previous_hash) {
      errors.add('a task event does not match its audit_chain commitment');
    }
    if (event.task_id !== task.id) errors.add('bundle contains an event for another task');
  }
  const lastTask = events.at(-1)?.payload.task;
  if (!lastTask || pythonCanonicalJson(lastTask) !== pythonCanonicalJson(task)) errors.add('task does not match its last audited event');

  const artifacts = new Map();
  for (const artifact of task.artifacts) {
    if (artifacts.has(artifact.id)) errors.add('duplicate artifact id');
    artifacts.set(artifact.id, artifact);
    if (artifact.task_id !== task.id) errors.add('an artifact is bound to another task');
  }
  for (const item of task.evidence) {
    const artifact = artifacts.get(item.artifact_id);
    if (!artifact) errors.add('evidence cites an unknown artifact');
    else if (item.revision !== artifact.revision || item.artifact_digest !== artifact.digest) errors.add('evidence does not bind its artifact revision and digest');
    if (item.task_id !== task.id) errors.add('evidence is bound to another task');
  }
  for (const review of task.reviews) {
    const artifact = artifacts.get(review.artifact_id);
    if (!artifact) errors.add('a review cites an unknown artifact');
    else {
      if (review.revision !== artifact.revision) errors.add('a review does not bind its artifact revision');
      if (review.created_by === artifact.created_by) errors.add('a review is by the author of the artifact it reviews');
    }
    if (review.task_id !== task.id) errors.add('a review is bound to another task');
  }
  if (bundle.project.id !== task.project_id) errors.add('project does not match the task');

  if (task.status === 'accepted') {
    const current = task.artifacts.at(-1);
    const tests = current ? task.evidence.filter((item) => item.artifact_id === current.id && item.kind === 'test') : [];
    if (!tests.some((item) => item.status === 'passed') || tests.some((item) => item.status === 'failed')) {
      errors.add('accepted task lacks passing, non-failing test evidence for its current artifact');
    }
    const review = task.reviews.at(-1);
    if (!current || review?.decision !== 'approved' || review.artifact_id !== current.id) {
      errors.add('accepted task lacks an approving review of its current artifact');
    } else if (bundle.principals.find((principal) => principal.id === review.created_by)?.kind !== 'human') {
      errors.add('accepted task was not approved by a listed human principal');
    }
  }

  if (hashOf(without(bundle, 'bundle_digest')) !== bundle.bundle_digest) errors.add('bundle_digest does not match the bundle');
  return [...errors];
}

// Text an Exofab record should not carry into a shared or public record.
const LEAK_PATTERNS = [
  ['local file URI', /\bfile:/i],
  ['absolute local path', /(?:^|[\s"'`(=,;[])(?:~|\/[^\s/]+)\/|(?:^|[\s"'`(=,;[])(?:[A-Za-z]:\\|\\\\[^\s\\]+\\)/],
  ['email address', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/],
  ['loopback URL', /\bhttps?:\/\/(?:localhost|127\.\d+\.\d+\.\d+|\[::1\])/i],
  ['bidirectional control characters', /[\u200e\u200f\u202a-\u202e\u2066-\u2069\u061c]/],
  ['control characters', /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/],
];
const MAX_WARNINGS = 50;

function displayPath(path) {
  return path.map((part) => (typeof part === 'number' ? `[${part}]` : /^[A-Za-z_][A-Za-z0-9_]*$/.test(part) ? `.${part}` : '[?]')).join('').replace(/^\./, '');
}

// Each issue is reported once per field name, at the first place found
// (event payloads repeat the task's text).
function leakWarnings(bundle) {
  const warnings = [];
  const seen = new Set();
  const walk = (value, path) => {
    if (typeof value === 'string') {
      const field = path.findLast((part) => typeof part === 'string') ?? '';
      for (const [label, pattern] of LEAK_PATTERNS) {
        const key = `${label}\u0000${field}`;
        if (!seen.has(key) && pattern.test(value)) {
          seen.add(key);
          warnings.push(`${label} in ${displayPath(path)}; do not copy it into shared or public records`);
        }
      }
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, [...path, index]));
    } else if (isPlainObject(value)) {
      for (const [key, item] of Object.entries(value)) walk(item, [...path, key]);
    }
  };
  walk(bundle, []);
  return warnings;
}

export function inspectExport(bytes) {
  let input = bytes;
  if (typeof input === 'string') input = new TextEncoder().encode(input);
  if (!(input instanceof Uint8Array)) invalid('export must be bytes (Uint8Array) or a string');
  if (input.byteLength > MAX_EXPORT_BYTES) exportError(`larger than ${MAX_EXPORT_BYTES} bytes`);
  let bundle;
  try {
    bundle = decodeJson(input, 'export');
  } catch (error) {
    exportError(error.message);
  }
  checkStructure(bundle);

  const { task } = bundle;
  const integrityErrors = checkIntegrity(bundle);
  const principals = new Map(bundle.principals.map((principal) => [principal.id, principal]));
  const current = task.artifacts.at(-1) ?? null;
  const warnings = [];

  if (integrityErrors.length) warnings.push('export failed internal consistency checks; do not use it as a contribution artifact');
  if (task.status !== 'accepted') warnings.push(`task status is ${task.status}, not accepted`);
  if (!current) warnings.push('export has no artifact');
  else if (!task.evidence.some((item) => item.artifact_id === current.id && item.kind === 'test' && item.status === 'passed')) {
    warnings.push('current artifact has no passing test evidence');
  }
  if (task.reviews.some((review) => !principals.has(review.created_by))) warnings.push('a reviewer is not listed among the bundle principals');

  let koinos = null;
  try {
    koinos = parseKoinosReference(task.description);
    if (!koinos) warnings.push('task description carries no Koinos reference');
  } catch (error) {
    warnings.push(error.message);
  }

  const reviewer = (id) => {
    const principal = principals.get(id);
    return { id, name: principal?.name ?? null, kind: principal?.kind ?? null };
  };

  return {
    format: 'synbios-task',
    version: 1,
    task: { id: task.id, title: task.title, status: task.status, projectId: task.project_id },
    project: { id: bundle.project.id, name: bundle.project.name },
    koinos,
    artifact: current && { id: current.id, title: current.title, kind: current.kind, revision: current.revision, digest: current.digest },
    evidence: task.evidence.map((item) => ({
      kind: item.kind,
      status: item.status,
      command: item.command,
      summary: item.summary,
      tool: item.tool,
      current: item.artifact_id === current?.id,
    })),
    reviews: task.reviews.map((review) => ({
      decision: review.decision,
      reviewer: reviewer(review.created_by),
      revision: review.revision,
      current: review.artifact_id === current?.id,
    })),
    bundleDigest: bundle.bundle_digest,
    integrity: { valid: integrityErrors.length === 0, errors: integrityErrors },
    limitations: [...bundle.limitations],
    warnings: [...warnings, ...leakWarnings(bundle)].slice(0, MAX_WARNINGS),
  };
}
