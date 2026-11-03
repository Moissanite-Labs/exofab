// End-to-end tests: the synthetic demonstration through the HTTP API, what it
// leaves in the hub's data directory, offline verification of its export
// (including the cited bytes), re-import into a fresh hub, and negative
// journeys over HTTP. Synthetic people Ada and Ben, agent scribe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { runDemo, DEMO_CHARTER, DEMO_COMPENSATION, NO_ECONOMIC_RIGHT } from '../src/demo.mjs';
import { main } from '../src/cli.mjs';
import { verifyExport } from '../src/export.mjs';
import { createServer } from '../src/server.mjs';
import { ExofabClient } from '../src/client.mjs';
import { FileStore } from '../src/hub/store.mjs';
import { Hub } from '../src/hub/hub.mjs';
import { canonicalize, draftRecord, fromUtf8, generateIdentity, sha256Hex, signDraft, utf8, verifyBundle } from '../src/koinos/index.mjs';
import { termsFromBytes, termsGate } from '../web/format.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const TEXT = 'text/plain; charset=utf-8';

async function tempDir(t, prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function capture() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      chunks.push(chunk);
      done();
    },
  });
  stream.text = () => Buffer.concat(chunks).toString('utf8');
  return stream;
}

async function cli(args, env = {}) {
  const stdout = capture();
  const stderr = capture();
  const status = await main(args, { stdout, stderr, env });
  return { status, stdout: stdout.text(), stderr: stderr.text() };
}

async function files(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) out.push(join(entry.parentPath ?? entry.path, entry.name));
  }
  return out.sort();
}

// True if any object in the value has a member named `name`.
function hasMember(value, name) {
  if (Array.isArray(value)) return value.some((v) => hasMember(v, name));
  if (value && typeof value === 'object') return Object.keys(value).some((k) => k === name || hasMember(value[k], name));
  return false;
}

// One demonstration run shared by the tests below.
let demoRun;
async function demo(t) {
  demoRun ??= (async () => {
    const root = await mkdtemp(join(tmpdir(), 'exofab-e2e-'));
    const lines = [];
    const result = await runDemo({ dataDir: join(root, 'data'), outDir: join(root, 'out'), log: (line) => lines.push(line) });
    return { root, dataDir: join(root, 'data'), outDir: join(root, 'out'), result, lines };
  })();
  return demoRun;
}

test.after(async () => {
  if (demoRun) await rm((await demoRun).root, { recursive: true, force: true });
});

test('the demonstration completes the first-slice journey through the HTTP API', async (t) => {
  const { result, lines, outDir } = await demo(t);
  assert.equal(result.count, 8);
  assert.equal(result.verified.ok, true);
  assert.equal(result.verified.head, result.head);
  assert.equal(result.verified.blobs, 2);
  assert.equal(result.credit.length, 1);
  assert.equal(result.credit[0].via, result.agent);
  assert.match(lines[0], /synthetic/i);
  assert.ok(lines.some((l) => l.includes(DEMO_COMPENSATION)));
  assert.ok(lines.some((l) => /shared skill: exo-skills/.test(l)));
  assert.ok(DEMO_CHARTER.includes(NO_ECONOMIC_RIGHT));
  for (const heading of ['Scope', 'Acceptance criteria', 'Credit']) assert.ok(DEMO_CHARTER.includes(`\n${heading}\n`), heading);

  const bundle = JSON.parse(await readFile(join(outDir, 'bundle.json'), 'utf8'));
  const state = await verifyBundle(bundle);
  assert.deepEqual(bundle.records.map((r) => r.kind), [
    'project.created',
    'agreement.proposed',
    'agreement.consented',
    'agreement.consented',
    'delegation.granted',
    'contribution.submitted',
    'contribution.reviewed',
    'contribution.accepted',
  ]);
  const signers = bundle.records.map((r) => r.actor);
  const { ada, ben } = result.people;
  assert.deepEqual(signers, [ada, ada, ada, ben, ben, result.agent, ada, ada]);
  assert.deepEqual(state.participants.map((p) => [p.name, p.kind]), [['Ada', 'human'], ['Ben', 'human'], ['scribe', 'agent']]);
  assert.equal(state.project.steward, ada);
  const [contribution] = state.contributions;
  assert.equal(contribution.status, 'accepted');
  assert.equal(contribution.principal, ben);
  assert.deepEqual(state.agreements[0].consents, [ada, ben]);
  assert.equal(state.agreements[0].digest, await sha256Hex(DEMO_CHARTER));
  const delegation = state.delegations[0];
  const days = (Date.parse(delegation.expires) - Date.parse(bundle.records[4].time)) / DAY_MS;
  assert.ok(Math.abs(days - 14) < 0.01, `delegation lasts ${days} days`);
  const verifyNote = await readFile(join(outDir, 'VERIFY.txt'), 'utf8');
  assert.ok(verifyNote.includes(`--expect-head ${result.head}`));
  assert.ok(verifyNote.includes(state.project.id));
  // Commands that run as written (no `exofab` on PATH is assumed), from the export directory.
  assert.ok(verifyNote.includes(`node "$EXOFAB/src/cli.mjs" verify bundle.json --blobs blobs --expect-project ${result.project} --expect-head ${result.head}`));
  assert.ok(verifyNote.includes(`node "$KOINOS/src/cli.mjs" verify ./bundle.json ${result.head} ${result.project}`));
  assert.doesNotMatch(verifyNote, /^\s*exofab /m);
  assert.match(verifyNote, /any other URI is shown with a\s+warning and is never fetched/);
});

