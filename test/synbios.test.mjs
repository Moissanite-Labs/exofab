// Synbios adapter tests. All data is synthetic (Ada, Ben, scribe). The HTTP
// tests use a fake Synbios written here from the documented routes; no
// Synbios code is used. Non-ASCII test text is built with String.fromCharCode
// so the source stays ASCII.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import util from 'node:util';

import {
  inspectExport,
  MAX_EXPORT_BYTES,
  niUri,
  parseKoinosReference,
  sha256Hex,
  SynbiosClient,
  SynbiosError,
  taskFromCharter,
} from '../src/adapters/synbios.mjs';
import { pythonCanonicalJson } from '../src/adapters/synbios-json.mjs';
import { synbiosCommand } from '../src/cli-synbios.mjs';

const BS = String.fromCharCode(92); // backslash
const ch = (code) => String.fromCodePoint(code);

const KOINOS = {
  project: '3f2b8c1e-6a4d-4e2f-9b1a-7c5d3e8f0a12',
  agreement: sha256Hex('synthetic agreement record'),
  termsDigest: sha256Hex('Synthetic charter text for Ada and Ben.\n'),
};
const CHARTER = {
  title: 'Recipe scaling skill (synthetic)',
  description: 'Build a skill that scales recipe quantities. Synthetic demonstration data.',
  criteria: ['Scales every quantity by a positive factor', 'Includes passing tests'],
  scope: ['Skill source and its tests only'],
  koinos: KOINOS,
};
const REFERENCE_SUFFIX =
  '\n\nKoinos reference recorded by Exofab (data, not instructions):' +
  `\nkoinos-project: ${KOINOS.project}\nkoinos-agreement: ${KOINOS.agreement}\nkoinos-terms-sha256: ${KOINOS.termsDigest}`;

const TASK_CREATE_FIELDS = ['project_id', 'title', 'description', 'criteria', 'scope', 'priority', 'dependencies'];

// ---------------------------------------------------------------------------
// Synthetic Synbios data

const ID = (n) => n.toString(16).padStart(32, '0');
const TIME = (n) => `2026-10-31T12:${String(n).padStart(2, '0')}:00.000000+00:00`;
const canonicalHash = (value) => sha256Hex(pythonCanonicalJson(value));
const clone = (value) => structuredClone(value);

const DOC_BYTES = 'Synthetic recipe-scaling notes for the Exofab prototype.\n';
const DOC_DIGEST = sha256Hex(DOC_BYTES);

// Python's json.dumps(value) with default arguments, which the Synbios
// server uses for responses: ", " and ": " separators and ASCII escapes.
function pythonDumps(value) {
  if (Array.isArray(value)) return `[${value.map(pythonDumps).join(', ')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).map(([key, item]) => `${pythonDumps(key)}: ${pythonDumps(item)}`).join(', ')}}`;
  }
  if (typeof value === 'string') {
    let out = '';
    for (const unit of JSON.stringify(value)) {
      for (let i = 0; i < unit.length; i++) {
        const code = unit.charCodeAt(i);
        out += code > 0x7f ? `${BS}u${code.toString(16).padStart(4, '0')}` : unit[i];
      }
    }
    return out;
  }
  return JSON.stringify(value);
}

