// Milestone-3 journey across Exofab, a real Synbios and the Koinos reference.
//
// Runs only when BOTH are set, for a maintainer:
//   KOINOS_DIR=/path/to/koinos SYNBIOS_DIR=/path/to/synbios node --test test/interop-journey.test.mjs
// SYNBIOS_PYTHON selects the Python 3.11+ interpreter (default python3).
// Sibling code runs only as separate processes on temporary files, with a
// minimal environment; none is imported here. All data is synthetic.
//
// The journey: Ada and Ben form a team in an Exofab hub over HTTP, agree a
// charter, and Ben delegates to his agent scribe (Koinos records 0-4).
// scribe's work is a real Synbios task created from that charter: a forge
// artifact, passing test evidence, and an independent forge review by Ada.
// The exact bytes of the Synbios export become the artifact blob of scribe's
// contribution.submitted (record 5). Ada reads those bytes back from the hub,
// reviews and accepts (records 6-7). The export written from the hub verifies
// with Exofab's verifier and with the Koinos reference (import, verify, and
// inspect deep-equal), and the cited bytes still pass Synbios's own verifier.
// A second Synbios task shows that inspectExport flags file: URIs and absolute
// local paths, which must not travel into a shared record.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { KoinosError, generateIdentity, niUri, sha256Hex, utf8, verifyBundle } from '../src/koinos/index.mjs';
import { FileStore } from '../src/hub/store.mjs';
import { Hub } from '../src/hub/hub.mjs';
import { createServer } from '../src/server.mjs';
import { ExofabClient } from '../src/client.mjs';
import { referencedDigests, verifyExport, writeExport } from '../src/export.mjs';
import { DEMO_ARTIFACT, DEMO_BRIEF, DEMO_CHARTER } from '../src/demo.mjs';
import { SynbiosClient, inspectExport, taskFromCharter } from '../src/adapters/synbios.mjs';

const KOINOS_DIR = process.env.KOINOS_DIR ? resolve(process.env.KOINOS_DIR) : undefined;
const SYNBIOS_DIR = process.env.SYNBIOS_DIR ? resolve(process.env.SYNBIOS_DIR) : undefined;
const PYTHON = process.env.SYNBIOS_PYTHON || 'python3';
const MISSING = [!KOINOS_DIR && 'KOINOS_DIR', !SYNBIOS_DIR && 'SYNBIOS_DIR'].filter(Boolean);
const SKIP =
  `${MISSING.join(' and ')} ${MISSING.length === 1 ? 'is' : 'are'} not set; the cross-project journey needs ` +
  'KOINOS_DIR (a Koinos checkout) and SYNBIOS_DIR (a Synbios checkout) together';

const DAY_MS = 24 * 60 * 60 * 1000;
const TEXT = 'text/plain; charset=utf-8';
const LEAK_ADVICE = '; do not copy it into shared or public records';

// --- Sibling processes ------------------------------------------------------------

// Runs a command to completion. Resolves {code, stdout, stderr}; rejects only
// when it cannot start. A command that outlives timeoutMs is killed.
function run(command, args, { cwd, env, timeoutMs = 60_000 }) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr });
    });
  });
}

// The Koinos CLI needs no environment; none is passed on.
const koinos = (args, cwd) => run(process.execPath, [join(KOINOS_DIR, 'src', 'cli.mjs'), ...args], { cwd, env: { PATH: process.env.PATH ?? '' } });

// Only what Python needs; no credentials or unrelated settings are passed on.
// PYTHONUTF8: `synbios verify` reads the file with the locale's encoding.
const PYTHON_ENV = () => ({
  PATH: process.env.PATH ?? '',
  PYTHONPATH: SYNBIOS_DIR,
  PYTHONDONTWRITEBYTECODE: '1',
  PYTHONNOUSERSITE: '1',
  PYTHONIOENCODING: 'utf-8',
  PYTHONUTF8: '1',
});
const synbios = (args, cwd) => run(PYTHON, ['-m', 'synbios', ...args], { cwd, env: PYTHON_ENV() });