test('the hub data directory holds no private key material after the demonstration', async (t) => {
  const { dataDir } = await demo(t);
  const all = await files(dataDir);
  assert.ok(all.some((f) => f.endsWith('hub.json')));
  assert.ok(all.some((f) => f.includes(join('projects', ''))));
  for (const file of all) {
    const bytes = await readFile(file);
    const text = bytes.toString('latin1');
    assert.ok(!text.includes('PRIVATE KEY'), `${file} contains PEM key text`);
    assert.ok(!/"d"\s*:/.test(text), `${file} contains a JWK "d" member`);
    if (file.endsWith('.json')) assert.ok(!hasMember(JSON.parse(bytes.toString('utf8')), 'd'), file);
  }
  // Tokens are stored only as SHA-256 hashes.
  const credentials = JSON.parse(await readFile(join(dataDir, 'credentials.json'), 'utf8'));
  for (const hash of Object.keys(credentials.tokens)) assert.match(hash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(credentials).includes('exf_'));
});

test('the export verifies offline, including every cited digest, and tampering is caught', async (t) => {
  const { outDir, result } = await demo(t);
  const bundlePath = join(outDir, 'bundle.json');
  const blobsDir = join(outDir, 'blobs');
  const checked = await verifyExport({ bundlePath, blobsDir, expectedHead: result.head, expectedProject: result.project });
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.blobs.map((b) => [b.kind, b.ok, b.uriChecked]), [['agreement', true, true], ['artifact', true, true]]);
  assert.deepEqual((await readdir(blobsDir)).sort(), checked.blobs.map((b) => b.digest).sort());

  const ok = await cli(['verify', bundlePath, '--blobs', blobsDir, '--expect-head', result.head, '--expect-project', result.project]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).ok, true);
  // The hub cites only ni: URIs, and verify says it checked each one.
  assert.deepEqual(JSON.parse(ok.stdout).blobs.map((b) => [b.uri, b.uriChecked]), checked.blobs.map((b) => [b.uri, true]));
  assert.equal(ok.stderr, '');
  assert.equal((await cli(['verify', bundlePath])).status, 0);

  const wrongHead = await cli(['verify', bundlePath, '--expect-head', '0'.repeat(64)]);
  assert.equal(wrongHead.status, 1);
  assert.match(wrongHead.stderr, /pin/);

  // A copy with one changed byte in the artifact.
  const copy = await tempDir(t, 'exofab-tamper-');
  const artifactDigest = checked.blobs.find((b) => b.kind === 'artifact').digest;
  const charterDigest = checked.blobs.find((b) => b.kind === 'agreement').digest;
  const bytes = await readFile(join(blobsDir, artifactDigest));
  bytes[0] ^= 1;
  await writeFile(join(copy, artifactDigest), bytes);
  await writeFile(join(copy, charterDigest), await readFile(join(blobsDir, charterDigest)));
  const tampered = await cli(['verify', bundlePath, '--blobs', copy]);
  assert.equal(tampered.status, 1);
  const report = JSON.parse(tampered.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.blobs.find((b) => b.kind === 'artifact').problem, 'file bytes do not match the digest');
  await rm(join(copy, charterDigest));
  assert.equal(JSON.parse((await cli(['verify', bundlePath, '--blobs', copy])).stdout).blobs[0].problem, 'file is missing');

  // A record changed in the bundle no longer verifies.
  const bundle = JSON.parse(await readFile(bundlePath, 'utf8'));
  bundle.records[5].body.summary = 'Changed after signing.';
  const changed = join(copy, 'bundle.json');
  await writeFile(changed, JSON.stringify(bundle));
  const refused = await cli(['verify', changed]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /does not verify \(id\)/);
});

