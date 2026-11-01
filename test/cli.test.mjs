// Tests for the command line (src/cli.mjs): usage and exit codes, keygen,
// agent register and submit against a running hub, serve with its data
// directory lock, and the synbios delegation. Synthetic people Ada and Ben,
// agent scribe; temporary directories only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Writable } from 'node:stream';
import { acquireLock, main } from '../src/cli.mjs';
import { ExofabClient } from '../src/client.mjs';
import { FileStore } from '../src/hub/store.mjs';
import { Hub, personProofText } from '../src/hub/hub.mjs';
import { BUNDLE_FORMAT, createRecord, generateIdentity, identityFromPkcs8Pem, niUri, sha256Hex, signText, utf8 } from '../src/koinos/index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DAY_MS = 24 * 60 * 60 * 1000;

async function tempDir(t, prefix = 'exofab-cli-') {
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

async function cli(args, { env = {}, ...io } = {}) {
  const stdout = capture();
  const stderr = capture();
  const status = await main(args, { stdout, stderr, env, ...io });
  return { status, stdout: stdout.text(), stderr: stderr.text() };
}

// Starts `exofab serve` in this process; resolves {url, stop, done} once it listens.
function serve(args) {
  const controller = new AbortController();
  let listening;
  const ready = new Promise((resolve) => {
    listening = resolve;
  });
  const done = cli(['serve', ...args], { signal: controller.signal, onListening: (handle) => listening(handle) });
  return Promise.race([ready.then((handle) => ({ url: handle.url, stop: () => controller.abort(), done })), done.then((r) => ({ failed: r }))]);
}

test('usage errors exit 2, help exits 0, unknown commands are named', async () => {
  const none = await cli([]);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /Usage: exofab <command>/);
  const help = await cli(['--help']);
  assert.equal(help.status, 0);
  for (const command of ['serve', 'demo', 'keygen', 'verify', 'export', 'import', 'agent register', 'agent submit', 'synbios']) {
    assert.ok(help.stdout.includes(command), command);
  }
  assert.equal((await cli(['nope'])).status, 2);
  assert.equal((await cli(['verify'])).status, 2);
  assert.equal((await cli(['verify', 'a.json', 'b.json'])).status, 2);
  assert.equal((await cli(['verify', 'a.json', '--bogus'])).status, 2);
  assert.equal((await cli(['serve', '--port', '99999'])).status, 2);
  assert.equal((await cli(['agent'])).status, 2);
  assert.equal((await cli(['agent', 'fly'])).status, 2);
  for (const command of ['serve', 'demo', 'keygen', 'verify', 'export', 'import', 'agent']) {
    const result = await cli([command, '--help']);
    assert.equal(result.status, 0, command);
    assert.match(result.stdout, /^Usage:/, command);
  }
  const synbios = await cli(['synbios', '--help']);
  assert.equal(synbios.status, 0);
  assert.match(synbios.stdout, /exofab synbios task/);
  assert.equal((await cli(['synbios', 'nope'])).status, 2);
  const missing = await cli(['verify', join(tmpdir(), 'exofab-no-such-bundle.json')]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /does not exist/);
});

test('the bin runs directly and reports its version', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [join(ROOT, 'src', 'cli.mjs'), '--version']);
  const { version } = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(stdout.trim(), version);
});

test('keygen writes a 0600 PKCS#8 key exclusively and prints only its id', async (t) => {
  const dir = await tempDir(t);
  const keyFile = join(dir, 'scribe.pem');
  const result = await cli(['keygen', keyFile]);
  assert.equal(result.status, 0, result.stderr);
  const printed = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(printed).sort(), ['id', 'keyFile']);
  assert.equal(printed.keyFile, keyFile);
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE KEY/);
  const pem = await readFile(keyFile, 'utf8');
  assert.match(pem, /^-----BEGIN PRIVATE KEY-----\n/);
  assert.equal((await identityFromPkcs8Pem(pem)).id, printed.id);
  if (process.platform !== 'win32') assert.equal((await stat(keyFile)).mode & 0o777, 0o600);
  const again = await cli(['keygen', keyFile]);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already exists/);
  assert.equal(await readFile(keyFile, 'utf8'), pem);
});