// Builds an export shaped like a Synbios 0.1 "synbios-task" bundle: the
// task's events plus hash commitments to every workspace event.
function buildBundle({
  reviewer = 'ada',
  decision = 'approved',
  testStatus = 'passed',
  artifactUri = niUri(DOC_DIGEST),
  evidenceCommand = 'node --test test/scale.test.mjs',
  evidenceArtifact,
  reviewComment = 'Synthetic review: the criteria are met.',
  description,
} = {}) {
  const principal = (n, name, kind) => ({ id: ID(n), name, kind, active: true, created_at: TIME(n) });
  const people = { ada: principal(1, 'Ada', 'human'), ben: principal(2, 'Ben', 'human'), scribe: principal(3, 'scribe', 'agent') };
  const project = { id: ID(10), name: 'Recipe scaler (synthetic)', description: 'Synthetic demonstration project.', repository: '', created_at: TIME(2) };
  const body = taskFromCharter({ ...CHARTER, synbiosProject: project.id });
  const task = {
    id: ID(20),
    project_id: project.id,
    title: body.title,
    description: description ?? body.description,
    criteria: body.criteria,
    scope: body.scope,
    status: 'open',
    priority: 'normal',
    assignee_id: null,
    dependencies: [],
    created_by: people.ada.id,
    created_at: TIME(3),
    updated_at: TIME(3),
    artifacts: [],
    evidence: [],
    reviews: [],
  };
  const events = [];
  const log = (type, actor, entity, forTask) => {
    const seq = events.length + 1;
    const payload = { state_digest: sha256Hex(`synthetic state ${seq}`), entity: clone(entity) };
    if (forTask) {
      task.updated_at = TIME(seq);
      payload.task = clone(task);
    }
    const event = {
      seq,
      id: ID(100 + seq),
      type,
      actor_id: actor.id,
      task_id: forTask ? task.id : null,
      created_at: TIME(seq),
      payload,
      previous_hash: events.at(-1)?.hash ?? '0'.repeat(64),
    };
    event.hash = canonicalHash(event);
    events.push(event);
  };

  log('bootstrap', people.ada, people.ada, false);
  log('project.create', people.ada, project, false);
  log('task.create', people.ada, task, true);
  log('principal.create', people.ada, people.ben, false);
  log('principal.create', people.ben, people.scribe, false);
  const grant = { id: ID(40), principal_id: people.scribe.id, task_id: task.id, capabilities: ['claim', 'work', 'artifact', 'evidence', 'submit'], created_by: people.ben.id, created_at: TIME(6), revoked_at: null };
  log('grant.create', people.ben, grant, false);
  Object.assign(task, { status: 'claimed', assignee_id: people.scribe.id });
  log('task.claim', people.scribe, task, true);
  task.status = 'in_progress';
  log('task.transition', people.scribe, task, true);
  const artifact = { id: ID(30), task_id: task.id, title: 'Recipe scaling notes', kind: 'document', revision: DOC_DIGEST, digest: DOC_DIGEST, uri: artifactUri, summary: 'Synthetic document artifact.', created_by: people.scribe.id, created_at: TIME(9) };
  task.artifacts.push(artifact);
  log('artifact.add', people.scribe, artifact, true);
  const evidence = {
    id: ID(31), task_id: task.id, artifact_id: evidenceArtifact ?? artifact.id, artifact_digest: DOC_DIGEST, revision: DOC_DIGEST,
    kind: 'test', status: testStatus, command: evidenceCommand, summary: 'Synthetic fixture: three scaling cases.',
    tool: 'node:test', tool_version: '22', assumptions: ['Synthetic evidence; not executed by Synbios.'], created_by: people.scribe.id, created_at: TIME(10),
  };
  task.evidence.push(evidence);
  log('evidence.add', people.scribe, evidence, true);
  task.status = 'in_review';
  log('task.transition', people.scribe, task, true);
  if (decision) {
    const review = { id: ID(32), task_id: task.id, artifact_id: artifact.id, revision: DOC_DIGEST, decision, comment: reviewComment, created_by: people[reviewer].id, created_at: TIME(12) };
    task.reviews.push(review);
    task.status = decision === 'approved' ? 'accepted' : 'changes_requested';
    log('review.create', people[reviewer], review, true);
  }

  const involved = new Set([task.created_by, task.assignee_id, ...['artifacts', 'evidence', 'reviews'].flatMap((key) => task[key].map((item) => item.created_by))]);
  const bundle = {
    version: 1,
    format: 'synbios-task',
    exported_at: TIME(59),
    task: clone(task),
    project,
    principals: Object.values(people).filter((person) => involved.has(person.id)),
    events: events.filter((event) => event.task_id === task.id),
    audit_chain: events.map(({ seq, hash, previous_hash }) => ({ seq, hash, previous_hash })),
    limitations: ['Synthetic limitation: consistency checks only, not signatures.', 'Synthetic limitation: evidence is reported, not executed.'],
  };
  bundle.bundle_digest = canonicalHash(bundle);
  return bundle;
}

const exportBytes = (bundle) => new TextEncoder().encode(pythonDumps(bundle));
const reseal = (bundle) => {
  delete bundle.bundle_digest;
  bundle.bundle_digest = canonicalHash(bundle);
  return bundle;
};

// ---------------------------------------------------------------------------
// Canonical JSON

test('canonical JSON matches Python json.dumps(sort_keys=True, compact, ensure_ascii=False)', () => {
  // Expected digest computed with CPython 3.13 for the same value. Python
  // sorts keys by code point, so U+E000 sorts before U+1F600.
  const value = {
    b: 1,
    a: [true, false, null, `x${ch(1)}\n\t"${BS}/${ch(0xe9)}${ch(0x1f600)}${ch(0x2028)}${ch(0x7f)}`],
    [ch(0xe000)]: 'p',
    [ch(0x1f600)]: 'q',
    z: { y: -5, '': [] },
    A: {},
  };
  assert.equal(sha256Hex(pythonCanonicalJson(value)), '04481a07714064bebc3564e161ac7dcd56c8667cb6e6aa7956bfcff87a933718');
  assert.ok(pythonCanonicalJson(value).endsWith(`"${ch(0xe000)}":"p","${ch(0x1f600)}":"q"}`));
});