// Synbios declares requires-python >= 3.11. -I: this probe reads nothing from Synbios.
async function requirePython311(cwd) {
  const probe = await run(PYTHON, ['-I', '-c', 'import sys; print(sys.version_info >= (3, 11))'], { cwd, env: { PATH: process.env.PATH ?? '' } }).catch((error) => {
    throw new Error(`Cannot run ${PYTHON} (${error.code ?? error.message}); set SYNBIOS_PYTHON to a Python 3.11+ interpreter`);
  });
  if (probe.code !== 0 || probe.stdout.trim() !== 'True') throw new Error(`${PYTHON} is not Python 3.11 or newer, which Synbios requires`);
}

// `synbios serve --port 0` binds a free loopback port and prints it.
function startSynbios(cwd, db) {
  return new Promise((done, reject) => {
    const child = spawn(PYTHON, ['-m', 'synbios', 'serve', '--db', db, '--host', '127.0.0.1', '--port', '0'], {
      cwd,
      env: PYTHON_ENV(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Synbios did not start within 20 seconds'));
    }, 20_000);
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
      const found = /listening at http:\/\/127\.0\.0\.1:(\d+)/.exec(stdout);
      if (found) {
        clearTimeout(timer);
        done({ child, url: `http://127.0.0.1:${found[1]}` });
      }
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Synbios exited before listening (${code}): ${stderr.slice(0, 500)}`));
    });
  });
}

async function stopSynbios(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((done) => child.once('exit', done));
  child.kill('SIGINT'); // serve closes its store on KeyboardInterrupt
  const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
  await exited;
  clearTimeout(timer);
}

const json = (result, what) => {
  assert.equal(result.code, 0, `${what} failed (${result.code}): ${result.stderr.slice(0, 500)}`);
  return JSON.parse(result.stdout);
};
const sameBytes = (a, b) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));

test('milestone 3: a Synbios task export is accepted in Exofab and verifies with Exofab and the Koinos reference', { timeout: 300_000 }, async (t) => {
  if (MISSING.length > 0) {
    t.skip(SKIP);
    return;
  }
  await access(join(KOINOS_DIR, 'src', 'cli.mjs')).catch(() => {
    throw new Error('KOINOS_DIR must be a Koinos checkout containing src/cli.mjs');
  });
  await access(join(SYNBIOS_DIR, 'synbios', '__main__.py')).catch(() => {
    throw new Error('SYNBIOS_DIR must be a Synbios checkout containing synbios/__main__.py');
  });

  const dir = await mkdtemp(join(tmpdir(), 'exofab-journey-'));
  let hubServer;
  let forge;
  t.after(async () => {
    await stopSynbios(forge?.child);
    await hubServer?.close();
    await rm(dir, { recursive: true, force: true });
  });
  await requirePython311(dir);

  // --- Exofab: team, charter, consent and delegation (Koinos records 0-4) ---------------
  hubServer = await createServer({ hub: new Hub({ store: new FileStore(join(dir, 'hub')) }), port: 0, log: (line) => t.diagnostic(line) });
  const hub = new ExofabClient({ baseUrl: hubServer.url });
  const adaKey = await generateIdentity();
  const benKey = await generateIdentity();
  const scribeKey = await generateIdentity();
  const ada = hub.withToken((await hub.registerPerson({ name: 'Ada', identity: adaKey })).token);
  const ben = hub.withToken((await hub.registerPerson({ name: 'Ben', identity: benKey })).token);

  const brief = await ada.publishBrief(DEMO_BRIEF);
  const interest = await ben.expressInterest(brief.id, { role: brief.roles[0].id, note: 'I build Exo skills. (synthetic)' });
  await ada.decideInterest(interest.id, 'accept');
  const scribe = hub.withToken((await ben.registerAgent({ name: 'scribe', identity: scribeKey })).token);
  await ben.nominateAgent(brief.id, scribeKey.id);
  const pid = (await ada.startSigned({ briefId: brief.id, identity: adaKey })).project;

  const terms = await ada.putBlob(pid, utf8(DEMO_CHARTER), TEXT);
  const proposal = { title: 'Charter (synthetic)', uri: terms.uri, digest: terms.digest, parties: [adaKey.id, benKey.id] };
  const agreement = (await ada.appendSigned({ pid, identity: adaKey, kind: 'agreement.proposed', body: proposal })).head;
  await ada.appendSigned({ pid, identity: adaKey, kind: 'agreement.consented', body: { agreement } });
  await ben.appendSigned({ pid, identity: benKey, kind: 'agreement.consented', body: { agreement } });
  const grant = { agent: scribeKey.id, agreement, scope: ['contribution.submit'], expires: new Date(Date.now() + 14 * DAY_MS).toISOString() };
  const delegation = (await ben.appendSigned({ pid, identity: benKey, kind: 'delegation.granted', body: grant })).head;

  // --- Synbios: the delegated work as a forge task made from the charter -------------------
  const db = join(dir, 'synbios.db');
  const { token: adaForgeToken, principal: adaPrincipal } = json(await synbios(['init', '--db', db, '--name', 'Ada'], dir), 'synbios init');
  forge = await startSynbios(dir, db);
  const adaForge = new SynbiosClient({ baseUrl: forge.url, token: adaForgeToken });
  await adaForge.discover();

  const koinosRef = { project: pid, agreement, termsDigest: terms.digest };
  const forgeProject = await adaForge.command('project.create', { name: 'Recipe scaler (synthetic)', description: 'Synthetic Exofab milestone-3 journey.' });
  const charter = {
    title: 'recipe-scale skill (synthetic)',
    description: 'Build the recipe-scaling skill described in the agreed charter. Synthetic data.',
    criteria: ['Every ingredient amount is multiplied by the requested factor', 'The tests included in the artifact pass'],
    scope: ['One Exo skill and its tests'],
    koinos: koinosRef,
    synbiosProject: forgeProject.id,
  };
  const task = await adaForge.command('task.create', taskFromCharter(charter));

  // Ben is a human principal in Synbios too; he grants his agent this task only.
  const benForge = new SynbiosClient({ baseUrl: forge.url, token: (await adaForge.command('principal.create', { name: 'Ben', kind: 'human' })).token });
  const scribeCreated = await benForge.command('principal.create', { name: 'scribe', kind: 'agent' });
  const scribeForge = new SynbiosClient({ baseUrl: forge.url, token: scribeCreated.token });
  const capabilities = ['claim', 'work', 'artifact', 'evidence', 'submit'];
  await benForge.command('grant.create', { principal_id: scribeCreated.principal.id, task_id: task.id, capabilities });

  await scribeForge.command('task.claim', { task_id: task.id });
  await scribeForge.command('task.transition', { task_id: task.id, status: 'in_progress' });
  const skillDigest = await sha256Hex(DEMO_ARTIFACT);
  const forgeArtifact = await scribeForge.command('artifact.add', {
    task_id: task.id,
    title: 'recipe-scale skill',
    kind: 'document',
    revision: skillDigest,
    digest: skillDigest,
    uri: niUri(skillDigest),
    summary: 'Synthetic skill text with its scaling rules and tests.',
  });
  await scribeForge.command('evidence.add', {
    task_id: task.id,
    artifact_id: forgeArtifact.id,
    artifact_digest: forgeArtifact.digest,
    revision: forgeArtifact.revision,
    kind: 'test',
    status: 'passed',
    command: 'node --test test/scale.test.mjs',
    summary: 'Synthetic: three scaling cases pass. Reported by the agent; Synbios does not run it.',
    tool: 'node:test',
    tool_version: process.versions.node,
    assumptions: ['Synthetic evidence for the Exofab journey.'],
  });
  await scribeForge.command('task.transition', { task_id: task.id, status: 'in_review' });

  // Forge review: Synbios refuses the agent and accepts Ada, who did not author the artifact.
  const forgeReview = { task_id: task.id, artifact_id: forgeArtifact.id, revision: forgeArtifact.revision, decision: 'approved', comment: 'Synthetic forge review: the criteria are met.' };
  await assert.rejects(scribeForge.command('review.create', forgeReview), (error) => error.status === 403);
  await adaForge.command('review.create', forgeReview);

  const exported = await adaForge.exportTask(task.id);
  assert.equal(exported.digest, await sha256Hex(exported.bytes));
  assert.equal(exported.uri, niUri(exported.digest));
  const forgeSummary = inspectExport(exported.bytes);
  assert.deepEqual(forgeSummary.integrity, { valid: true, errors: [] });
  assert.deepEqual(forgeSummary.task, { id: task.id, title: charter.title, status: 'accepted', projectId: forgeProject.id });
  assert.deepEqual(forgeSummary.koinos, koinosRef);
  assert.deepEqual(forgeSummary.artifact, { id: forgeArtifact.id, title: 'recipe-scale skill', kind: 'document', revision: skillDigest, digest: skillDigest });
  assert.ok(forgeSummary.evidence.some((item) => item.kind === 'test' && item.status === 'passed' && item.current));
  assert.deepEqual(forgeSummary.reviews, [
    { decision: 'approved', reviewer: { id: adaPrincipal.id, name: 'Ada', kind: 'human' }, revision: skillDigest, current: true },
  ]);
  assert.deepEqual(forgeSummary.warnings, [], 'the export to be shared carries no local paths or other leaks');
  const forgeFile = join(dir, 'synbios-export.json');
  await writeFile(forgeFile, exported.bytes);
  assert.equal(json(await synbios(['verify', forgeFile], dir), 'synbios verify').valid, true);

  // --- Exofab: the exact export bytes are the contribution artifact (record 5) ------------
  const blob = await scribe.putBlob(pid, exported.bytes);
  assert.deepEqual({ digest: blob.digest, uri: blob.uri, size: blob.size }, { digest: exported.digest, uri: exported.uri, size: exported.bytes.byteLength });
  const submission = {
    title: 'recipe-scale skill v1 (synthetic)',
    summary: `Synbios task ${task.id} export: the skill artifact, passing test evidence, and Ada's approving forge review.`,
    artifact: { uri: blob.uri, digest: blob.digest },
    agreement,
    delegation,
  };
  const contribution = (await scribe.appendSigned({ pid, identity: scribeKey, kind: 'contribution.submitted', body: submission })).head;

  // --- Exofab: Ada reviews the bytes she reads back, then accepts (records 6-7) -----------
  const fetched = await ada.getBlob(pid, blob.digest);
  assert.ok(sameBytes(fetched, exported.bytes), 'the hub returns the exact Synbios export bytes');
  const reviewed = inspectExport(fetched);
  assert.equal(reviewed.integrity.valid, true);
  assert.equal(reviewed.task.status, 'accepted');
  assert.deepEqual(reviewed.koinos, koinosRef, 'the export names this project, agreement and charter digest');

  const reviewBody = { contribution, decision: 'approve', note: 'Read the exact Synbios export: artifact, passing test evidence and forge review meet the charter. (synthetic)' };
  // Ben delegated to scribe, so Koinos does not let him review; his client refuses before signing.
  await assert.rejects(ben.appendSigned({ pid, identity: benKey, kind: 'contribution.reviewed', body: reviewBody }), (error) => error instanceof KoinosError && error.code === 'authority');
  const review = (await ada.appendSigned({ pid, identity: adaKey, kind: 'contribution.reviewed', body: reviewBody })).head;
  const accepted = await ada.appendSigned({ pid, identity: adaKey, kind: 'contribution.accepted', body: { contribution, review } });
  assert.equal(accepted.count, 8);
  assert.deepEqual(
    accepted.state.contributions.map((c) => [c.id, c.status, c.actor, c.principal, c.artifact.digest]),
    [[contribution, 'accepted', scribeKey.id, benKey.id, exported.digest]],
  );

  // --- Export from the hub and verify it from disk with Exofab ----------------------------
  const bundle = await ada.getBundle(pid);
  const blobs = new Map();
  for (const { digest } of referencedDigests(accepted.state)) blobs.set(digest, await ada.getBlob(pid, digest));
  const written = await writeExport({ outDir: join(dir, 'export'), bundle, blobs });
  const verified = await verifyExport({ bundlePath: written.bundlePath, blobsDir: written.blobsDir, expectedHead: accepted.head, expectedProject: pid });
  assert.equal(verified.ok, true);
  assert.deepEqual(
    verified.blobs.map((b) => [b.kind, b.digest, b.ok, b.uriChecked]),
    [
      ['agreement', terms.digest, true, true],
      ['artifact', exported.digest, true, true],
    ],
  );
  const exportedArtifact = join(written.blobsDir, exported.digest);
  assert.ok(sameBytes(await readFile(exportedArtifact), exported.bytes), 'the export carries the exact Synbios bytes');
  assert.equal(json(await synbios(['verify', exportedArtifact], dir), 'synbios verify of the exported artifact').valid, true);

  // --- The Koinos reference accepts the exported bundle unchanged ---------------------------
  assert.deepEqual(json(await koinos(['verify', written.bundlePath, accepted.head, pid], dir), 'koinos verify of the export'), {
    valid: true,
    head: accepted.head,
    count: 8,
  });
  const store = join(dir, 'koinos-store.json');
  assert.deepEqual(json(await koinos(['import', store, written.bundlePath], dir), 'koinos import'), { head: accepted.head, count: 8 });
  assert.deepEqual(json(await koinos(['verify', store, accepted.head, pid], dir), 'koinos verify'), { valid: true, head: accepted.head, count: 8 });
  const inspected = json(await koinos(['inspect', store], dir), 'koinos inspect');
  assert.deepStrictEqual(inspected, verified.state, 'Koinos derives the same state as Exofab');
  assert.equal(inspected.contributions[0].artifact.digest, exported.digest);
  // Re-reading what Koinos stored gives the same head, participants and attribution.
  assert.deepStrictEqual(await verifyBundle(JSON.parse(await readFile(store, 'utf8')), { expectedHead: accepted.head, expectedProject: pid }), verified.state);

  // --- inspectExport flags local file URIs and absolute paths --------------------------------
  // A second task whose artifacts carry the URI shape `synbios capture` records
  // (the repository's file: URI, '#', the revision) and a bare local path.
  // Both paths are built here at run time under the temporary directory.
  const leakTask = await adaForge.command('task.create', taskFromCharter({ ...charter, title: 'Leak check (synthetic)' }));
  await benForge.command('grant.create', { principal_id: scribeCreated.principal.id, task_id: leakTask.id, capabilities: ['artifact'] });
  const commit = (await sha256Hex('synthetic commit')).slice(0, 40);
  await scribeForge.command('artifact.add', {
    task_id: leakTask.id,
    title: 'Captured revision (synthetic)',
    kind: 'git_commit',
    revision: commit,
    digest: await sha256Hex('synthetic tree manifest'),
    uri: `${pathToFileURL(join(dir, 'skill-repo')).href}#${commit}`,
    summary: 'Synthetic capture-shaped artifact.',
  });
  await scribeForge.command('artifact.add', {
    task_id: leakTask.id,
    title: 'Local notes (synthetic)',
    kind: 'document',
    revision: skillDigest,
    digest: skillDigest,
    uri: join(dir, 'notes', 'recipe-scale.md'),
    summary: 'Synthetic artifact whose URI is a local path.',
  });
  const leaky = inspectExport((await adaForge.exportTask(leakTask.id)).bytes);
  assert.equal(leaky.integrity.valid, true, 'Synbios stores and exports such URIs verbatim');
  assert.ok(leaky.warnings.includes(`local file URI in task.artifacts[0].uri${LEAK_ADVICE}`), leaky.warnings.join('\n'));
  assert.ok(leaky.warnings.includes(`absolute local path in task.artifacts[1].uri${LEAK_ADVICE}`), leaky.warnings.join('\n'));
});