test('agent register and agent submit act as the agent against a running hub', async (t) => {
  const dir = await tempDir(t);
  const server = await serve(['--data', join(dir, 'data'), '--port', '0']);
  assert.ok(server.url, JSON.stringify(server.failed));
  t.after(async () => {
    server.stop();
    await server.done;
  });
  const hub = new ExofabClient({ baseUrl: server.url });
  const person = async (name) => {
    const identity = await generateIdentity();
    const { token } = await hub.registerPerson({ name, identity });
    return { identity, id: identity.id, token, client: hub.withToken(token) };
  };
  const ada = await person('Ada');
  const ben = await person('Ben');
  const keyFile = join(dir, 'scribe.pem');
  const scribeId = JSON.parse((await cli(['keygen', keyFile])).stdout).id;

  assert.equal((await cli(['agent', 'register', '--name', 'scribe', '--key', keyFile, '--hub', server.url])).status, 2, 'needs EXOFAB_TOKEN');
  const remote = await cli(['agent', 'register', '--name', 'scribe', '--key', keyFile, '--hub', 'http://192.0.2.1:4317'], { env: { EXOFAB_TOKEN: ben.token } });
  assert.equal(remote.status, 2);
  const registered = await cli(['agent', 'register', '--name', 'scribe', '--key', keyFile, '--hub', server.url], { env: { EXOFAB_TOKEN: ben.token } });
  assert.equal(registered.status, 0, registered.stderr);
  const { agent, token: agentToken } = JSON.parse(registered.stdout);
  assert.deepEqual(agent, { id: scribeId, kind: 'agent', name: 'scribe', principal: ben.id });
  assert.match(agentToken, /^exf_[A-Za-z0-9_-]{43}$/);
  assert.match(registered.stderr, /shown only once/);
  assert.ok(!registered.stdout.includes(ben.token));
  const twice = await cli(['agent', 'register', '--name', 'scribe', '--key', keyFile, '--hub', server.url], { env: { EXOFAB_TOKEN: ben.token } });
  assert.equal(twice.status, 1);
  assert.match(twice.stderr, /409 conflict/);

  // Team, record, charter, consents and Ben's delegation, through the client.
  await ben.client.updateProfile({ skills: ['exo-skills'], listed: true });
  const brief = await ada.client.publishBrief({
    title: 'Recipe-scaling skill (synthetic)',
    summary: 'Synthetic CLI test brief.',
    compensation: 'None offered. Credit is recorded for accepted work only.',
    roles: [{ title: 'Skill builder', skills: ['exo-skills'], commitment: 'A few evenings' }],
    listed: true,
  });
  const interest = await ben.client.expressInterest(brief.id, { role: 'r1' });
  await ada.client.decideInterest(interest.id, 'accept');
  await ben.client.nominateAgent(brief.id, scribeId);
  const pid = (await ada.client.startSigned({ briefId: brief.id, identity: ada.identity })).project;
  const terms = await ada.client.putBlob(pid, utf8('Synthetic charter.\n'), 'text/plain; charset=utf-8');
  const append = (who, kind, body) => who.client.appendSigned({ pid, identity: who.identity, kind, body });
  const agreement = (await append(ada, 'agreement.proposed', { title: 'Charter', uri: terms.uri, digest: terms.digest, parties: [ada.id, ben.id] })).head;
  await append(ada, 'agreement.consented', { agreement });
  await append(ben, 'agreement.consented', { agreement });

  const artifactFile = join(dir, 'skill.md');
  await writeFile(artifactFile, '# recipe-scale (synthetic)\n');
  const submitArgs = ['agent', 'submit', '--project', pid, '--key', keyFile, '--artifact', artifactFile, '--title', 'Synthetic skill', '--summary', 'Synthetic summary.', '--hub', server.url];
  const early = await cli(submitArgs, { env: { EXOFAB_AGENT_TOKEN: agentToken } });
  assert.equal(early.status, 1);
  assert.match(early.stderr, /no active delegation/);
  const expires = new Date(Date.now() + 14 * DAY_MS).toISOString();
  const delegation = (await append(ben, 'delegation.granted', { agent: scribeId, agreement, scope: ['contribution.submit'], expires })).head;

  assert.equal((await cli(submitArgs, { env: { EXOFAB_AGENT_TOKEN: ben.token } })).status, 1, 'a person token is not an agent token');
  const otherKey = join(dir, 'other.pem');
  await cli(['keygen', otherKey]);
  const wrongKey = await cli(submitArgs.map((a) => (a === keyFile ? otherKey : a)), { env: { EXOFAB_AGENT_TOKEN: agentToken } });
  assert.equal(wrongKey.status, 1);
  assert.match(wrongKey.stderr, /does not belong/);

  const submitted = await cli(submitArgs, { env: { EXOFAB_AGENT_TOKEN: agentToken } });
  assert.equal(submitted.status, 0, submitted.stderr);
  const out = JSON.parse(submitted.stdout);
  assert.equal(out.delegation, delegation);
  assert.equal(out.artifact.digest, await sha256Hex(await readFile(artifactFile)));
  assert.ok(!submitted.stdout.includes(agentToken));
  const { state, records } = await ada.client.getProject(pid);
  const contribution = state.contributions.find((c) => c.id === out.contribution);
  assert.equal(contribution.actor, scribeId);
  assert.equal(contribution.principal, ben.id);
  assert.equal(contribution.delegation, delegation);
  assert.equal(records.at(-1).actor, scribeId);
});