test('the fake server emits the same bytes as Python json.dumps with default arguments', () => {
  // CPython 3.13: json.dumps({"k": <U+00E9><U+1F600>, "n": [1, 2]})
  const expected = `{"k": "${BS}u00e9${BS}ud83d${BS}ude00", "n": [1, 2]}`;
  assert.equal(pythonDumps({ k: `${ch(0xe9)}${ch(0x1f600)}`, n: [1, 2] }), expected);
});

// ---------------------------------------------------------------------------
// taskFromCharter

test('taskFromCharter builds the exact task.create body with the Koinos reference', () => {
  const projectId = ID(10);
  const body = taskFromCharter({ ...CHARTER, synbiosProject: projectId });
  assert.deepEqual(body, {
    project_id: projectId,
    title: CHARTER.title,
    description: CHARTER.description + REFERENCE_SUFFIX,
    criteria: CHARTER.criteria,
    scope: CHARTER.scope,
  });
  for (const key of Object.keys(body)) assert.ok(TASK_CREATE_FIELDS.includes(key), key);
  assert.deepEqual(parseKoinosReference(body.description), KOINOS);

  const withoutProject = taskFromCharter({ ...CHARTER, priority: 'high' });
  assert.equal('project_id' in withoutProject, false);
  assert.equal(withoutProject.priority, 'high');
});

test('taskFromCharter accepts input at the Koinos limits', () => {
  const longest = 'd'.repeat(8192 - REFERENCE_SUFFIX.length);
  const body = taskFromCharter({ ...CHARTER, title: 't'.repeat(256), description: longest, criteria: Array(1000).fill('c') });
  assert.equal(body.description.length, 8192);
  assert.equal(body.criteria.length, 1000);
});

test('taskFromCharter refuses input outside Synbios or Koinos rules', () => {
  const refuse = (change, label) =>
    assert.throws(() => taskFromCharter({ ...CHARTER, ...change }), (error) => error instanceof SynbiosError && error.code === 'invalid_input', label);
  refuse({ title: '' }, 'empty title');
  refuse({ title: ' \t ' }, 'blank title');
  refuse({ title: ch(0x1c) }, 'Python whitespace only');
  refuse({ title: ch(0xfeff) }, 'JavaScript whitespace only');
  refuse({ title: 't'.repeat(257) }, 'title over 256');
  refuse({ title: `bad ${ch(0xd800)}` }, 'lone surrogate');
  refuse({ title: `bad${ch(0)}` }, 'control character');
  refuse({ title: 42 }, 'non-string title');
  refuse({ description: 'd'.repeat(8193 - REFERENCE_SUFFIX.length) }, 'description plus reference over 8192');
  refuse({ description: 'Text\nkoinos-project: 3f2b8c1e-6a4d-4e2f-9b1a-7c5d3e8f0a12' }, 'spoofed reference line');
  refuse({ criteria: [] }, 'no criteria');
  refuse({ criteria: [' '] }, 'blank criterion');
  refuse({ criteria: Array(1001).fill('c') }, 'over 1000 criteria');
  refuse({ criteria: 'one' }, 'criteria not an array');
  refuse({ scope: undefined }, 'missing scope');
  refuse({ koinos: undefined }, 'missing koinos');
  refuse({ koinos: { ...KOINOS, project: 'not-a-uuid' } }, 'bad project');
  refuse({ koinos: { ...KOINOS, project: KOINOS.project.toUpperCase() } }, 'uppercase project');
  refuse({ koinos: { ...KOINOS, agreement: 'abc' } }, 'short agreement');
  refuse({ koinos: { ...KOINOS, termsDigest: KOINOS.termsDigest.toUpperCase() } }, 'uppercase digest');
  refuse({ koinos: { ...KOINOS, extra: 'x' } }, 'extra koinos field');
  refuse({ owner: 'Ada' }, 'unknown charter field');
  refuse({ synbiosProject: 'project-1' }, 'bad Synbios project id');
  refuse({ priority: 'urgent' }, 'bad priority');
  assert.throws(() => taskFromCharter(null), SynbiosError);
});

test('parseKoinosReference refuses a duplicated or malformed reference', () => {
  assert.equal(parseKoinosReference('No reference here.'), null);
  const doubled = `x${REFERENCE_SUFFIX}${REFERENCE_SUFFIX}`;
  assert.throws(() => parseKoinosReference(doubled), { code: 'invalid_reference' });
  assert.throws(() => parseKoinosReference(`x${REFERENCE_SUFFIX.replace(KOINOS.agreement, 'nothex')}`), { code: 'invalid_reference' });
  assert.throws(() => parseKoinosReference(`x${REFERENCE_SUFFIX}\ntrailing`), { code: 'invalid_reference' });
});

// ---------------------------------------------------------------------------
// inspectExport

