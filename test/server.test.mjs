// Tests for the loopback HTTP server (src/server.mjs) and the HTTP client
// (src/client.mjs): authentication on every route, the Host, Origin,
// content-type and size guards, the static whitelist and traversal attempts,
// security headers, and the 409 path. Synthetic people Ada and Ben and the
// agent scribe; each test uses its own temporary data directory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { connect } from 'node:net';
import { inspect } from 'node:util';
import { mkdtemp, readFile, rm, symlink, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileStore } from '../src/hub/store.mjs';
import { Hub } from '../src/hub/hub.mjs';
import { API_ROUTES, CSP, DISCOVERY, createServer } from '../src/server.mjs';
import { ExofabClient, ExofabHttpError } from '../src/client.mjs';
import { draftRecord, generateIdentity, signDraft, sha256Hex, utf8 } from '../src/koinos/index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MiB = 1024 * 1024;
const NO_PROJECT = '00000000-0000-4000-8000-000000000000';
const ZERO_DIGEST = '0'.repeat(64);
const BRIEF = {
  title: 'Recipe-scaling skill (synthetic)',
  summary: 'Synthetic test brief.',
  compensation: 'None offered. Credit is recorded for accepted work only.',
  roles: [{ title: 'Skill builder', skills: ['exo-skills', 'testing'], commitment: 'A few evenings' }],
  listed: true,
};
const quiet = () => {};

// --- Harness -------------------------------------------------------------------------------

async function startHub(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'exofab-server-'));
  const handle = await createServer({ hub: new Hub({ store: new FileStore(dir) }), port: 0, log: quiet, ...options });
  t.after(async () => {
    await handle.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, handle, port: handle.port, anon: new ExofabClient({ baseUrl: handle.url }) };
}

// A raw HTTP/1.1 request, so tests control Host, Origin, the exact path and the body.
function raw(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const all = { Host: `127.0.0.1:${port}`, ...headers };
    if (body !== undefined) all['Content-Length'] = Buffer.byteLength(body);
    const req = request({ host: '127.0.0.1', port, method, path, headers: all, setHost: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, body: buffer, json: () => JSON.parse(buffer.toString('utf8')) });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

// An over-size upload on a raw socket. The client sends enough for the hub to
// refuse (the declared length, or more than 1 MiB of a chunked body), waits
// for the answer, keeps sending the rest of its body, and then sends a second
// request on the same connection. A hub that closes the connection as soon as
// it refuses makes those writes fail (EPIPE or ECONNRESET, depending on the
// platform). Resolves with both status lines.
function oversizedUploadThenReuse(port, declared) {
  const piece = Buffer.alloc(64 * 1024, 0x20);
  const pieces = 20;
  const beforeAnswer = declared ? 1 : 17; // 17 pieces = 1.0625 MiB, past the JSON cap
  const frame = (buf) => (declared ? buf : Buffer.concat([Buffer.from(`${buf.length.toString(16)}\r\n`), buf, Buffer.from('\r\n')]));
  const head = [
    'POST /api/people HTTP/1.1',
    `Host: 127.0.0.1:${port}`,
    'Content-Type: application/json',
    declared ? `Content-Length: ${piece.length * pieces}` : 'Transfer-Encoding: chunked',
    '', '',
  ].join('\r\n');
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    let received = '';
    let state = 'first';
    const write = (data) => new Promise((ok, fail) => socket.write(data, (error) => (error ? fail(error) : ok())));
    const statuses = () => [...received.matchAll(/^HTTP\/1\.1 (\d{3})/gm)].map((m) => Number(m[1]));
    socket.on('error', reject);
    socket.on('end', () => reject(new Error(`hub closed the connection after: ${statuses().join(', ') || 'nothing'}`)));
    socket.on('data', async (data) => {
      received += data.toString('latin1');
      if (state === 'first' && statuses().length === 1) {
        state = 'rest';
        try {
          await new Promise((r) => setTimeout(r, 50));
          for (let i = beforeAnswer; i < pieces; i++) await write(frame(piece));
          if (!declared) await write('0\r\n\r\n');
          await write(`GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`);
        } catch (error) {
          reject(error);
        }
      } else if (state === 'rest' && statuses().length === 2) {
        state = 'done';
        socket.removeAllListeners('end');
        socket.destroy();
        resolve(statuses());
      }
    });
    socket.write(head);
    for (let i = 0; i < beforeAnswer; i++) socket.write(frame(piece));
  });
}