test('an --out directory that already holds part of an export is refused before the demonstration starts', async (t) => {
  const out = await tempDir(t, 'exofab-demo-out-');
  const data = await tempDir(t, 'exofab-demo-data-');
  await writeFile(join(out, 'VERIFY.txt'), 'old\n');
  const run = await cli(['demo', '--out', out, '--data', join(data, 'hub')]);
  assert.equal(run.status, 1);
  assert.equal(run.stdout, '', 'no step of the journey ran');
  assert.match(run.stderr, /VERIFY\.txt already exists; choose an empty or new output directory/);
  assert.deepEqual(await readdir(out), ['VERIFY.txt'], 'no bundle.json or blobs/ was created');
  assert.equal(await readFile(join(out, 'VERIFY.txt'), 'utf8'), 'old\n');
  assert.deepEqual(await readdir(data), [], 'no hub data directory was created');
});

test('export refuses a directory holding any part of an export, even a dangling link, and writes nothing', async (t) => {
  const { dataDir, result } = await demo(t);
  for (const [name, make] of [
    ['bundle.json', (path) => writeFile(path, 'old\n')],
    ['blobs', (path) => writeFile(path, '')],
    ['VERIFY.txt', (path) => symlink(join(path, '..', 'nowhere'), path)],
  ]) {
    const out = await tempDir(t, 'exofab-export-out-');
    await make(join(out, name));
    const exported = await cli(['export', result.project, out, '--data', dataDir]);
    assert.equal(exported.status, 1, name);
    assert.match(exported.stderr, /already exists; choose an empty or new output directory/, name);
    assert.deepEqual(await readdir(out), [name], `${name}: nothing else was written`);
  }
});

test('importing the export into a fresh hub keeps the head, the state and the bytes', async (t) => {
  const { outDir, result, dataDir } = await demo(t);
  const fresh = await tempDir(t, 'exofab-import-');
  const bundlePath = join(outDir, 'bundle.json');
  const imported = await cli(['import', bundlePath, '--data', fresh, '--expect-head', result.head, '--blobs', join(outDir, 'blobs')]);
  assert.equal(imported.status, 0, imported.stderr);
  assert.deepEqual(JSON.parse(imported.stdout), { project: result.project, head: result.head, count: 8, imported: true, blobs: 2 });
  const again = await cli(['import', bundlePath, '--data', fresh]);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(JSON.parse(again.stdout).imported, false);

  const original = await new FileStore(dataDir).readBundle(result.project);
  const copy = await new FileStore(fresh).readBundle(result.project);
  assert.equal(canonicalize(copy), canonicalize(original));
  assert.deepEqual(await verifyBundle(copy), await verifyBundle(original));
  assert.equal((await new FileStore(fresh).readPins())[result.project], result.head);

  // An offline export from the fresh hub is byte-identical to the original.
  const reexport = join(fresh, 'reexport');
  const exported = await cli(['export', result.project, reexport, '--data', fresh]);
  assert.equal(exported.status, 0, exported.stderr);
  for (const name of ['bundle.json', 'VERIFY.txt', ...(await readdir(join(outDir, 'blobs'))).map((d) => join('blobs', d))]) {
    assert.deepEqual(await readFile(join(reexport, name)), await readFile(join(outDir, name)), name);
  }
  // Exports never overwrite.
  const twice = await cli(['export', result.project, reexport, '--data', fresh]);
  assert.equal(twice.status, 1);
  assert.match(twice.stderr, /already exists/);

  // A bundle that does not extend the stored history is refused.
  const shorter = { format: 'koinos-bundle/0.1', records: JSON.parse(await readFile(bundlePath, 'utf8')).records.slice(0, 7) };
  const other = await tempDir(t, 'exofab-import-');
  await writeFile(join(other, 'short.json'), JSON.stringify(shorter));
  const refused = await cli(['import', join(other, 'short.json'), '--data', fresh]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /does not extend/);
});