test('inspectExport summarizes an accepted export', () => {
  const bundle = buildBundle();
  const summary = inspectExport(exportBytes(bundle));
  assert.deepEqual(summary.task, { id: ID(20), title: CHARTER.title, status: 'accepted', projectId: ID(10) });
  assert.deepEqual(summary.project, { id: ID(10), name: 'Recipe scaler (synthetic)' });
  assert.deepEqual(summary.koinos, KOINOS);
  assert.deepEqual(summary.artifact, { id: ID(30), title: 'Recipe scaling notes', kind: 'document', revision: DOC_DIGEST, digest: DOC_DIGEST });
  assert.deepEqual(summary.evidence, [
    { kind: 'test', status: 'passed', command: 'node --test test/scale.test.mjs', summary: 'Synthetic fixture: three scaling cases.', tool: 'node:test', current: true },
  ]);
  assert.deepEqual(summary.reviews, [{ decision: 'approved', reviewer: { id: ID(1), name: 'Ada', kind: 'human' }, revision: DOC_DIGEST, current: true }]);
  assert.equal(summary.bundleDigest, bundle.bundle_digest);
  assert.deepEqual(summary.integrity, { valid: true, errors: [] });
  assert.deepEqual(summary.limitations, bundle.limitations);
  assert.deepEqual(summary.warnings, []);
});

test('inspectExport reads pretty-printed and compact forms of the same export alike', () => {
  const bundle = buildBundle();
  const compact = inspectExport(exportBytes(bundle));
  assert.deepEqual(inspectExport(`${JSON.stringify(bundle, null, 2)}\n`), compact);
  assert.deepEqual(inspectExport(new TextEncoder().encode(JSON.stringify(bundle))), compact);
});

test('inspectExport reports an export that is not accepted yet', () => {
  const summary = inspectExport(exportBytes(buildBundle({ decision: null })));
  assert.equal(summary.task.status, 'in_review');
  assert.deepEqual(summary.reviews, []);
  assert.equal(summary.integrity.valid, true);
  assert.ok(summary.warnings.includes('task status is in_review, not accepted'));

  const declined = inspectExport(exportBytes(buildBundle({ decision: 'changes_requested' })));
  assert.equal(declined.task.status, 'changes_requested');
  assert.equal(declined.reviews[0].decision, 'changes_requested');
  assert.equal(declined.integrity.valid, true);
});

test('inspectExport detects edits that were not re-hashed', () => {
  const edited = buildBundle();
  edited.task.title = 'Edited title';
  const summary = inspectExport(exportBytes(edited));
  assert.equal(summary.integrity.valid, false);
  assert.ok(summary.integrity.errors.includes('bundle_digest does not match the bundle'));
  assert.ok(summary.integrity.errors.includes('task does not match its last audited event'));
  assert.ok(summary.warnings[0].startsWith('export failed internal consistency checks'));

  // Recomputing only the bundle digest still leaves the audit mismatch.
  const resealed = inspectExport(exportBytes(reseal(edited)));
  assert.deepEqual(resealed.integrity.errors, ['task does not match its last audited event']);

  // Rewriting the event and its hash breaks its audit_chain commitment.
  const rewritten = buildBundle();
  rewritten.task.title = 'Edited title';
  const last = rewritten.events.at(-1);
  last.payload.task.title = 'Edited title';
  delete last.hash;
  last.hash = canonicalHash(last);
  const result = inspectExport(exportBytes(reseal(rewritten)));
  assert.deepEqual(result.integrity.errors, ['a task event does not match its audit_chain commitment']);
});

test('inspectExport applies the acceptance rules a Synbios export must satisfy', () => {
  const selfReview = inspectExport(exportBytes(buildBundle({ reviewer: 'scribe' })));
  assert.ok(selfReview.integrity.errors.includes('a review is by the author of the artifact it reviews'));
  assert.ok(selfReview.integrity.errors.includes('accepted task was not approved by a listed human principal'));

  const failing = inspectExport(exportBytes(buildBundle({ testStatus: 'failed' })));
  assert.deepEqual(failing.integrity.errors, ['accepted task lacks passing, non-failing test evidence for its current artifact']);

  const unbound = inspectExport(exportBytes(buildBundle({ evidenceArtifact: ID(77) })));
  assert.ok(unbound.integrity.errors.includes('evidence cites an unknown artifact'));
  assert.equal(unbound.evidence[0].current, false);
});

