// HTTP client for a local Exofab hub, used by the command line and the
// demonstration. One method per route of src/server.mjs, plus helpers that
// prove key possession at registration and that draft, check, sign and append
// a record on the current head (retrying when the head moves).
//
// The bearer token is kept in a private field: it is never part of an error
// message, JSON.stringify or util.inspect output.
import { checkDraft, draftRecord, signDraft, signText } from './koinos/index.mjs';
import { parseStrictJson } from './json/strict.mjs';
import { agentProofText, personProofText } from './hub/hub.mjs';

const MiB = 1024 * 1024;
export const CLIENT_LIMITS = Object.freeze({ responseBytes: 64 * MiB, timeoutMs: 30_000, appendAttempts: 3 });
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

// A refusal from the hub: status, code, and any details it sent (head and
// sequence on 409, koinosCode on a Koinos refusal).
export class ExofabHttpError extends Error {
  constructor(status, error = {}) {
    const code = typeof error.code === 'string' ? error.code : 'http';
    super(typeof error.message === 'string' ? error.message : `Hub answered ${status}`);
    this.name = 'ExofabHttpError';
    this.status = status;
    this.code = code;
    for (const key of ['head', 'sequence', 'koinosCode']) if (error[key] !== undefined) this[key] = error[key];
  }
}

// Only http on the loopback interface: a bearer token must not cross a network.
function checkBaseUrl(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new TypeError('baseUrl must be an absolute URL');
  }
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname) || url.username || url.password) {
    throw new TypeError('baseUrl must be http://127.0.0.1:<port> or http://localhost:<port>');
  }
  if (url.pathname !== '/' || url.search || url.hash) throw new TypeError('baseUrl must not have a path, query or fragment');
  return url.origin;
}

async function readCapped(response, cap) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > cap) {
    await response.body?.cancel();
    throw new Error(`Hub response is larger than ${cap} bytes`);
  }
  const chunks = [];
  let size = 0;
  if (response.body) {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > cap) throw new Error(`Hub response is larger than ${cap} bytes`);
      chunks.push(chunk);
    }
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

const seg = (value) => {
  if (typeof value !== 'string' || value === '') throw new TypeError('Path parameters must be non-empty strings');
  return encodeURIComponent(value);
};

export class ExofabClient {
  #origin;
  #token;
  #fetch;
  #timeoutMs;

  constructor({ baseUrl, token = null, fetch = globalThis.fetch, timeoutMs = CLIENT_LIMITS.timeoutMs } = {}) {
    this.#origin = checkBaseUrl(baseUrl);
    if (token !== null && typeof token !== 'string') throw new TypeError('token must be a string or null');
    this.#token = token;
    this.#fetch = fetch;
    this.#timeoutMs = timeoutMs;
  }

  get baseUrl() {
    return this.#origin;
  }

  get authenticated() {
    return this.#token !== null;
  }