// --- Negative journeys over HTTP ----------------------------------------------------------

async function journey(t) {
  const dir = await tempDir(t, 'exofab-e2e-hub-');
  const server = await createServer({ hub: new Hub({ store: new FileStore(dir) }), port: 0, log: () => {} });
  t.after(() => server.close());
  const hub = new ExofabClient({ baseUrl: server.url });
  const person = async (name) => {
    const identity = await generateIdentity();
    return { identity, id: identity.id, client: hub.withToken((await hub.registerPerson({ name, identity })).token) };
  };
  const ada = await person('Ada');
  const ben = await person('Ben');
  await ben.client.updateProfile({ skills: ['exo-skills', 'testing'], listed: true });
  const brief = await ada.client.publishBrief({
    title: 'Recipe-scaling skill (synthetic)',
    summary: 'Synthetic negative-journey brief.',
    compensation: DEMO_COMPENSATION,
    roles: [{ title: 'Skill builder', skills: ['exo-skills'], commitment: 'A few evenings' }, { title: 'Tester', skills: ['testing'], commitment: 'One evening' }],
    listed: true,
  });
  const interest = await ben.client.expressInterest(brief.id, { role: 'r1', note: 'Synthetic.' });
  await ada.client.decideInterest(interest.id, 'accept');
  const scribeKey = await generateIdentity();
  const scribe = { identity: scribeKey, id: scribeKey.id, client: hub.withToken((await ben.client.registerAgent({ name: 'scribe', identity: scribeKey })).token) };
  await ben.client.nominateAgent(brief.id, scribe.id);
  const pid = (await ada.client.startSigned({ briefId: brief.id, identity: ada.identity })).project;
  const append = (who, kind, body) => who.client.appendSigned({ pid, identity: who.identity, kind, body });
  const terms = await ada.client.putBlob(pid, utf8('Synthetic charter. Scope, criteria, credit.\n'), TEXT);
  const agreement = (await append(ada, 'agreement.proposed', { title: 'Charter', uri: terms.uri, digest: terms.digest, parties: [ada.id, ben.id] })).head;
  await append(ada, 'agreement.consented', { agreement });
  await append(ben, 'agreement.consented', { agreement });
  const expires = new Date(Date.now() + 14 * DAY_MS).toISOString();
  const delegation = (await append(ben, 'delegation.granted', { agent: scribe.id, agreement, scope: ['contribution.submit'], expires })).head;
  const artifact = await scribe.client.putBlob(pid, utf8('synthetic skill file\n'), TEXT);
  const contribution = (await append(scribe, 'contribution.submitted', {
    title: 'Synthetic skill',
    summary: 'Synthetic.',
    artifact: { uri: artifact.uri, digest: artifact.digest },
    agreement,
    delegation,
  })).head;
  return { server, hub, ada, ben, scribe, brief, pid, agreement, delegation, contribution, append };
}

// Signs without local Koinos checks, so the refusal comes from the hub.
async function signUnchecked(w, who, kind, body) {
  const { records } = await who.client.getProject(w.pid);
  return signDraft(await draftRecord({ records, actor: who.id, kind, body }), who.identity.privateKey);
}

// Acceptance criterion 3 without a browser: the consent action fetches the
// agreement's bytes by digest and builds the dialog's terms with
// termsFromBytes; termsGate decides whether the dialog offers signing.
test('before consenting, a party gets the exact stored charter text, and signing needs its digest to match', async (t) => {
  const w = await journey(t);
  const { state } = await w.ben.client.getProject(w.pid);
  const agreement = state.agreements.find((a) => a.id === w.agreement);
  const bytes = await w.ben.client.getBlob(w.pid, agreement.digest); // the request the consent action makes
  const terms = await termsFromBytes(bytes, agreement.digest);
  assert.equal(terms.text, 'Synthetic charter. Scope, criteria, credit.\n');
  assert.equal(terms.digestComputed, await sha256Hex(bytes));
  assert.equal(terms.digestComputed, agreement.digest);
  const gate = termsGate(terms);
  assert.deepEqual([gate.canSign, gate.check.state, gate.shown.text], [true, 'match', terms.text]);

  // Changed bytes, or bytes that are not UTF-8 text, never allow signing.
  const tampered = termsGate(await termsFromBytes(utf8(`${terms.text}Payment: 100 tokens.\n`), agreement.digest));
  assert.deepEqual([tampered.canSign, tampered.check.state], [false, 'mismatch']);
  const binary = new Uint8Array([0xff, 0xfe, 0x41]);
  const notText = termsGate(await termsFromBytes(binary, await sha256Hex(binary)));
  assert.deepEqual([notText.canSign, notText.shown], [false, null]);
  // The browser helper decodes and hashes exactly as Koinos does, a leading BOM included and shown.
  const bom = utf8('\uFEFFTerms with a byte order mark.\n');
  const withBom = await termsFromBytes(bom, await sha256Hex(bom));
  assert.equal(withBom.text, fromUtf8(bom));
  assert.equal(termsGate(withBom).shown.count, 1);
});