test('inspectExport warns about text that must not reach shared records', () => {
  // Built at run time so this file holds no literal local path or address.
  const localDir = ['', 'home', 'ada', 'recipes'].join('/');
  const summary = inspectExport(
    exportBytes(
      buildBundle({
        artifactUri: `file://${localDir}#${'a'.repeat(40)}`,
        evidenceCommand: `node --test ${localDir}/test`,
        reviewComment: `Reviewed by ${['ada', 'example.com'].join('@')} ${ch(0x202e)}reversed`,
      }),
    ),
  );
  assert.equal(summary.integrity.valid, true);
  assert.ok(summary.warnings.includes('local file URI in task.artifacts[0].uri; do not copy it into shared or public records'));
  assert.ok(summary.warnings.includes('absolute local path in task.evidence[0].command; do not copy it into shared or public records'));
  assert.ok(summary.warnings.includes('email address in task.reviews[0].comment; do not copy it into shared or public records'));
  assert.ok(summary.warnings.includes('bidirectional control characters in task.reviews[0].comment; do not copy it into shared or public records'));
  // Each issue is reported once per field, not again for each event copy.
  assert.equal(summary.warnings.filter((warning) => warning.startsWith('local file URI')).length, 1);
  // The artifact URI itself is left out of the summary.
  assert.equal(JSON.stringify(summary).includes('file:'), false);
});

test('inspectExport reports a missing or ambiguous Koinos reference', () => {
  const missing = inspectExport(exportBytes(buildBundle({ description: 'No reference.' })));
  assert.equal(missing.koinos, null);
  assert.ok(missing.warnings.includes('task description carries no Koinos reference'));

  const doubled = inspectExport(exportBytes(buildBundle({ description: `x${REFERENCE_SUFFIX}${REFERENCE_SUFFIX}` })));
  assert.equal(doubled.koinos, null);
  assert.ok(doubled.warnings.includes('Task description has a malformed or ambiguous Koinos reference'));
});

test('inspectExport refuses malformed and hostile exports', () => {
  const good = pythonDumps(buildBundle());
  const encode = (text) => new TextEncoder().encode(text);
  const mutated = (change) => {
    const bundle = buildBundle();
    change(bundle);
    return pythonDumps(bundle);
  };
  const withPlaceholder = (raw) => good.replace(`"title": "${CHARTER.title}"`, `"title": ${raw}`);
  const deep = `${'['.repeat(100)}${']'.repeat(100)}`;
  const cases = {
    'invalid UTF-8': new Uint8Array([0x7b, 0xff, 0x7d]),
    'byte order mark': new Uint8Array([0xef, 0xbb, 0xbf, ...encode(good)]),
    'duplicate key': good.replace('"version": 1, ', '"version": 1, "version": 1, '),
    'prototype key': good.replace('{', '{"__proto__": {}, '),
    'lone surrogate': withPlaceholder(`"${BS}ud800"`),
    'float version': good.replace('"version": 1, ', '"version": 1.0, '),
    'unsafe integer': good.replace('"version": 1, ', '"version": 9007199254740993, '),
    'deep nesting': withPlaceholder(deep),
    'trailing data': `${good} {}`,
    empty: '',
    'top-level array': '[]',
    'wrong format': mutated((b) => (b.format = 'synbios-tasks')),
    'wrong version': mutated((b) => (b.version = 2)),
    'unknown task field': mutated((b) => (b.task.extra = 'x')),
    'missing task field': mutated((b) => delete b.task.priority),
    'unknown status': mutated((b) => (b.task.status = 'done')),
    'uppercase digest': mutated((b) => (b.task.artifacts[0].digest = DOC_DIGEST.toUpperCase())),
    'short git revision': mutated((b) => Object.assign(b.task.artifacts[0], { kind: 'git_commit', revision: 'abc123' })),
    'bad id': mutated((b) => (b.task.id = '../../etc')),
    'principal not an object': mutated((b) => (b.principals[0] = 'Ada')),
    'unexpected payload field': mutated((b) => (b.events[0].payload.note = 'x')),
    'stale field left in evidence': mutated((b) => (b.task.evidence[0].stale = false)),
    'oversize input': new Uint8Array(MAX_EXPORT_BYTES + 1),
  };
  for (const [label, input] of Object.entries(cases)) {
    assert.throws(
      () => inspectExport(typeof input === 'string' ? encode(input) : input),
      (error) => error instanceof SynbiosError && error.code === 'invalid_export',
      label,
    );
  }
  assert.throws(() => inspectExport({ not: 'bytes' }), { code: 'invalid_input' });
});

// ---------------------------------------------------------------------------
// SynbiosClient against a fake local Synbios

const TOKEN = 'synthetic-ada-token_0123456789abcdefghijklmn';
const REDIRECT_TASK = ID(0xdead);
const GZIP_TASK = ID(0xbeef);
const HTML_TASK = ID(0xcafe);
const BAD_BUNDLE_TASK = ID(0xf00d);