const json = () => ({ 'Content-Type': 'application/json' });
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

function assertSecurityHeaders(res, { api }) {
  assert.equal(res.headers['content-security-policy'], CSP);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
  assert.equal(res.headers['x-frame-options'], 'DENY');
  if (api) assert.equal(res.headers['cache-control'], 'no-store');
}

function assertError(res, status, code) {
  assert.equal(res.status, status, res.body.toString());
  const body = res.json();
  assert.equal(body.error.code, code, res.body.toString());
  assert.equal(typeof body.error.message, 'string');
  return body.error;
}

async function person(anon, name) {
  const identity = await generateIdentity();
  const { person: view, token } = await anon.registerPerson({ name, identity });
  return { identity, id: identity.id, view, token, client: anon.withToken(token) };
}

// Ada and Ben form a team; optionally Ben's agent scribe is registered and nominated.
async function team(anon, { agent = true } = {}) {
  const ada = await person(anon, 'Ada');
  const ben = await person(anon, 'Ben');
  await ben.client.updateProfile({ skills: ['exo-skills'], listed: true });
  const brief = await ada.client.publishBrief(BRIEF);
  const interest = await ben.client.expressInterest(brief.id, { role: 'r1', note: 'Synthetic note.' });
  await ada.client.decideInterest(interest.id, 'accept');
  let scribe = null;
  if (agent) {
    const identity = await generateIdentity();
    const { agent: view, token } = await ben.client.registerAgent({ name: 'scribe', identity });
    scribe = { identity, id: identity.id, view, token, client: anon.withToken(token) };
    await ben.client.nominateAgent(brief.id, identity.id);
  }
  return { ada, ben, scribe, brief, interest };
}

async function project(anon, options) {
  const w = await team(anon, options);
  w.pid = (await w.ada.client.startSigned({ briefId: w.brief.id, identity: w.ada.identity })).project;
  return w;
}

// Drafts and signs on the given records without local Koinos checks.
async function signed(identity, records, kind, body) {
  return signDraft(await draftRecord({ records, actor: identity.id, kind, body }), identity.privateKey);
}

// --- Discovery and routes ----------------------------------------------------------------------

test('health and discovery are public and say what the hub will not do', async (t) => {
  const { port, anon } = await startHub(t);
  const health = await anon.health();
  assert.equal(health.name, 'exofab');
  assert.equal(health.records, 'koinos/0.1');
  assert.equal(health.local_only, true);
  const discovery = await anon.discovery();
  assert.deepEqual(discovery, JSON.parse(JSON.stringify(DISCOVERY)));
  assert.deepEqual(Object.keys(discovery).sort(), [
    'agent_actions', 'bundle', 'economic_rights', 'hub_signs_records', 'human_only', 'local_only', 'name', 'payments', 'ranking', 'records', 'version',
  ]);
  assert.equal(discovery.bundle, 'koinos-bundle/0.1');
  assert.equal(discovery.hub_signs_records, false);
  assert.deepEqual(discovery.agent_actions, ['contribution.submit']);
  for (const action of ['brief.publish', 'interest.express', 'agreement.consent', 'contribution.review', 'contribution.accept']) {
    assert.ok(discovery.human_only.includes(action), action);
  }
  assert.equal(discovery.payments, false);
  assert.equal(discovery.economic_rights, false);
  assert.equal(discovery.ranking, false);
  const res = await raw(port, { path: '/.well-known/exofab.json' });
  assert.match(res.headers['content-type'], /^application\/json/);
  assertSecurityHeaders(res, { api: true });
});