  // A client for the same hub acting with another token.
  withToken(token) {
    return new ExofabClient({ baseUrl: this.#origin, token, fetch: this.#fetch, timeoutMs: this.#timeoutMs });
  }

  toJSON() {
    return { baseUrl: this.#origin };
  }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    return `ExofabClient { baseUrl: '${this.#origin}', authenticated: ${this.authenticated} }`;
  }

  async #request(method, path, { json, bytes, contentType, raw = false } = {}) {
    const headers = { Accept: raw ? 'application/octet-stream' : 'application/json' };
    if (this.#token !== null) headers.Authorization = `Bearer ${this.#token}`;
    let body;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (bytes !== undefined) {
      headers['Content-Type'] = contentType;
      body = bytes;
    }
    const response = await this.#fetch(`${this.#origin}${path}`, {
      method,
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new ExofabHttpError(response.status, { code: 'redirect', message: 'The hub answered with a redirect, which this client does not follow' });
    }
    const data = await readCapped(response, CLIENT_LIMITS.responseBytes);
    if (!response.ok) {
      let error = {};
      try {
        error = parseStrictJson(data, { maxBytes: CLIENT_LIMITS.responseBytes })?.error ?? {};
      } catch {
        // Not a JSON error body; the status still says what happened.
      }
      throw new ExofabHttpError(response.status, error ?? {});
    }
    if (raw) return data;
    return parseStrictJson(data, { maxBytes: CLIENT_LIMITS.responseBytes });
  }

  // --- Discovery and registration --------------------------------------------------

  health() {
    return this.#request('GET', '/api/health');
  }

  discovery() {
    return this.#request('GET', '/.well-known/exofab.json');
  }

  challenge() {
    return this.#request('POST', '/api/challenges', { json: {} });
  }

  // Signs a fresh challenge with identity.privateKey (proof of possession).
  // Returns {person, token}; the token is shown only this once.
  async registerPerson({ name, identity }) {
    const { nonce } = await this.challenge();
    const signature = await signText(identity.privateKey, personProofText(nonce, identity.id));
    return this.#request('POST', '/api/people', { json: { name, key: identity.id, nonce, signature } });
  }

  // Registers an agent under the signed-in person; the agent's own key signs
  // the proof. Returns {agent, token}.
  async registerAgent({ name, identity, principal }) {
    principal ??= (await this.me()).id;
    const { nonce } = await this.challenge();
    const signature = await signText(identity.privateKey, agentProofText(nonce, identity.id, principal));
    return this.#request('POST', '/api/agents', { json: { name, key: identity.id, nonce, signature } });
  }

  // --- People ----------------------------------------------------------------------

  me() {
    return this.#request('GET', '/api/me');
  }

  updateProfile(profile) {
    return this.#request('PUT', '/api/me/profile', { json: profile });
  }

  listPeople() {
    return this.#request('GET', '/api/people');
  }

  getPerson(id) {
    return this.#request('GET', `/api/people/${seg(id)}`);
  }

  credit(id) {
    return this.#request('GET', `/api/people/${seg(id)}/credit`);
  }

  // --- Briefs, interests and teams ---------------------------------------------------

  publishBrief(brief) {
    return this.#request('POST', '/api/briefs', { json: brief });
  }

  listBriefs() {
    return this.#request('GET', '/api/briefs');
  }

  getBrief(id) {
    return this.#request('GET', `/api/briefs/${seg(id)}`);
  }

  updateBrief(id, changes) {
    return this.#request('PATCH', `/api/briefs/${seg(id)}`, { json: changes });
  }

  suggestions() {
    return this.#request('GET', '/api/suggestions');
  }

  briefSuggestions(id) {
    return this.#request('GET', `/api/briefs/${seg(id)}/suggestions`);
  }

  expressInterest(briefId, { role, note }) {
    return this.#request('POST', `/api/briefs/${seg(briefId)}/interests`, { json: note === undefined ? { role } : { role, note } });
  }

  withdrawInterest(id) {
    return this.#request('POST', `/api/interests/${seg(id)}/withdraw`, { json: {} });
  }

  decideInterest(id, decision) {
    return this.#request('POST', `/api/interests/${seg(id)}/decision`, { json: { decision } });
  }

  nominateAgent(briefId, agent) {
    return this.#request('POST', `/api/briefs/${seg(briefId)}/agents`, { json: { agent } });
  }

  genesisDraft(briefId) {
    return this.#request('GET', `/api/briefs/${seg(briefId)}/genesis`);
  }

  startProject(briefId, record) {
    return this.#request('POST', `/api/briefs/${seg(briefId)}/project`, { json: record });
  }

  // --- Projects and bytes -------------------------------------------------------------

  listProjects() {
    return this.#request('GET', '/api/projects');
  }

  getProject(pid) {
    return this.#request('GET', `/api/projects/${seg(pid)}`);
  }

  getBundle(pid) {
    return this.#request('GET', `/api/projects/${seg(pid)}/bundle`);
  }

  appendRecord(pid, record) {
    return this.#request('POST', `/api/projects/${seg(pid)}/records`, { json: record });
  }

  // contentType: 'application/octet-stream' or 'text/plain; charset=utf-8'.
  putBlob(pid, bytes, contentType = 'application/octet-stream') {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('bytes must be a Uint8Array');
    return this.#request('POST', `/api/projects/${seg(pid)}/blobs`, { bytes, contentType });
  }

  getBlob(pid, digest) {
    return this.#request('GET', `/api/projects/${seg(pid)}/blobs/${seg(digest)}`, { raw: true });
  }

  // --- Signing helpers -------------------------------------------------------------------

  // Asks for the genesis draft, signs project.created as the brief owner, and
  // starts the record. Returns {project, head, count}.
  async startSigned({ briefId, identity }) {
    const { project, body } = await this.genesisDraft(briefId);
    const draft = await draftRecord({ records: [], actor: identity.id, kind: 'project.created', body, project });
    await checkDraft([], draft);
    return this.startProject(briefId, await signDraft(draft, identity.privateKey));
  }

  // Drafts a record on the current head, checks every Koinos rule except the
  // signature, signs it, and appends it. If the head moved meanwhile (409),
  // it fetches the project again and signs a new record, up to `attempts`
  // times in all. Returns {head, count, state, record}.
  async appendSigned({ pid, identity, kind, body, attempts = CLIENT_LIMITS.appendAttempts }) {
    for (let attempt = 1; ; attempt++) {
      const { records } = await this.getProject(pid);
      const draft = await draftRecord({ records, actor: identity.id, kind, body });
      await checkDraft(records, draft);
      const record = await signDraft(draft, identity.privateKey);
      try {
        return { ...(await this.appendRecord(pid, record)), record };
      } catch (error) {
        if (!(error instanceof ExofabHttpError) || error.status !== 409 || attempt >= attempts) throw error;
      }
    }
  }
}
