// Loopback HTTP API and static browser client for the Exofab prototype.
//
// Every API route maps to one Hub method; the hub enforces the policies and
// the server only guards the transport: it binds 127.0.0.1, accepts only its
// own Host and Origin, requires exact content types, caps and strictly parses
// bodies, and resolves bearer tokens. Static files come from a whitelist built
// at start-up, matched by exact path, so no request path reaches the file
// system.
import { createServer as createHttpServer } from 'node:http';
import { open, readdir, constants } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLE_FORMAT, KoinosError, PROTOCOL } from './koinos/index.mjs';
import { parseStrictJson, StrictJsonError } from './json/strict.mjs';
import { HubError } from './hub/errors.mjs';
import { StoreError } from './hub/store.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DEFAULT_WEB_DIR = join(ROOT, 'web');
export const DEFAULT_LIB_DIR = join(ROOT, 'src', 'koinos');
export const LOOPBACK = '127.0.0.1';

function readVersion() {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
export const VERSION = readVersion();

const MiB = 1024 * 1024;
export const SERVER_LIMITS = Object.freeze({
  jsonBytes: MiB,
  blobBytes: 4 * MiB,
  // How much of an over-size body is read and discarded before the connection is cut.
  drainBytes: 16 * MiB,
  requestMs: 30_000,
  headersMs: 10_000,
  keepAliveMs: 5_000,
  connections: 128,
  closeGraceMs: 2_000,
});

export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
  "frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
});

export const HEALTH = Object.freeze({ name: 'exofab', version: VERSION, local_only: true, records: PROTOCOL, bundle: BUNDLE_FORMAT });

// What the hub will and will not do. Actions are hub actions and the Koinos
// record kinds they produce, named as verbs.
export const DISCOVERY = Object.freeze({
  name: 'exofab',
  version: VERSION,
  local_only: true,
  records: PROTOCOL,
  bundle: BUNDLE_FORMAT,
  hub_signs_records: false,
  agent_actions: Object.freeze(['contribution.submit']),
  human_only: Object.freeze([
    'profile.update',
    'brief.publish',
    'brief.update',
    'interest.express',
    'interest.withdraw',
    'interest.decide',
    'agent.register',
    'agent.nominate',
    'project.start',
    'agreement.propose',
    'agreement.consent',
    'agreement.withdraw',
    'delegation.grant',
    'delegation.revoke',
    'contribution.review',
    'contribution.accept',
    'contribution.dispute',
  ]),
  payments: false,
  economic_rights: false,
  ranking: false,
});

const STATIC_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
});
const STATIC_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*(\.[A-Za-z0-9]+)$/;
const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);

// --- Errors -----------------------------------------------------------------------------

// Transport-level refusals; hub refusals arrive as HubError.
class HttpError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }

  toJSON() {
    return { code: this.code, message: this.message };
  }
}

const unauthenticated = (message) => new HttpError(401, 'unauthenticated', message, { 'WWW-Authenticate': 'Bearer' });

// Maps any thrown value to {status, body, headers}. Internal details are
// logged, never sent.
function errorResponse(error, log) {
  if (error instanceof HttpError || error instanceof HubError) {
    const headers = error.status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {};
    return { status: error.status, body: error.toJSON(), headers: { ...headers, ...(error.headers ?? {}) } };
  }
  if (error instanceof StrictJsonError) {
    if (error.code === 'too_large') return { status: 413, body: { code: 'too_large', message: error.message } };
    return { status: 400, body: { code: 'invalid_json', message: `Request body is not strict JSON: ${error.message}` } };
  }
  if (error instanceof KoinosError) return { status: 422, body: { code: 'koinos', message: error.message, koinosCode: error.code } };
  if (error instanceof StoreError && error.code === 'invalid') return { status: 422, body: { code: 'invalid', message: error.message } };
  log(`exofab server: ${error?.name ?? 'Error'}: ${error?.message ?? error}`);
  // Only this change is refused; the stored data is unchanged and still loads.
  if (error instanceof StoreError && error.code === 'full') {
    return { status: 507, body: { code: 'storage_full', message: 'The hub has reached a storage limit, so this change was not stored; see the server log' } };
  }
  if (error instanceof StoreError) {
    return { status: 500, body: { code: 'storage', message: 'The hub refused to use its stored data because a check failed; see the server log' } };
  }
  return { status: 500, body: { code: 'internal', message: 'Internal error; see the server log' } };
}