test('the server implements exactly the routes listed in docs/prototype.md', async () => {
  const doc = await readFile(join(ROOT, 'docs', 'prototype.md'), 'utf8');
  const section = doc.slice(doc.indexOf('## HTTP API'), doc.indexOf('## Command line'));
  const documented = [...section.matchAll(/`(GET|POST|PUT|PATCH|DELETE) (\/[^`]*)`/g)].map(([, m, p]) => `${m} ${p}`).sort();
  const implemented = API_ROUTES.map((r) => `${r.method} ${r.path.replace(/:(\w+)/g, '{$1}')}`).sort();
  assert.deepEqual(implemented, documented);
});

// --- Authentication on every route ----------------------------------------------------------

test('every authenticated route answers 401 without a valid bearer token', async (t) => {
  const { port } = await startHub(t);
  const fill = (path) => path.replace(':id', 'brf_0000000000000000').replace(':pid', NO_PROJECT).replace(':digest', ZERO_DIGEST);
  const authenticated = API_ROUTES.filter((r) => r.auth);
  assert.ok(authenticated.length >= 24);
  for (const r of authenticated) {
    for (const headers of [{}, bearer('exf_' + 'A'.repeat(43)), bearer('not-a-token'), { Authorization: 'Basic YWRhOmJlbg==' }]) {
      const res = await raw(port, { method: r.method, path: fill(r.path), headers });
      const error = assertError(res, 401, 'unauthenticated');
      assert.equal(res.headers['www-authenticate'], 'Bearer', `${r.method} ${r.path}`);
      assert.ok(error.message.length > 0);
      assertSecurityHeaders(res, { api: true });
    }
  }
  for (const r of API_ROUTES.filter((x) => !x.auth)) {
    assert.ok(['GET /api/health', 'GET /.well-known/exofab.json', 'POST /api/challenges', 'POST /api/people'].includes(`${r.method} ${r.path}`));
  }
});

test('agent tokens reach only their read routes, blob upload and record append', async (t) => {
  const { port, anon } = await startHub(t);
  const w = await project(anon);
  const agentAllowed = new Set([
    'GET /api/me',
    'GET /api/projects',
    'GET /api/projects/:pid',
    'GET /api/projects/:pid/bundle',
    'POST /api/projects/:pid/blobs',
    'GET /api/projects/:pid/blobs/:digest',
  ]);
  const fill = (path) => path.replace(':id', path.includes('people') ? w.ada.id : path.includes('interests/') ? w.interest.id : w.brief.id)
    .replace(':pid', w.pid)
    .replace(':digest', ZERO_DIGEST);
  for (const r of API_ROUTES.filter((x) => x.auth)) {
    const key = `${r.method} ${r.path}`;
    const headers = { ...bearer(w.scribe.token) };
    let body;
    if (r.input === 'json' || r.input === 'none') {
      headers['Content-Type'] = 'application/json';
      body = '{}';
    } else if (r.input === 'blob') {
      headers['Content-Type'] = 'application/octet-stream';
      body = 'synthetic bytes';
    }
    // The append route is reached: the record fails Koinos (422), not the policy (403).
    if (key === 'POST /api/projects/:pid/records') body = JSON.stringify({ kind: 'contribution.submitted', actor: w.scribe.id });
    const res = await raw(port, { method: r.method, path: fill(r.path), headers, body });
    if (key === 'POST /api/projects/:pid/records') {
      assertError(res, 422, 'koinos');
    } else if (agentAllowed.has(key)) {
      assert.notEqual(res.status, 401, key);
      assert.notEqual(res.status, 403, `${key}: ${res.body}`);
    } else {
      assertError(res, 403, 'forbidden');
    }
  }
  // Even on the append route, an agent can sign only contribution.submitted.
  const { records } = await w.scribe.client.getProject(w.pid);
  const record = await signed(w.scribe.identity, records, 'contribution.reviewed', { contribution: ZERO_DIGEST, decision: 'approve', note: 'x' });
  await assert.rejects(w.scribe.client.appendRecord(w.pid, record), (e) => e.status === 403 && e.code === 'forbidden');
  assert.equal((await w.scribe.client.me()).kind, 'agent');
});

test('a person cannot sign as another person: the actor must equal the token', async (t) => {
  const { anon } = await startHub(t);
  const w = await project(anon, { agent: false });
  const { records } = await w.ben.client.getProject(w.pid);
  const terms = await w.ada.client.putBlob(w.pid, utf8('Synthetic charter.\n'), 'text/plain; charset=utf-8');
  const proposal = { title: 'Charter', uri: terms.uri, digest: terms.digest, parties: [w.ada.id, w.ben.id] };
  const adaRecord = await signed(w.ada.identity, records, 'agreement.proposed', proposal);
  await assert.rejects(w.ben.client.appendRecord(w.pid, adaRecord), (e) => e.status === 403 && e.code === 'forbidden');
});

// --- Host and Origin -----------------------------------------------------------------------------

test('requests for another Host are refused (DNS rebinding)', async (t) => {
  const { port } = await startHub(t);
  for (const host of ['evil.example', `evil.example:${port}`, `127.0.0.1:${port + 1}`, '127.0.0.1', `[::1]:${port}`, `0.0.0.0:${port}`, `127.0.0.1:${port}.evil.example`]) {
    for (const path of ['/api/health', '/']) {
      const res = await raw(port, { path, headers: { Host: host } });
      assertError(res, 421, 'misdirected');
      assertSecurityHeaders(res, { api: path !== '/' });
    }
  }
  for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `LocalHost:${port}`]) {
    assert.equal((await raw(port, { path: '/api/health', headers: { Host: host } })).status, 200, host);
  }
});

test('requests carrying a foreign Origin are refused, whatever the method', async (t) => {
  const { port, anon } = await startHub(t);
  const ada = await person(anon, 'Ada');
  for (const origin of ['http://evil.example', 'null', `http://localhost:${port}`, `https://127.0.0.1:${port}`, `http://127.0.0.1:${port + 1}`]) {
    const post = await raw(port, { method: 'POST', path: '/api/briefs', headers: { ...json(), ...bearer(ada.token), Origin: origin }, body: JSON.stringify(BRIEF) });
    assertError(post, 403, 'cross_origin');
    assertSecurityHeaders(post, { api: true });
    assertError(await raw(port, { path: '/api/me', headers: { ...bearer(ada.token), Origin: origin } }), 403, 'cross_origin');
    assertError(await raw(port, { path: '/', headers: { Origin: origin } }), 403, 'cross_origin');
  }
  assert.deepEqual(await ada.client.listBriefs(), []);
  const same = await raw(port, { method: 'POST', path: '/api/challenges', headers: { ...json(), Origin: `http://127.0.0.1:${port}` }, body: '{}' });
  assert.equal(same.status, 201);
  const viaLocalhost = await raw(port, { path: '/api/health', headers: { Host: `localhost:${port}`, Origin: `http://localhost:${port}` } });
  assert.equal(viaLocalhost.status, 200);
});