test('serve holds a lock on its data directory; import and a second hub are refused while it runs', async (t) => {
  const dir = await tempDir(t);
  const data = join(dir, 'data');
  const server = await serve(['--data', data, '--port', '0']);
  assert.ok(server.url);
  const hub = new ExofabClient({ baseUrl: server.url });
  assert.equal((await hub.health()).local_only, true);
  const index = await fetch(`${server.url}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /Local prototype\. Synthetic data only\./);

  const second = await serve(['--data', data, '--port', '0']);
  assert.equal(second.failed.status, 1);
  assert.match(second.failed.stderr, new RegExp(`in use by process ${process.pid}`));
  const bundle = join(dir, 'bundle.json');
  await writeFile(bundle, '{"format":"koinos-bundle/0.1","records":[]}');
  const imported = await cli(['import', bundle, '--data', data]);
  assert.equal(imported.status, 1);
  assert.match(imported.stderr, /in use/);

  server.stop();
  const finished = await server.done;
  assert.equal(finished.status, 0, finished.stderr);
  await assert.rejects(access(join(data, 'exofab.lock')));
  await assert.rejects(hub.health());

  // A lock left by a process that no longer runs is replaced.
  const dead = spawnSync(process.execPath, ['-e', '']).pid;
  await writeFile(join(data, 'exofab.lock'), JSON.stringify({ pid: dead }));
  const restarted = await serve(['--data', data, '--port', '0']);
  assert.ok(restarted.url, JSON.stringify(restarted.failed));
  restarted.stop();
  assert.equal((await restarted.done).status, 0);
});

test('starters racing for a stale lock: exactly one gets it, and none removes the winner’s lock', async (t) => {
  const dir = await tempDir(t);
  const dead = spawnSync(process.execPath, ['-e', '']).pid;
  for (let trial = 0; trial < 40; trial++) {
    const data = join(dir, `data-${trial}`);
    await mkdir(data);
    await writeFile(join(data, 'exofab.lock'), JSON.stringify({ pid: dead }));
    // Eight at once: the old takeover let two of them hold it in a few trials of every run.
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => acquireLock(data)));
    const held = results.filter((r) => r.status === 'fulfilled');
    assert.equal(held.length, 1, `trial ${trial}: ${held.length} holders`);
    for (const r of results.filter((x) => x.status === 'rejected')) assert.match(r.reason.message, /in use|replacing a stale lock/);
    assert.equal(JSON.parse(await readFile(join(data, 'exofab.lock'), 'utf8')).pid, process.pid);
    await assert.rejects(access(join(data, 'exofab.lock.break')));
    await held[0].value.release();
  }

  // A breaker left by a crash is never removed automatically; the message names it.
  const data = join(dir, 'leftover');
  await mkdir(data);
  await writeFile(join(data, 'exofab.lock'), JSON.stringify({ pid: dead }));
  await writeFile(join(data, 'exofab.lock.break'), JSON.stringify({ pid: dead }));
  await assert.rejects(acquireLock(data), /exofab\.lock\.break/);
  await rm(join(data, 'exofab.lock.break'));
  await (await acquireLock(data)).release();
});

test('import warns when a history not started on this hub names people registered here', async (t) => {
  const dir = await tempDir(t);
  const data = join(dir, 'data');
  const hub = new Hub({ store: new FileStore(data) });
  const ada = await generateIdentity();
  const { nonce } = await hub.challenge();
  await hub.registerPerson({ name: 'Ada', key: ada.id, nonce, signature: await signText(ada.privateKey, personProofText(nonce, ada.id)) });
  // Mallory, not registered here, signs a genesis that names Ada.
  const mallory = await generateIdentity();
  const participants = [
    { id: mallory.id, name: 'Mallory', kind: 'human' },
    { id: ada.id, name: 'Ada', kind: 'human' },
  ];
  const records = [await createRecord({ records: [], identity: mallory, kind: 'project.created', body: { title: 'Unsolicited', description: 'Names Ada.', participants } })];
  const bundle = join(dir, 'bundle.json');
  await writeFile(bundle, JSON.stringify({ format: BUNDLE_FORMAT, records }));
  const imported = await cli(['import', bundle, '--data', data]);
  assert.equal(imported.status, 0, imported.stderr);
  assert.deepEqual(JSON.parse(imported.stdout).registered, [ada.id]);
  assert.match(imported.stderr, /warning: this history was not started on this hub, and it names 1 identities registered here/);
  assert.ok(imported.stderr.includes(ada.id));
});

test('verify prints every cited URI and warns about one that is not an ni: URI', async (t) => {
  const dir = await tempDir(t);
  const ada = await generateIdentity();
  const ben = await generateIdentity();
  const terms = utf8('Synthetic terms.\n');
  const digest = await sha256Hex(terms);
  const records = [];
  const participants = [
    { id: ada.id, name: 'Ada', kind: 'human' },
    { id: ben.id, name: 'Ben', kind: 'human' },
  ];
  records.push(await createRecord({ records, identity: ada, kind: 'project.created', body: { title: 'Elsewhere', description: 'Synthetic.', participants } }));
  const proposal = (uri) => ({ title: 'Terms', uri, digest, parties: [ada.id, ben.id] });
  records.push(await createRecord({ records, identity: ada, kind: 'agreement.proposed', body: proposal('https://example.invalid/terms') }));
  records.push(await createRecord({ records, identity: ada, kind: 'agreement.proposed', body: proposal(niUri(digest)) }));
  await mkdir(join(dir, 'blobs'));
  await writeFile(join(dir, 'blobs', digest), terms);
  const bundle = join(dir, 'bundle.json');
  await writeFile(bundle, JSON.stringify({ format: BUNDLE_FORMAT, records }));

  for (const extra of [[], ['--blobs', join(dir, 'blobs')]]) {
    const out = await cli(['verify', bundle, ...extra]);
    assert.equal(out.status, 0, out.stderr);
    const report = JSON.parse(out.stdout);
    assert.deepEqual(report.cited.map((c) => c.uri), ['https://example.invalid/terms', niUri(digest)]);
    assert.match(out.stderr, /agreement [0-9a-f]{64} cites "https:\/\/example\.invalid\/terms", which is not an ni:\/\/\/sha-256 URI; it was not checked or fetched/);
    assert.equal(out.stderr.split('\n').filter(Boolean).length, 1);
    if (extra.length) {
      assert.deepEqual(report.blobs.map(({ uri, ok, uriChecked }) => [uri, ok, uriChecked]), [
        ['https://example.invalid/terms', true, false],
        [niUri(digest), true, true],
      ]);
    } else {
      assert.equal(report.blobs, null);
    }
  }
});