// --- Routes -----------------------------------------------------------------------------

// input: 'json' (an object body), 'none' (empty or {}), 'blob' (raw bytes).
// GET routes take no input. output: 'json' or 'blob'.
function route(method, path, run, { auth = true, input = 'json', status = 200, output = 'json' } = {}) {
  return { method, path, segments: path.split('/').slice(1), run, auth, input: method === 'GET' ? null : input, status, output };
}

const ROUTES = [
  route('GET', '/api/health', () => HEALTH, { auth: false }),
  route('GET', '/.well-known/exofab.json', () => DISCOVERY, { auth: false }),
  route('POST', '/api/challenges', ({ hub }) => hub.challenge(), { auth: false, input: 'none', status: 201 }),
  route('POST', '/api/people', ({ hub, body }) => hub.registerPerson(body), { auth: false, status: 201 }),
  route('POST', '/api/agents', ({ hub, auth, body }) => hub.registerAgent(auth, body), { status: 201 }),
  route('GET', '/api/me', ({ hub, auth }) => hub.me(auth)),
  route('PUT', '/api/me/profile', ({ hub, auth, body }) => hub.updateProfile(auth, body)),
  route('GET', '/api/people', ({ hub, auth }) => hub.listPeople(auth)),
  route('GET', '/api/people/:id', ({ hub, auth, params }) => hub.getPerson(auth, params.id)),
  route('GET', '/api/people/:id/credit', ({ hub, auth, params }) => hub.credit(auth, params.id)),
  route('POST', '/api/briefs', ({ hub, auth, body }) => hub.publishBrief(auth, body), { status: 201 }),
  route('GET', '/api/briefs', ({ hub, auth }) => hub.listBriefs(auth)),
  route('GET', '/api/briefs/:id', ({ hub, auth, params }) => hub.getBrief(auth, params.id)),
  route('PATCH', '/api/briefs/:id', ({ hub, auth, params, body }) => hub.updateBrief(auth, params.id, body)),
  route('GET', '/api/suggestions', ({ hub, auth }) => hub.suggestions(auth)),
  route('GET', '/api/briefs/:id/suggestions', ({ hub, auth, params }) => hub.briefSuggestions(auth, params.id)),
  route('POST', '/api/briefs/:id/interests', ({ hub, auth, params, body }) => hub.expressInterest(auth, params.id, body), { status: 201 }),
  route('POST', '/api/interests/:id/withdraw', ({ hub, auth, params }) => hub.withdrawInterest(auth, params.id), { input: 'none' }),
  route('POST', '/api/interests/:id/decision', ({ hub, auth, params, body }) => hub.decideInterest(auth, params.id, body)),
  route('POST', '/api/briefs/:id/agents', ({ hub, auth, params, body }) => hub.nominateAgent(auth, params.id, body)),
  route('GET', '/api/briefs/:id/genesis', ({ hub, auth, params }) => hub.genesisDraft(auth, params.id)),
  route('POST', '/api/briefs/:id/project', ({ hub, auth, params, body }) => hub.startProject(auth, params.id, body), { status: 201 }),
  route('GET', '/api/projects', ({ hub, auth }) => hub.listProjects(auth)),
  route('GET', '/api/projects/:pid', ({ hub, auth, params }) => hub.getProject(auth, params.pid)),
  route('GET', '/api/projects/:pid/bundle', ({ hub, auth, params }) => hub.getBundle(auth, params.pid)),
  route('POST', '/api/projects/:pid/records', ({ hub, auth, params, body }) => hub.appendRecord(auth, params.pid, body), { status: 201 }),
  route('POST', '/api/projects/:pid/blobs', ({ hub, auth, params, body }) => hub.putBlob(auth, params.pid, body), { input: 'blob', status: 201 }),
  route('GET', '/api/projects/:pid/blobs/:digest', ({ hub, auth, params }) => hub.getBlob(auth, params.pid, params.digest), { output: 'blob' }),
];

