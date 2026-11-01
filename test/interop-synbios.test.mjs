// Interoperability check against a real, temporary Synbios.
//
// Runs only when SYNBIOS_DIR names a Synbios checkout (Python 3.11+, standard
// library only). It starts `python3 -m synbios` from that checkout with a
// temporary database on a free loopback port, runs a charter task through
// claim, artifact, evidence, submission, and independent human approval,
// then exports it with SynbiosClient and inspects the exact bytes. Set
// SYNBIOS_PYTHON to use another interpreter. All data is synthetic.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { inspectExport, niUri, sha256Hex, SynbiosClient, taskFromCharter } from '../src/adapters/synbios.mjs';
import { synbiosCommand } from '../src/cli-synbios.mjs';

const SYNBIOS_DIR = process.env.SYNBIOS_DIR;
const PYTHON = process.env.SYNBIOS_PYTHON || 'python3';

const KOINOS = {
  project: '3f2b8c1e-6a4d-4e2f-9b1a-7c5d3e8f0a12',
  agreement: sha256Hex('synthetic agreement record'),
  termsDigest: sha256Hex('Synthetic charter text for Ada and Ben.\n'),
};
const CHARTER = {
  title: 'Recipe scaling skill (synthetic)',
  description: 'Build a skill that scales recipe quantities. Synthetic interoperability data.',
  criteria: ['Scales every quantity by a positive factor', 'Includes passing tests'],
  scope: ['Skill source and its tests only'],
  koinos: KOINOS,
};
const DOC_DIGEST = sha256Hex('Synthetic recipe-scaling notes for the Exofab prototype.\n');

// Only what Python needs; no credentials or unrelated settings are passed on.
// PYTHONUTF8: `synbios verify` reads the file with the locale's encoding.
function pythonEnv(synbiosDir) {
  return {
    PATH: process.env.PATH ?? '',
    PYTHONPATH: synbiosDir,
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONNOUSERSITE: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  };
}

// Synbios declares requires-python >= 3.11; say so plainly rather than fail
// later with an unrelated error. -I: this check reads nothing from Synbios.
async function requirePython311(cwd) {
  const probe = 'import sys; print(sys.version_info >= (3, 11))';
  const result = await runPython(['-I', '-c', probe], { cwd, env: { PATH: process.env.PATH ?? '' }, module: false }).catch((error) => {
    throw new Error(`Cannot run ${PYTHON} (${error.code ?? error.message}); set SYNBIOS_PYTHON to a Python 3.11+ interpreter`);
  });
  if (result.code !== 0 || result.stdout.trim() !== 'True') {
    throw new Error(`${PYTHON} is not Python 3.11 or newer, which Synbios requires; set SYNBIOS_PYTHON`);
  }
}

// Runs `python -m synbios ARGS` (or, with module: false, `python ARGS`).
function runPython(args, { cwd, env, timeoutMs = 60_000, module = true }) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, module ? ['-m', 'synbios', ...args] : args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
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
      resolve({ code, stdout, stderr });
    });
  });
}

// `serve --port 0` binds a free port and prints the one it bound.
function startServer({ cwd, env, db }) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, ['-m', 'synbios', 'serve', '--db', db, '--host', '127.0.0.1', '--port', '0'], {
      cwd,
      env,
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
        resolve({ child, port: Number(found[1]) });
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

async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGINT'); // serve closes its store on KeyboardInterrupt
  const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
  await exited;
  clearTimeout(timer);
}

