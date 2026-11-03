// The hub's HTTP API (docs/prototype.md) as seen from the browser client.
// Requests go only to this page's own origin, carry no cookies, refuse
// redirects, and are size-capped before parsing. The session token is sent
// only as a bearer header and never appears in an error message. Everything a
// response contains is data for the page to display or verify, never code.
import { signText } from '/lib/koinos/crypto.mjs';
import { personProofText } from './proof.mjs';

const MiB = 1024 * 1024;
export const API_LIMITS = Object.freeze({ responseBytes: 32 * MiB, timeoutMs: 30_000 });
export const TEXT_TYPE = 'text/plain; charset=utf-8';

// A refusal or failure: status (0 when the hub could not be reached), code,
// message, and head and sequence on 409, koinosCode on a Koinos refusal.
export class HubHttpError extends Error {
  constructor(status, error = {}) {
    super(typeof error.message === 'string' ? error.message : `The hub answered with status ${status}`);
    this.name = 'HubHttpError';
    this.status = status;
    this.code = typeof error.code === 'string' ? error.code : 'http';
    for (const key of ['head', 'sequence', 'koinosCode']) if (error[key] !== undefined) this[key] = error[key];
  }
}

const decoder = new TextDecoder('utf-8', { fatal: true });

function seg(value) {
  if (typeof value !== 'string' || value === '') throw new TypeError('Path parameters must be non-empty text');
  return encodeURIComponent(value);
}

async function readCapped(response, cap) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > cap) {
    await response.body?.cancel();
    throw new HubHttpError(response.status, { code: 'too_large', message: `The hub's response is larger than ${cap} bytes` });
  }
  const chunks = [];
  let size = 0;
  const reader = response.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > cap) {
      await reader.cancel();
      throw new HubHttpError(response.status, { code: 'too_large', message: `The hub's response is larger than ${cap} bytes` });
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

function parseJson(bytes) {
  return JSON.parse(decoder.decode(bytes));
}

async function request(method, path, { token = null, json, bytes, contentType, raw = false } = {}) {
  const headers = { Accept: raw ? 'application/octet-stream' : 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (bytes !== undefined) {
    headers['Content-Type'] = contentType;
    body = bytes;
  }
  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(API_LIMITS.timeoutMs),
    });
  } catch {
    throw new HubHttpError(0, { code: 'network', message: 'Could not reach the hub. Check that it is still running (npm start), then try again.' });
  }
  const data = await readCapped(response, API_LIMITS.responseBytes);
  if (!response.ok) {
    let error = {};
    try {
      const parsed = parseJson(data)?.error;
      if (parsed && typeof parsed === 'object') error = parsed;
    } catch {
      // Not a JSON error body; the status still says what happened.
    }
    throw new HubHttpError(response.status, error);
  }
  if (raw) return data;
  try {
    return parseJson(data);
  } catch {
    throw new HubHttpError(response.status, { code: 'bad_response', message: 'The hub sent a response that is not valid JSON' });
  }
}

// Registers a person: asks for a challenge, signs the proof text with the
// browser-held key, and returns {person, token}. The token is shown only once.
export async function registerPerson({ identity, name }) {
  const { nonce } = await request('POST', '/api/challenges', { json: {} });
  if (typeof nonce !== 'string' || nonce === '') throw new HubHttpError(200, { code: 'bad_response', message: 'The hub sent no challenge' });
  const signature = await signText(identity.privateKey, personProofText(nonce, identity.id));
  return request('POST', '/api/people', { json: { name, key: identity.id, nonce, signature } });
}

// The API acting with one identity's session token.
export function hubClient(token) {
  const call = (method, path, options = {}) => request(method, path, { ...options, token });
  return {
    me: () => call('GET', '/api/me'),
    updateProfile: (profile) => call('PUT', '/api/me/profile', { json: profile }),
    listPeople: () => call('GET', '/api/people'),
    getPerson: (id) => call('GET', `/api/people/${seg(id)}`),
    credit: (id) => call('GET', `/api/people/${seg(id)}/credit`),
    publishBrief: (brief) => call('POST', '/api/briefs', { json: brief }),
    listBriefs: () => call('GET', '/api/briefs'),
    getBrief: (id) => call('GET', `/api/briefs/${seg(id)}`),
    updateBrief: (id, changes) => call('PATCH', `/api/briefs/${seg(id)}`, { json: changes }),
    suggestions: () => call('GET', '/api/suggestions'),
    briefSuggestions: (id) => call('GET', `/api/briefs/${seg(id)}/suggestions`),
    expressInterest: (id, interest) => call('POST', `/api/briefs/${seg(id)}/interests`, { json: interest }),
    withdrawInterest: (id) => call('POST', `/api/interests/${seg(id)}/withdraw`, { json: {} }),
    decideInterest: (id, decision) => call('POST', `/api/interests/${seg(id)}/decision`, { json: { decision } }),
    nominateAgent: (id, agent) => call('POST', `/api/briefs/${seg(id)}/agents`, { json: { agent } }),
    genesisDraft: (id) => call('GET', `/api/briefs/${seg(id)}/genesis`),
    startProject: (id, record) => call('POST', `/api/briefs/${seg(id)}/project`, { json: record }),
    listProjects: () => call('GET', '/api/projects'),
    getProject: (pid) => call('GET', `/api/projects/${seg(pid)}`),
    getBundle: (pid) => call('GET', `/api/projects/${seg(pid)}/bundle`),
    appendRecord: (pid, record) => call('POST', `/api/projects/${seg(pid)}/records`, { json: record }),
    putBlob: (pid, bytes, contentType = 'application/octet-stream') => call('POST', `/api/projects/${seg(pid)}/blobs`, { bytes, contentType }),
    getBlob: (pid, digest) => call('GET', `/api/projects/${seg(pid)}/blobs/${seg(digest)}`, { raw: true }),
  };
}