// The routes as data, for documentation checks: {method, path, auth, input}.
export const API_ROUTES = Object.freeze(ROUTES.map(({ method, path, auth, input }) => Object.freeze({ method, path, auth, input })));

// Literal segments match raw; parameters are percent-decoded and non-empty.
function matchSegments(segments, raw) {
  if (segments.length !== raw.length) return null;
  const params = {};
  for (let i = 0; i < segments.length; i++) {
    const want = segments[i];
    if (want.startsWith(':')) {
      if (raw[i] === '') return null;
      try {
        params[want.slice(1)] = decodeURIComponent(raw[i]);
      } catch {
        throw new HttpError(400, 'bad_request', 'Request path has invalid percent-encoding');
      }
    } else if (want !== raw[i]) {
      return null;
    }
  }
  return params;
}

function findRoute(method, path) {
  const raw = path.split('/').slice(1);
  const allowed = [];
  for (const r of ROUTES) {
    const params = matchSegments(r.segments, raw);
    if (!params) continue;
    if (r.method === method) return { route: r, params };
    allowed.push(r.method);
  }
  return allowed.length ? { allowed } : null;
}

// --- Request guards ---------------------------------------------------------------------

// Only the origin-form path is accepted; the query is ignored.
function requestPath(url) {
  if (typeof url !== 'string' || !url.startsWith('/')) throw new HttpError(400, 'bad_request', 'Request target must be a path');
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
}

// DNS rebinding defence: the Host must name this loopback server.
function checkHost(req, port) {
  const host = (req.headers.host ?? '').toLowerCase();
  if (host !== `${LOOPBACK}:${port}` && host !== `localhost:${port}`) {
    throw new HttpError(421, 'misdirected', 'This hub answers only to its own loopback address');
  }
  return host;
}

// A browser request from any other origin is refused, whatever its method.
function checkOrigin(req, host, path) {
  const origin = req.headers.origin;
  if (origin !== undefined && origin.toLowerCase() !== `http://${host}`) {
    throw new HttpError(403, 'cross_origin', 'Cross-origin requests are refused');
  }
  const site = req.headers['sec-fetch-site'];
  if ((path.startsWith('/api/') || path.startsWith('/.well-known/')) && (site === 'cross-site' || site === 'same-site')) {
    throw new HttpError(403, 'cross_origin', 'Cross-origin requests are refused');
  }
}

// Parses "type/subtype; name=value" into a lowercase type and parameters.
function mediaType(header) {
  if (typeof header !== 'string') return null;
  const [type, ...rest] = header.split(';');
  const params = {};
  for (const part of rest) {
    const eq = part.indexOf('=');
    if (eq === -1) return null;
    const name = part.slice(0, eq).trim().toLowerCase();
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
    params[name] = value.toLowerCase();
  }
  return { type: type.trim().toLowerCase(), params };
}

function checkContentType(req, input) {
  const media = mediaType(req.headers['content-type']);
  const charset = media?.params.charset;
  if (input === 'blob') {
    if (media?.type === 'application/octet-stream' && Object.keys(media.params).length === 0) return { text: false };
    if (media?.type === 'text/plain' && charset === 'utf-8' && Object.keys(media.params).length === 1) return { text: true };
    throw new HttpError(415, 'unsupported_media_type', 'Upload bytes as application/octet-stream or text/plain; charset=utf-8');
  }
  const extra = Object.keys(media?.params ?? {}).filter((k) => k !== 'charset');
  if (media?.type !== 'application/json' || extra.length || (charset !== undefined && charset !== 'utf-8')) {
    throw new HttpError(415, 'unsupported_media_type', 'Send the request body as application/json');
  }
  return { text: true };
}

// Past the cap, the rest of a body is read and thrown away, up to
// SERVER_LIMITS.drainBytes in total, and the connection stays open. Closing
// at once would reset the connection while the client is still sending, and
// on some platforms the client then sees a broken pipe instead of the 413. A
// body that grows beyond drainBytes is cut off by destroying the connection.
function discardRest(req, alreadyRead) {
  let seen = alreadyRead;
  req.on('data', (chunk) => {
    seen += chunk.length;
    if (seen > SERVER_LIMITS.drainBytes) req.destroy();
  });
  req.resume();
}