test('negative journey: the principal cannot review the contribution of their own agent', async (t) => {
  const w = await journey(t);
  const review = await signUnchecked(w, w.ben, 'contribution.reviewed', { contribution: w.contribution, decision: 'approve', note: 'Self-review.' });
  await assert.rejects(w.ben.client.appendRecord(w.pid, review), (e) => e.status === 422 && e.code === 'koinos' && e.koinosCode === 'authority' && /neither the submitter nor the principal/.test(e.message));
  // The agent cannot review at all: social and review actions are for people.
  const agentReview = await signUnchecked(w, w.scribe, 'contribution.reviewed', { contribution: w.contribution, decision: 'approve', note: 'Synthetic.' });
  await assert.rejects(w.scribe.client.appendRecord(w.pid, agentReview), (e) => e.status === 403);
  assert.equal((await w.ada.client.getProject(w.pid)).count, 6);
});

test('negative journey: an agent cannot express interest or take other social actions', async (t) => {
  const w = await journey(t);
  await assert.rejects(w.scribe.client.expressInterest(w.brief.id, { role: 'r2', note: 'Synthetic.' }), (e) => e.status === 403 && e.code === 'forbidden');
  await assert.rejects(w.scribe.client.publishBrief({ title: 'x', summary: 'x', compensation: 'x', roles: [] }), (e) => e.status === 403);
  await assert.rejects(w.scribe.client.updateProfile({ listed: true }), (e) => e.status === 403);
  await assert.rejects(w.scribe.client.listBriefs(), (e) => e.status === 403);
  const brief = await w.ada.client.getBrief(w.brief.id);
  assert.equal(brief.interests.length, 1);
});

test('negative journey: a revoked delegation blocks acceptance', async (t) => {
  const w = await journey(t);
  const review = (await w.append(w.ada, 'contribution.reviewed', { contribution: w.contribution, decision: 'approve', note: 'Synthetic review.' })).head;
  await w.append(w.ben, 'delegation.revoked', { delegation: w.delegation, reason: 'Synthetic revocation before acceptance.' });
  const accept = await signUnchecked(w, w.ada, 'contribution.accepted', { contribution: w.contribution, review });
  await assert.rejects(w.ada.client.appendRecord(w.pid, accept), (e) => e.status === 422 && e.koinosCode === 'authority' && /revoked/.test(e.message));
  const { state } = await w.ada.client.getProject(w.pid);
  assert.equal(state.contributions[0].status, 'reviewed');
  assert.equal(state.delegations[0].revoked, true);
  assert.deepEqual(await w.ada.client.credit(w.ben.id), []);
});

test('negative journey: a cross-origin POST is refused before it reaches the hub', async (t) => {
  const w = await journey(t);
  const before = await w.ada.client.getProject(w.pid);
  const record = await signUnchecked(w, w.ada, 'contribution.reviewed', { contribution: w.contribution, decision: 'approve', note: 'Synthetic.' });
  const evil = async (url, init) => fetch(url, { ...init, headers: { ...init.headers, Origin: 'http://evil.example' } });
  const forged = new ExofabClient({ baseUrl: w.server.url, fetch: evil }).withToken(null);
  await assert.rejects(forged.health(), (e) => e.status === 403 && e.code === 'cross_origin');
  const res = await evil(`${w.server.url}/api/projects/${w.pid}/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(record),
  });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error.code, 'cross_origin');
  assert.equal((await w.ada.client.getProject(w.pid)).head, before.head);
});