test('API requests that browsers mark cross-site or same-site are refused; navigation to the page is not', async (t) => {
  const { port } = await startHub(t);
  for (const site of ['cross-site', 'same-site']) {
    assertError(await raw(port, { path: '/api/health', headers: { 'Sec-Fetch-Site': site } }), 403, 'cross_origin');
    assert.equal((await raw(port, { path: '/', headers: { 'Sec-Fetch-Site': site, 'Sec-Fetch-Mode': 'navigate' } })).status, 200);
  }
  for (const site of ['same-origin', 'none']) {
    assert.equal((await raw(port, { path: '/api/health', headers: { 'Sec-Fetch-Site': site } })).status, 200);
  }
});

// --- Content types, sizes and strict JSON ----------------------------------------------------

test('JSON routes require application/json and strict JSON within 1 MiB', async (t) => {
  const { port } = await startHub(t);
  const post = (headers, body) => raw(port, { method: 'POST', path: '/api/people', headers, body });
  for (const type of [undefined, 'text/plain', 'text/plain; charset=utf-8', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/json; charset=latin1', 'application/json; foo=bar', 'application/jsonp']) {
    const res = await post(type === undefined ? {} : { 'Content-Type': type }, '{}');
    assertError(res, 415, 'unsupported_media_type');
  }
  for (const body of ['{"name":"Ada","name":"Ben"}', '{"name":', '\ufeff{}', '{} {}', '', "{'a':1}", '{"a":1e999}']) {
    assertError(await post(json(), body), 400, 'invalid_json');
  }
  const big = `{"name":"${'a'.repeat(MiB)}"}`;
  assertError(await post(json(), big), 413, 'too_large');
  // Without Content-Length (chunked), the cap still holds.
  const chunked = await new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/api/people', headers: { Host: `127.0.0.1:${port}`, 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    for (let i = 0; i < 20; i++) req.write(Buffer.alloc(64 * 1024, 0x20));
    req.end();
  });
  assert.equal(chunked, 413);
  // A client still uploading when the hub refuses can finish sending and read the 413:
  // the hub discards the rest of the body and keeps the connection usable.
  for (const declared of [true, false]) assert.deepEqual(await oversizedUploadThenReuse(port, declared), [413, 200]);
  // Accepted forms reach the hub, which validates the fields.
  assertError(await post({ 'Content-Type': 'application/json; charset=UTF-8' }, '{}'), 422, 'invalid');
  assertError(await post({ 'Content-Type': 'Application/JSON' }, '[]'), 422, 'invalid');
});