test('a real Synbios runs a charter task to an accepted export that Exofab can inspect', { timeout: 180_000 }, async (t) => {
  if (!SYNBIOS_DIR) {
    t.skip('SYNBIOS_DIR is not set; set it to a Synbios checkout to run the Synbios interoperability check');
    return;
  }
  const synbiosDir = path.resolve(SYNBIOS_DIR);
  await stat(path.join(synbiosDir, 'synbios', '__main__.py')).catch(() => {
    throw new Error('SYNBIOS_DIR must be a Synbios checkout containing synbios/__main__.py');
  });

  const dir = await mkdtemp(path.join(os.tmpdir(), 'exofab-synbios-interop-'));
  const env = pythonEnv(synbiosDir);
  const db = path.join(dir, 'synbios.db');
  let server;
  t.after(async () => {
    await stopServer(server?.child);
    await rm(dir, { recursive: true, force: true });
  });
  await requirePython311(dir);

  // Ada is the bootstrap human; her token is printed once by init.
  const init = await runPython(['init', '--db', db, '--name', 'Ada'], { cwd: dir, env });
  assert.equal(init.code, 0, `synbios init failed: ${init.stderr.slice(0, 500)}`);
  const { token: adaToken, principal: adaPrincipal } = JSON.parse(init.stdout);

  server = await startServer({ cwd: dir, env, db });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const ada = new SynbiosClient({ baseUrl, token: adaToken });

  const discovery = await ada.discover();
  assert.equal(discovery.protocol_version, 1);
  assert.equal(discovery.local_only, true);
  assert.equal((await ada.health()).ok, true);

  const project = await ada.command('project.create', {
    name: 'Recipe scaler (synthetic)',
    description: 'Synthetic Exofab interoperability check.',
  });
  const task = await ada.command('task.create', taskFromCharter({ ...CHARTER, synbiosProject: project.id }));
  assert.equal(task.status, 'open');

  // Ben registers his agent scribe and grants it this task only.
  const benCreated = await ada.command('principal.create', { name: 'Ben', kind: 'human' });
  const ben = new SynbiosClient({ baseUrl, token: benCreated.token });
  const scribeCreated = await ben.command('principal.create', { name: 'scribe', kind: 'agent' });
  const scribe = new SynbiosClient({ baseUrl, token: scribeCreated.token });
  await ben.command('grant.create', {
    principal_id: scribeCreated.principal.id,
    task_id: task.id,
    capabilities: ['claim', 'work', 'artifact', 'evidence', 'submit'],
  });

  await scribe.command('task.claim', { task_id: task.id });
  await scribe.command('task.transition', { task_id: task.id, status: 'in_progress' });
  const artifact = await scribe.command('artifact.add', {
    task_id: task.id,
    title: 'Recipe scaling notes',
    kind: 'document',
    revision: DOC_DIGEST,
    digest: DOC_DIGEST,
    uri: niUri(DOC_DIGEST),
    summary: 'Synthetic document artifact.',
  });
  await scribe.command('evidence.add', {
    task_id: task.id,
    artifact_id: artifact.id,
    artifact_digest: artifact.digest,
    revision: artifact.revision,
    kind: 'test',
    status: 'passed',
    command: 'node --test test/scale.test.mjs',
    summary: 'Synthetic fixture result reported by the agent; Synbios does not run it.',
    tool: 'node:test',
    tool_version: process.versions.node,
    assumptions: ['Synthetic evidence for the interoperability check.'],
  });
  await scribe.command('task.transition', { task_id: task.id, status: 'in_review' });

  const review = { task_id: task.id, artifact_id: artifact.id, revision: artifact.revision, decision: 'approved', comment: 'Synthetic review: the criteria are met.' };
  await assert.rejects(scribe.command('review.create', review), (error) => error.status === 403);
  const approved = await ada.command('review.create', review);
  assert.equal(approved.decision, 'approved');

  const exported = await ada.exportTask(task.id);
  assert.equal(exported.digest, sha256Hex(exported.bytes));
  assert.equal(exported.uri, niUri(exported.digest));

  const summary = inspectExport(exported.bytes);
  assert.deepEqual(summary.integrity, { valid: true, errors: [] });
  assert.deepEqual(summary.task, { id: task.id, title: CHARTER.title, status: 'accepted', projectId: project.id });
  assert.deepEqual(summary.koinos, KOINOS);
  assert.deepEqual(summary.artifact, { id: artifact.id, title: 'Recipe scaling notes', kind: 'document', revision: DOC_DIGEST, digest: DOC_DIGEST });
  assert.ok(summary.evidence.some((item) => item.kind === 'test' && item.status === 'passed' && item.current));
  assert.deepEqual(summary.reviews, [
    { decision: 'approved', reviewer: { id: adaPrincipal.id, name: 'Ada', kind: 'human' }, revision: DOC_DIGEST, current: true },
  ]);
  assert.deepEqual(summary.warnings, []);

  // Synbios's own verifier and Exofab's checks agree on the exact bytes...
  const file = path.join(dir, 'export.json');
  await writeFile(file, exported.bytes);
  const verified = await runPython(['verify', file], { cwd: dir, env });
  assert.equal(verified.code, 0, verified.stdout);
  assert.equal(JSON.parse(verified.stdout).valid, true);
  const stdout = { text: '', write(chunk) { this.text += chunk; } };
  assert.equal(await synbiosCommand(['inspect', file], { stdout, stderr: stdout, env: {} }), 0);

  // ...and on an edited copy.
  const edited = JSON.parse(new TextDecoder().decode(exported.bytes));
  edited.task.title = 'Edited title';
  const editedFile = path.join(dir, 'edited.json');
  await writeFile(editedFile, JSON.stringify(edited));
  const rejected = await runPython(['verify', editedFile], { cwd: dir, env });
  assert.equal(rejected.code, 1);
  assert.equal(inspectExport(new TextEncoder().encode(JSON.stringify(edited))).integrity.valid, false);
});