async function startFakeSynbios() {
  const fake = {
    requests: [],
    discovery: { name: 'Synbios', protocol_version: 1, api: '/api', authentication: 'bearer', local_only: true },
    exports: new Map(),
  };
  const send = (res, status, value, headers = {}) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(pythonDumps(value));
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': bytes.length, 'cache-control': 'no-store', ...headers });
    res.end(bytes);
  };
  const route = (req, res, body) => {
    const port = fake.server.address().port;
    if (![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(req.headers.host)) return send(res, 403, { error: 'Invalid Host' });
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return send(res, 403, { error: 'Cross-origin request refused' });
    const { pathname } = new URL(req.url, 'http://fake.invalid');
    if (req.method === 'GET' && pathname === '/.well-known/synbios.json') return send(res, 200, fake.discovery);
    if (req.method === 'GET' && pathname === '/api/health') return send(res, 200, { ok: true, version: 1 });
    if (!pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { error: 'Invalid credential' });
    if (req.method === 'GET' && pathname === '/api/state') {
      return send(res, 200, { version: 1, actor: { id: ID(1), name: 'Ada', kind: 'human' }, projects: [], tasks: [], principals: [], grants: [], events: [] });
    }
    const exportMatch = /^\/api\/tasks\/([^/]+)\/export$/.exec(pathname);
    if (req.method === 'GET' && exportMatch) {
      const id = exportMatch[1];
      if (id === REDIRECT_TASK) {
        res.writeHead(302, { location: '/api/elsewhere', 'content-length': 0 });
        return res.end();
      }
      if (id === GZIP_TASK) return send(res, 200, Buffer.from('{}'), { 'content-encoding': 'gzip' });
      if (id === HTML_TASK) return send(res, 200, Buffer.from('<html></html>'), { 'content-type': 'text/html' });
      if (id === BAD_BUNDLE_TASK) return send(res, 200, { format: 'something-else', version: 1 });
      return fake.exports.has(id) ? send(res, 200, fake.exports.get(id)) : send(res, 404, { error: 'Task not found' });
    }
    if (req.method === 'POST' && pathname.startsWith('/api/commands/')) {
      if (req.headers['transfer-encoding']) return send(res, 400, { error: 'Transfer encoding is not supported' });
      if (req.headers['content-length'] === undefined) return send(res, 400, { error: 'Content-Length required' });
      if (req.headers['content-type'] !== 'application/json') return send(res, 415, { error: 'Expected application/json' });
      let value;
      try {
        value = JSON.parse(body.toString('utf8'));
      } catch {
        return send(res, 400, { error: 'Invalid JSON' });
      }
      const action = pathname.slice('/api/commands/'.length);
      // A hostile local server could echo the credential back in an error.
      if (action === 'review.create') return send(res, 403, { error: `Independent human reviewer required; you sent ${req.headers.authorization}` });
      return send(res, 200, { id: ID(99), action, received: value });
    }
    return send(res, 404, { error: 'Unknown API route' });
  };
  fake.server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      fake.requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      route(req, res, body);
    });
  });
  await new Promise((resolve) => fake.server.listen(0, '127.0.0.1', resolve));
  fake.baseUrl = `http://127.0.0.1:${fake.server.address().port}`;
  fake.close = () =>
    new Promise((resolve) => {
      fake.server.closeAllConnections();
      fake.server.close(resolve);
    });
  return fake;
}