test('routes that take no input accept an empty body or {} only', async (t) => {
  const { port } = await startHub(t);
  const post = (body) => raw(port, { method: 'POST', path: '/api/challenges', headers: json(), body });
  assert.equal((await post(undefined)).status, 201);
  assert.equal((await post('{}')).status, 201);
  assertError(await post('{"nonce":"chosen"}'), 422, 'invalid');
  assertError(await post('[]'), 422, 'invalid');
  assertError(await raw(port, { method: 'POST', path: '/api/challenges' }), 415, 'unsupported_media_type');
});

test('blob upload takes raw bytes as octet-stream or UTF-8 text, at most 4 MiB, and serves them as attachments', async (t) => {
  const { port, anon } = await startHub(t);
  const w = await project(anon, { agent: false });
  const path = `/api/projects/${w.pid}/blobs`;
  const auth = bearer(w.ada.token);
  for (const type of [undefined, 'application/json', 'text/plain', 'text/plain; charset=latin1', 'text/html; charset=utf-8', 'application/octet-stream; x=y', 'image/svg+xml']) {
    const headers = type === undefined ? auth : { ...auth, 'Content-Type': type };
    assertError(await raw(port, { method: 'POST', path, headers, body: 'synthetic' }), 415, 'unsupported_media_type');
  }
  const invalidUtf8 = Buffer.from([0x63, 0xff, 0x64]);
  assertError(await raw(port, { method: 'POST', path, headers: { ...auth, 'Content-Type': 'text/plain; charset=utf-8' }, body: invalidUtf8 }), 400, 'bad_request');
  const tooBig = Buffer.alloc(4 * MiB + 1, 0x61);
  assertError(await raw(port, { method: 'POST', path, headers: { ...auth, 'Content-Type': 'application/octet-stream' }, body: tooBig }), 413, 'too_large');

  const bytes = utf8('<script>alert("synthetic")</script>\n');
  const stored = await w.ada.client.putBlob(w.pid, bytes, 'text/plain; charset=utf-8');
  assert.equal(stored.digest, await sha256Hex(bytes));
  assert.equal(stored.size, bytes.length);
  const exact = Buffer.alloc(4 * MiB, 0x62);
  const big = await raw(port, { method: 'POST', path, headers: { ...auth, 'Content-Type': 'application/octet-stream' }, body: exact });
  assert.equal(big.status, 201, big.body.toString());

  const res = await raw(port, { path: `${path}/${stored.digest}`, headers: auth });
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/octet-stream');
  assert.equal(res.headers['content-disposition'], `attachment; filename="${stored.digest}"`);
  assertSecurityHeaders(res, { api: true });
  assert.deepEqual(new Uint8Array(res.body), bytes);
  assert.deepEqual(await w.ben.client.getBlob(w.pid, stored.digest), bytes);
  assertError(await raw(port, { path: `${path}/${ZERO_DIGEST}`, headers: auth }), 404, 'not_found');
  assertError(await raw(port, { path: `${path}/NOT-A-DIGEST`, headers: auth }), 422, 'invalid');

  // Non-participants cannot see that the project exists.
  const eve = await person(anon, 'Eve');
  await assert.rejects(eve.client.getBlob(w.pid, stored.digest), (e) => e.status === 404);
  await assert.rejects(eve.client.putBlob(w.pid, bytes), (e) => e.status === 404);
});

// --- Static files ------------------------------------------------------------------------------