function tooLarge(cap, headers = {}) {
  return new HttpError(413, 'too_large', `Request body is larger than ${cap} bytes`, headers);
}

// Reads at most `cap` bytes, refusing larger bodies with 413.
function readBody(req, cap) {
  return new Promise((resolve, reject) => {
    const declared = req.headers['content-length'];
    if (declared !== undefined && Number(declared) > cap) {
      if (Number(declared) > SERVER_LIMITS.drainBytes) {
        // Not worth reading: answer and close.
        req.resume();
        reject(tooLarge(cap, { Connection: 'close' }));
      } else {
        discardRest(req, 0);
        reject(tooLarge(cap));
      }
      return;
    }
    const chunks = [];
    let size = 0;
    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > cap) {
        cleanup();
        discardRest(req, size);
        reject(tooLarge(cap));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks, size));
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

async function readInput(req, input) {
  if (input === null) return undefined;
  const { text } = checkContentType(req, input);
  const cap = input === 'blob' ? SERVER_LIMITS.blobBytes : SERVER_LIMITS.jsonBytes;
  const buffer = await readBody(req, cap);
  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (input === 'blob') {
    if (text) {
      try {
        utf8Decoder.decode(bytes);
      } catch {
        throw new HttpError(400, 'bad_request', 'Body declared as UTF-8 text is not valid UTF-8');
      }
    }
    return bytes;
  }
  if (input === 'none') {
    if (bytes.length === 0) return undefined;
    const value = parseStrictJson(bytes, { maxBytes: cap });
    if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 0) {
      throw new HttpError(422, 'invalid', 'This request takes no fields');
    }
    return undefined;
  }
  if (bytes.length === 0) throw new HttpError(400, 'invalid_json', 'Request body must be a JSON value');
  return parseStrictJson(bytes, { maxBytes: cap });
}

const BEARER = /^Bearer ([^\s]+)$/i;

async function resolveAuth(req, hub) {
  const header = req.headers.authorization;
  if (header === undefined) throw unauthenticated('Sign in first: send Authorization: Bearer <token>');
  const match = BEARER.exec(header);
  const auth = match ? await hub.authenticate(match[1]) : null;
  if (!auth) throw unauthenticated('The bearer token is not valid for this hub');
  return auth;
}

// --- Responses --------------------------------------------------------------------------

function send(res, status, headers, body, { isApi, head = false }) {
  if (res.headersSent || res.destroyed) return;
  res.statusCode = status;
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  res.setHeader('Cache-Control', isApi ? 'no-store' : 'no-cache');
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.setHeader('Content-Length', body.length);
  res.end(head ? undefined : body);
}

function sendJson(res, status, value, headers, options) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  send(res, status, { 'Content-Type': 'application/json; charset=utf-8', ...headers }, body, options);
}

// --- Static whitelist -------------------------------------------------------------------

// Maps exact request paths to files present at start-up: "/" and /app/<file>
// from webDir, /lib/koinos/<name>.mjs from libDir. Only regular files with
// known extensions are listed; symbolic links and subdirectories are not.
async function staticWhitelist(webDir, libDir) {
  const files = new Map();
  const add = async (dir, prefix, allow) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const match = STATIC_NAME.exec(entry.name);
      if (!entry.isFile() || !match || !allow(match[1])) continue;
      files.set(`${prefix}${entry.name}`, { path: join(dir, entry.name), type: STATIC_TYPES[match[1]] });
    }
  };
  await add(webDir, '/app/', (ext) => Object.hasOwn(STATIC_TYPES, ext));
  await add(libDir, '/lib/koinos/', (ext) => ext === '.mjs');
  const index = files.get('/app/index.html');
  if (!index) throw new Error('The web directory has no index.html');
  files.set('/', index);
  return files;
}