describe('SynbiosClient against a fake local Synbios', () => {
  let fake;
  before(async () => {
    fake = await startFakeSynbios();
  });
  after(async () => {
    await fake.close();
  });
  const client = (options = {}) => new SynbiosClient({ baseUrl: fake.baseUrl, token: TOKEN, ...options });

  test('refuses base URLs that are not a loopback http origin', () => {
    for (const baseUrl of [
      'http://example.com:8765',
      'https://127.0.0.1:8765',
      'http://10.0.0.1:8765',
      'http://127.0.0.1',
      'http://ada:pw@127.0.0.1:8765',
      'http://127.0.0.1:8765/api',
      'http://127.0.0.1:8765/?q=1',
      'http://127.0.0.1:8765/#f',
      'not a url',
      undefined,
    ]) {
      assert.throws(() => new SynbiosClient({ baseUrl, token: TOKEN }), { code: 'invalid_input' }, String(baseUrl));
    }
    for (const baseUrl of ['http://localhost:8765', 'http://[::1]:8765', 'http://127.0.0.1:8765/']) {
      assert.ok(new SynbiosClient({ baseUrl }).baseUrl.startsWith('http://'));
    }
    assert.throws(() => new SynbiosClient({ baseUrl: fake.baseUrl, token: 'two\nlines' }), { code: 'invalid_input' });
    assert.throws(() => new SynbiosClient({ baseUrl: fake.baseUrl, timeoutMs: 0 }), { code: 'invalid_input' });
    assert.throws(() => new SynbiosClient({ baseUrl: fake.baseUrl, fetch: 'no' }), { code: 'invalid_input' });
  });

  test('discover checks protocol_version and local_only and sends no credential', async () => {
    const doc = await client().discover();
    assert.equal(doc.protocol_version, 1);
    assert.equal(fake.requests.at(-1).headers.authorization, undefined);

    fake.discovery = { ...fake.discovery, protocol_version: 2 };
    await assert.rejects(client().discover(), { code: 'protocol' });
    fake.discovery = { ...fake.discovery, protocol_version: 1, local_only: false };
    await assert.rejects(client().discover(), { code: 'protocol' });
    fake.discovery = { ...fake.discovery, local_only: true };
  });

  test('health needs no credential; state uses the bearer token', async () => {
    assert.deepEqual(await new SynbiosClient({ baseUrl: fake.baseUrl }).health(), { ok: true, version: 1 });
    assert.equal(fake.requests.at(-1).headers.authorization, undefined);
    const state = await client().state();
    assert.equal(state.actor.name, 'Ada');
    assert.equal(fake.requests.at(-1).headers.authorization, `Bearer ${TOKEN}`);
    await assert.rejects(new SynbiosClient({ baseUrl: fake.baseUrl }).state(), { code: 'invalid_input' });
    await assert.rejects(client({ token: 'wrong-token' }).state(), (error) => error.code === 'http' && error.status === 401);
  });

  test('command sends exactly the headers and body Synbios requires', async () => {
    const body = taskFromCharter({ ...CHARTER, synbiosProject: ID(10) });
    const result = await client().command('task.create', body);
    assert.deepEqual(result.received, body);
    const request = fake.requests.at(-1);
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/api/commands/task.create');
    assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(request.headers['content-type'], 'application/json');
    assert.equal(Number(request.headers['content-length']), request.body.length);
    assert.equal(request.headers['transfer-encoding'], undefined);
    assert.equal(request.headers.origin, undefined);
    assert.equal(request.headers.host, new URL(fake.baseUrl).host);
  });

  test('command refuses unknown commands and fields before sending anything', async () => {
    const before = fake.requests.length;
    await assert.rejects(client().command('task.delete', { task_id: ID(20) }), { code: 'invalid_input' });
    await assert.rejects(client().command('../state', {}), { code: 'invalid_input' });
    await assert.rejects(client().command('task.claim', { task_id: ID(20), actor: 'Ada' }), { code: 'invalid_input' });
    await assert.rejects(client().command('task.claim', [ID(20)]), { code: 'invalid_input' });
    assert.equal(fake.requests.length, before);
  });

  test('errors carry the status and never the credential', async () => {
    const error = await client()
      .command('review.create', { task_id: ID(20), artifact_id: ID(30), revision: DOC_DIGEST, decision: 'approved' })
      .then(() => assert.fail('expected a refusal'), (caught) => caught);
    assert.ok(error instanceof SynbiosError);
    assert.equal(error.status, 403);
    assert.match(error.message, /Independent human reviewer required/);
    assert.match(error.message, /\[redacted\]/);
    assert.equal(`${error.message}${error.stack}`.includes(TOKEN), false);
  });

  test('the client does not expose its token', () => {
    const instance = client();
    assert.equal(util.inspect(instance, { showHidden: true, depth: 5 }).includes(TOKEN), false);
    assert.equal(JSON.stringify(instance).includes(TOKEN), false);
    assert.deepEqual(Object.keys(instance), []);
  });

  test('exportTask returns the exact response bytes with their digest and ni: URI', async () => {
    const bytes = exportBytes(buildBundle());
    fake.exports.set(ID(20), Buffer.from(bytes));
    const result = await client().exportTask(ID(20));
    assert.deepEqual(result.bytes, bytes);
    assert.equal(result.digest, sha256Hex(bytes));
    assert.equal(result.uri, `ni:///sha-256;${Buffer.from(result.digest, 'hex').toString('base64url')}`);
    assert.match(result.uri, /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/);
    assert.equal(inspectExport(result.bytes).task.status, 'accepted');
  });

  test('exportTask refuses redirects without following them', async () => {
    const before = fake.requests.length;
    await assert.rejects(client().exportTask(REDIRECT_TASK), (error) => error.code === 'redirect' && error.status === 302);
    assert.equal(fake.requests.length, before + 1);
    assert.equal(fake.requests.some((request) => request.url === '/api/elsewhere'), false);
  });

  test('exportTask refuses encoded, non-JSON, non-bundle, oversized, and unknown responses', async () => {
    await assert.rejects(client().exportTask(GZIP_TASK), { code: 'invalid_response' });
    await assert.rejects(client().exportTask(HTML_TASK), { code: 'invalid_response' });
    await assert.rejects(client().exportTask(BAD_BUNDLE_TASK), { code: 'invalid_response' });
    await assert.rejects(client({ maxExportBytes: 64 }).exportTask(ID(20)), { code: 'too_large' });
    await assert.rejects(client().exportTask(ID(21)), (error) => error.code === 'http' && error.status === 404);
    await assert.rejects(client().exportTask('../state'), { code: 'invalid_input' });
  });

  test('a network failure reports no request details', async () => {
    const closed = await startFakeSynbios();
    const baseUrl = closed.baseUrl;
    await closed.close();
    const error = await new SynbiosClient({ baseUrl, token: TOKEN })
      .state()
      .then(() => assert.fail('expected a network error'), (caught) => caught);
    assert.equal(error.code, 'network');
    assert.equal(error.message.includes(TOKEN), false);
  });
});