test('static files: index, web assets and Koinos modules with exact content types', async (t) => {
  const { port } = await startHub(t);
  const cases = [
    ['/', 'web/index.html', 'text/html; charset=utf-8'],
    ['/app/index.html', 'web/index.html', 'text/html; charset=utf-8'],
    ['/app/app.mjs', 'web/app.mjs', 'text/javascript; charset=utf-8'],
    ['/app/styles.css', 'web/styles.css', 'text/css; charset=utf-8'],
    ['/app/icon.svg', 'web/icon.svg', 'image/svg+xml'],
    ['/lib/koinos/crypto.mjs', 'src/koinos/crypto.mjs', 'text/javascript; charset=utf-8'],
    ['/lib/koinos/index.mjs', 'src/koinos/index.mjs', 'text/javascript; charset=utf-8'],
    ['/lib/koinos/errors.mjs?v=1', 'src/koinos/errors.mjs', 'text/javascript; charset=utf-8'],
  ];
  for (const [path, file, type] of cases) {
    const res = await raw(port, { path });
    assert.equal(res.status, 200, path);
    assert.equal(res.headers['content-type'], type, path);
    assert.deepEqual(res.body, await readFile(join(ROOT, file)), path);
    assertSecurityHeaders(res, { api: false });
    assert.equal(res.headers['cache-control'], 'no-cache');
  }
  const head = await raw(port, { method: 'HEAD', path: '/' });
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  assert.equal(Number(head.headers['content-length']), (await readFile(join(ROOT, 'web', 'index.html'))).length);
  const post = await raw(port, { method: 'POST', path: '/', headers: json(), body: '{}' });
  assertError(post, 405, 'method_not_allowed');
  assert.equal(post.headers.allow, 'GET, HEAD');
});

test('static paths outside the whitelist, including traversal attempts, are not found', async (t) => {
  const { port } = await startHub(t);
  const attempts = [
    '/app/../package.json',
    '/app/..%2fpackage.json',
    '/app/%2e%2e/package.json',
    '/app/%2e%2e%2fpackage.json',
    '/app/..%5cpackage.json',
    '/lib/koinos/../hub/hub.mjs',
    '/lib/koinos/%2e%2e/hub/hub.mjs',
    '/lib/koinos/..%2f..%2fcli.mjs',
    '/lib/koinos/crypto.mjs/',
    '/lib/koinos/crypto.mjs%00',
    '/lib/koinos/Crypto.mjs',
    '/lib/koinos/',
    '/lib/koinos',
    '/lib/hub/hub.mjs',
    '/lib/json/strict.mjs',
    '/app/',
    '/app',
    '/app//index.html',
    '/index.html',
    '/web/index.html',
    '/src/server.mjs',
    '/package.json',
    '/.git/config',
    '/.exofab/hub.json',
    '//etc/passwd',
    '/app/%2fetc%2fpasswd',
    '/api',
    '/api/',
    '/api/briefs/',
    '/api/nothing',
  ];
  for (const path of attempts) {
    const res = await raw(port, { path });
    assertError(res, 404, 'not_found');
    assertSecurityHeaders(res, { api: path.startsWith('/api/') });
  }
  const absolute = await raw(port, { path: `http://127.0.0.1:${port}/package.json` });
  assertError(absolute, 400, 'bad_request');
});

test('symbolic links and unknown file types in the web directory are never served', async (t) => {
  const web = await mkdtemp(join(tmpdir(), 'exofab-web-'));
  t.after(() => rm(web, { recursive: true, force: true }));
  await writeFile(join(web, 'index.html'), '<!doctype html><title>synthetic</title>\n');
  await writeFile(join(web, 'notes.txt'), 'not whitelisted\n');
  await writeFile(join(web, '.hidden.css'), 'body{}\n');
  await mkdir(join(web, 'sub'));
  await writeFile(join(web, 'sub', 'x.css'), 'body{}\n');
  await symlink(join(ROOT, 'package.json'), join(web, 'linked.json'));
  await writeFile(join(web, 'late.css'), 'body{}\n');
  await writeFile(join(web, 'gone.css'), 'body{}\n');
  const { port } = await startHub(t, { webDir: web });
  assert.equal((await raw(port, { path: '/' })).status, 200);
  assert.equal((await raw(port, { path: '/app/late.css' })).status, 200);
  for (const path of ['/app/notes.txt', '/app/.hidden.css', '/app/sub/x.css', '/app/linked.json', '/app/sub']) {
    assertError(await raw(port, { path }), 404, 'not_found');
  }
  // A whitelisted file replaced by a link, or removed, after start-up is not served.
  await rm(join(web, 'late.css'));
  await symlink(join(ROOT, 'package.json'), join(web, 'late.css'));
  await rm(join(web, 'gone.css'));
  assertError(await raw(port, { path: '/app/late.css' }), 404, 'not_found');
  assertError(await raw(port, { path: '/app/gone.css' }), 404, 'not_found');
});