// A whitelisted file that has since gone, or become a link or a directory, is not found.
async function readStatic(path) {
  let handle;
  try {
    handle = await open(path, READ_FLAGS);
  } catch (error) {
    if (['ENOENT', 'ELOOP', 'ENOTDIR'].includes(error.code)) return null;
    throw error;
  }
  try {
    return (await handle.stat()).isFile() ? await handle.readFile() : null;
  } finally {
    await handle.close();
  }
}

// --- Server -----------------------------------------------------------------------------

// Starts the hub's HTTP server and resolves once it listens:
// {server, host, port, url, close()}. Port 0 picks a free port.
export async function createServer({
  hub,
  webDir = DEFAULT_WEB_DIR,
  libDir = DEFAULT_LIB_DIR,
  port = 4317,
  host = LOOPBACK,
  log = (message) => process.stderr.write(`${message}\n`),
} = {}) {
  if (!hub) throw new TypeError('createServer needs a hub');
  if (host !== LOOPBACK) throw new Error(`The prototype binds to ${LOOPBACK} only`);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('port must be an integer from 0 to 65535');
  await hub.load(); // a hub log that does not verify stops start-up (fail closed)
  const files = await staticWhitelist(webDir, libDir);
  let boundPort;

  async function handle(req, res) {
    let isApi = true;
    try {
      const hostHeader = checkHost(req, boundPort);
      const path = requestPath(req.url);
      isApi = path.startsWith('/api/') || path.startsWith('/.well-known/');
      checkOrigin(req, hostHeader, path);
      const found = findRoute(req.method, path);
      if (found?.route) return await api(req, res, found.route, found.params);
      if (found?.allowed) throw new HttpError(405, 'method_not_allowed', 'Method not allowed', { Allow: found.allowed.join(', ') });
      const file = isApi ? undefined : files.get(path);
      if (!file) throw new HttpError(404, 'not_found', 'Not found');
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        throw new HttpError(405, 'method_not_allowed', 'Method not allowed', { Allow: 'GET, HEAD' });
      }
      const body = await readStatic(file.path);
      if (!body) throw new HttpError(404, 'not_found', 'Not found');
      send(res, 200, { 'Content-Type': file.type }, body, { isApi: false, head: req.method === 'HEAD' });
    } catch (error) {
      const { status, body, headers = {} } = errorResponse(error, log);
      sendJson(res, status, { error: body }, headers, { isApi, head: req.method === 'HEAD' });
    }
  }

  async function api(req, res, r, params) {
    const auth = r.auth ? await resolveAuth(req, hub) : null;
    const body = await readInput(req, r.input);
    const result = await r.run({ hub, auth, params, body });
    if (r.output === 'blob') {
      const bytes = Buffer.from(result.buffer, result.byteOffset, result.byteLength);
      const headers = { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${params.digest}"` };
      send(res, 200, headers, bytes, { isApi: true });
      return;
    }
    sendJson(res, r.status, result, {}, { isApi: true });
  }

  const server = createHttpServer(
    {
      requestTimeout: SERVER_LIMITS.requestMs,
      headersTimeout: SERVER_LIMITS.headersMs,
      keepAliveTimeout: SERVER_LIMITS.keepAliveMs,
    },
    (req, res) => {
      handle(req, res).catch((error) => {
        log(`exofab server: ${error?.message ?? error}`);
        res.destroy();
      });
    },
  );
  server.maxConnections = SERVER_LIMITS.connections;
  server.on('clientError', (error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    else socket.destroy();
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ port, host: LOOPBACK, exclusive: true }, () => {
      server.off('error', reject);
      resolve();
    });
  });
  boundPort = server.address().port;

  let closing = null;
  // Stops accepting connections, lets requests in flight finish, and closes
  // any connection still open after a short grace period.
  const close = () => {
    closing ??= new Promise((resolve) => {
      const timer = setTimeout(() => server.closeAllConnections(), SERVER_LIMITS.closeGraceMs);
      timer.unref();
      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
      server.closeIdleConnections();
    });
    return closing;
  };

  return { server, host: LOOPBACK, port: boundPort, url: `http://${LOOPBACK}:${boundPort}`, close };
}