// ---------------------------------------------------------------------------
// Command line

function capture() {
  const out = { text: '', write(chunk) { out.text += chunk; } };
  return out;
}

async function run(argv) {
  const stdout = capture();
  const stderr = capture();
  const code = await synbiosCommand(argv, { stdout, stderr, env: {} });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

const TASK_ARGS = [
  'task',
  '--project', KOINOS.project,
  '--agreement', KOINOS.agreement,
  '--terms-digest', KOINOS.termsDigest,
  '--title', CHARTER.title,
  '--description', CHARTER.description,
];

describe('exofab synbios command line', () => {
  let dir;
  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'exofab-synbios-test-'));
  });
  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('task prints the task.create body', async () => {
    const result = await run([...TASK_ARGS, '--criteria', ...CHARTER.criteria, '--scope', ...CHARTER.scope]);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), taskFromCharter(CHARTER));

    const repeated = await run([...TASK_ARGS, `--criteria=${CHARTER.criteria[0]}`, '--criteria', CHARTER.criteria[1], '--scope', CHARTER.scope[0], '--synbios-project', ID(10)]);
    assert.equal(repeated.code, 0, repeated.stderr);
    assert.deepEqual(JSON.parse(repeated.stdout), taskFromCharter({ ...CHARTER, synbiosProject: ID(10) }));
  });

  test('task reports usage errors and invalid input', async () => {
    const missing = await run(TASK_ARGS.filter((arg, index) => index < 5 || index > 6).concat(['--criteria', 'c', '--scope', 's']));
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /--terms-digest is required/);
    assert.match(missing.stderr, /Usage:/);

    const noCriteria = await run([...TASK_ARGS, '--scope', 's']);
    assert.equal(noCriteria.code, 2);

    const unknown = await run([...TASK_ARGS, '--criteria', 'c', '--scope', 's', '--owner', 'Ada']);
    assert.equal(unknown.code, 2);

    const badDigest = await run([...TASK_ARGS.slice(0, 6), KOINOS.termsDigest.toUpperCase(), ...TASK_ARGS.slice(7), '--criteria', 'c', '--scope', 's']);
    assert.equal(badDigest.code, 1);
    assert.match(badDigest.stderr, /termsDigest/);
    assert.equal(badDigest.stdout, '');
  });

  test('inspect prints the summary and exits by consistency', async () => {
    const good = path.join(dir, 'good.json');
    await writeFile(good, exportBytes(buildBundle()));
    const ok = await run(['inspect', good]);
    assert.equal(ok.code, 0, ok.stderr);
    assert.deepEqual(JSON.parse(ok.stdout), inspectExport(exportBytes(buildBundle())));

    const edited = buildBundle();
    edited.task.title = 'Edited title';
    const tampered = path.join(dir, 'tampered.json');
    await writeFile(tampered, exportBytes(edited));
    const bad = await run(['inspect', tampered]);
    assert.equal(bad.code, 1);
    assert.equal(JSON.parse(bad.stdout).integrity.valid, false);
  });

  test('inspect escapes characters that could reorder terminal output', async () => {
    const file = path.join(dir, 'bidi.json');
    await writeFile(file, exportBytes(buildBundle({ evidenceCommand: `node --test ${ch(0x202e)} ${ch(0x9b)}31m` })));
    const result = await run(['inspect', file]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout.includes(ch(0x202e)), false);
    assert.equal(result.stdout.includes(ch(0x9b)), false);
    assert.ok(result.stdout.includes(`${BS}u202e`));
    assert.ok(JSON.parse(result.stdout).warnings.some((warning) => warning.startsWith('bidirectional control characters')));
  });

  test('inspect refuses malformed or missing files and bad usage', async () => {
    const malformed = path.join(dir, 'malformed.json');
    await writeFile(malformed, '{"version": 1, "version": 1}');
    const parsed = await run(['inspect', malformed]);
    assert.equal(parsed.code, 1);
    assert.match(parsed.stderr, /Invalid Synbios export/);

    const missing = await run(['inspect', path.join(dir, 'absent.json')]);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /cannot read export file \(ENOENT\)/);

    assert.equal((await run(['inspect'])).code, 2);
    assert.equal((await run(['inspect', 'a.json', 'b.json'])).code, 2);
    assert.equal((await run(['frobnicate'])).code, 2);
    assert.equal((await run([])).code, 2);
    const help = await run(['--help']);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /exofab synbios inspect/);
  });
});