// --- Methods, errors and the 409 path ---------------------------------------------------------------

test('wrong methods get 405 with Allow; unknown API paths get 404; errors are JSON', async (t) => {
  const { port } = await startHub(t);
  const put = await raw(port, { method: 'PUT', path: '/api/health', headers: json(), body: '{}' });
  assertError(put, 405, 'method_not_allowed');
  assert.equal(put.headers.allow, 'GET');
  const del = await raw(port, { method: 'DELETE', path: '/api/briefs/brf_0000000000000000' });
  assertError(del, 405, 'method_not_allowed');
  assert.equal(del.headers.allow, 'GET, PATCH');
  assert.equal((await raw(port, { method: 'HEAD', path: '/api/health' })).status, 405);
  const missing = await raw(port, { path: '/api/briefs/brf_0000000000000000/unknown' });
  assertError(missing, 404, 'not_found');
  assert.match(missing.headers['content-type'], /^application\/json; charset=utf-8$/);
  assertError(await raw(port, { path: '/api/people/%E0%A4%A' }), 400, 'bad_request');
});

test('a stale record gets 409 with the current head and sequence, and appendSigned retries', async (t) => {
  const { port, anon } = await startHub(t);
  const w = await project(anon, { agent: false });
  const terms = await w.ada.client.putBlob(w.pid, utf8('Synthetic charter text.\n'), 'text/plain; charset=utf-8');
  const proposal = (title) => ({ title, uri: terms.uri, digest: terms.digest, parties: [w.ada.id, w.ben.id] });
  const { records } = await w.ada.client.getProject(w.pid);
  const first = await signed(w.ada.identity, records, 'agreement.proposed', proposal('Charter A'));
  const stale = await signed(w.ada.identity, records, 'agreement.proposed', proposal('Charter B'));
  const appended = await w.ada.client.appendRecord(w.pid, first);
  assert.equal(appended.head, first.id);
  const res = await raw(port, { method: 'POST', path: `/api/projects/${w.pid}/records`, headers: { ...json(), ...bearer(w.ada.token) }, body: JSON.stringify(stale) });
  const error = assertError(res, 409, 'conflict');
  assert.equal(error.head, first.id);
  assert.equal(error.sequence, 2);
  await assert.rejects(w.ada.client.appendRecord(w.pid, stale), (e) => e instanceof ExofabHttpError && e.status === 409 && e.head === first.id && e.sequence === 2);

  // The head moves between appendSigned's read and its post: it signs again.
  let raced = false;
  const racingFetch = async (url, init) => {
    if (!raced && init.method === 'POST' && String(url).endsWith('/records')) {
      raced = true;
      const { records: now } = await w.ada.client.getProject(w.pid);
      await w.ada.client.appendRecord(w.pid, await signed(w.ada.identity, now, 'agreement.consented', { agreement: first.id }));
    }
    return fetch(url, init);
  };
  const ben = new ExofabClient({ baseUrl: `http://127.0.0.1:${port}`, token: w.ben.token, fetch: racingFetch });
  const result = await ben.appendSigned({ pid: w.pid, identity: w.ben.identity, kind: 'agreement.consented', body: { agreement: first.id } });
  assert.ok(raced);
  assert.equal(result.count, 4);
  assert.equal(result.record.sequence, 3);
  assert.deepEqual(result.state.agreements[0].consents, [w.ada.id, w.ben.id]);
});

test('Koinos refusals are 422 with the Koinos error code', async (t) => {
  const { anon } = await startHub(t);
  const w = await project(anon, { agent: false });
  const { records } = await w.ada.client.getProject(w.pid);
  const record = await signed(w.ada.identity, records, 'agreement.consented', { agreement: ZERO_DIGEST });
  await assert.rejects(w.ada.client.appendRecord(w.pid, record), (e) => e.status === 422 && e.code === 'koinos' && e.koinosCode === 'reference');
  const tampered = { ...record, body: { agreement: '1'.repeat(64) } };
  await assert.rejects(w.ada.client.appendRecord(w.pid, tampered), (e) => e.status === 422 && e.koinosCode === 'id');
  const early = await draftRecord({ records, actor: w.ada.id, kind: 'agreement.consented', body: { agreement: ZERO_DIGEST }, time: '2026-01-01T00:00:00.000Z' });
  await assert.rejects(w.ada.client.appendRecord(w.pid, await signDraft(early, w.ada.identity.privateKey)), (e) => e.status === 422 && e.koinosCode === 'time');
});

// --- Lifecycle and client safety -----------------------------------------------------------------

test('the server binds 127.0.0.1 only and refuses to start on a log that does not verify', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'exofab-server-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const hub = new Hub({ store: new FileStore(dir) });
  for (const host of ['0.0.0.0', 'localhost', '::', '::1', '192.0.2.1']) {
    await assert.rejects(createServer({ hub, host, port: 0, log: quiet }), /127\.0\.0\.1 only/);
  }
  await hub.load();
  const log = JSON.parse(await readFile(join(dir, 'hub.json'), 'utf8'));
  log.events.push({ seq: 0, prev: null, time: '2026-10-31T12:00:00.000Z', author: null, type: 'person.registered', body: {}, hash: ZERO_DIGEST });
  await writeFile(join(dir, 'hub.json'), JSON.stringify(log));
  await assert.rejects(createServer({ hub: new Hub({ store: new FileStore(dir) }), port: 0, log: quiet }), (e) => e.name === 'StoreError');
});

test('a change that would pass a storage limit gets 507 alone; the hub keeps serving and restarts', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'exofab-server-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const limits = { hubBytes: 16 * 1024 };
  const start = () => createServer({ hub: new Hub({ store: new FileStore(dir, { limits }) }), port: 0, log: quiet });
  const handle = await start();
  t.after(() => handle.close());
  const anon = new ExofabClient({ baseUrl: handle.url });
  const ada = await person(anon, 'Ada');

  // One registered person publishes until the hub log would pass its cap.
  let refused = null;
  for (let i = 0; i < 100 && !refused; i++) {
    await ada.client.publishBrief({ ...BRIEF, summary: `Synthetic filler ${i}. ${'s'.repeat(1000)}` }).catch((error) => {
      refused = error;
    });
  }
  assert.ok(refused instanceof ExofabHttpError, String(refused));
  assert.equal(refused.status, 507);
  assert.equal(refused.code, 'storage_full');
  assert.ok((await stat(join(dir, 'hub.json'))).size <= limits.hubBytes);
  // Reads still work; later changes are refused the same way, not with a storage failure.
  assert.equal((await ada.client.me()).name, 'Ada');
  const briefs = (await ada.client.listBriefs()).length;
  await assert.rejects(ada.client.publishBrief({ ...BRIEF, summary: 's'.repeat(1000) }), (e) => e.status === 507 && e.code === 'storage_full');

  // The data directory still loads after a restart.
  await handle.close();
  const again = await start();
  t.after(() => again.close());
  const adaAgain = new ExofabClient({ baseUrl: again.url, token: ada.token });
  assert.equal((await adaAgain.me()).name, 'Ada');
  assert.equal((await adaAgain.listBriefs()).length, briefs);
});

test('close() is graceful and idempotent', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'exofab-server-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const handle = await createServer({ hub: new Hub({ store: new FileStore(dir) }), port: 0, log: quiet });
  const client = new ExofabClient({ baseUrl: handle.url });
  assert.equal((await client.health()).name, 'exofab');
  await Promise.all([handle.close(), handle.close()]);
  await assert.rejects(client.health());
});

test('the client accepts only loopback http hubs and never reveals its token', async () => {
  for (const baseUrl of ['https://127.0.0.1:4317', 'http://example.org:4317', 'http://192.0.2.1:4317', 'http://user:pw@127.0.0.1:4317', 'http://127.0.0.1:4317/api', 'file:///x', 'not a url']) {
    assert.throws(() => new ExofabClient({ baseUrl }), TypeError, baseUrl);
  }
  const token = 'exf_' + 'S'.repeat(43);
  const client = new ExofabClient({ baseUrl: 'http://localhost:4317', token });
  assert.ok(!JSON.stringify(client).includes(token));
  assert.ok(!inspect(client, { showHidden: true, depth: 5 }).includes(token));
  assert.ok(!String(client).includes(token));
});
