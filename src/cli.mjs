#!/usr/bin/env node
// Command-line entry point: exofab <command> [options].
// main(argv, io) returns the exit status: 0 success, 1 failure, 2 usage error.
// Private keys and tokens are never printed, except the agent token that
// `agent register` shows once.
import { parseArgs } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KoinosError, NI_PREFIX, exportPkcs8Pem, generateIdentity, identityFromPkcs8Pem, sha256Hex, verifyBundle } from './koinos/index.mjs';
import { FileStore, StoreError } from './hub/store.mjs';
import { Hub, HubError } from './hub/hub.mjs';
import { createServer, VERSION } from './server.mjs';
import { ExofabClient, ExofabHttpError } from './client.mjs';
import { ExportError, EXPORT_LIMITS, readBundleFile, readFileCapped, referencedDigests, verifyExport, writeExport } from './export.mjs';
import { runDemo } from './demo.mjs';
import { synbiosCommand } from './cli-synbios.mjs';
import { safe } from './display.mjs';

const DEFAULT_DATA = '.exofab';
const DEFAULT_PORT = 4317;
const DEFAULT_HUB = `http://127.0.0.1:${DEFAULT_PORT}`;
const KEY_FILE_BYTES = 16 * 1024;
const ARTIFACT_BYTES = 4 * 1024 * 1024;

const USAGE = `Usage: exofab <command> [options]

Local reference prototype of the Exofab first slice (a proposal). Synthetic data only.

Commands:
  serve [--data DIR] [--port N]       Run the hub and browser client on 127.0.0.1
  demo [--out DIR] [--data DIR]       Run the synthetic journey through the HTTP API, export it, verify it
  keygen OUT.pem                      Create an Ed25519 key file (mode 0600) and print its id
  verify BUNDLE [--expect-head H] [--expect-project P] [--blobs DIR]
                                      Verify a bundle offline and, with --blobs, the bytes it cites
  export PROJECT OUTDIR [--data DIR]  Write a project's bundle, cited bytes and VERIFY.txt
  import BUNDLE [--data DIR] [--expect-head H] [--blobs DIR]
                                      Import a verified bundle without changing attribution
  agent register --name NAME --key KEY.pem [--hub URL]
                                      Register an agent key under the person in EXOFAB_TOKEN
  agent submit --project PID --key KEY.pem --artifact FILE --title TEXT --summary TEXT
               [--delegation ID] [--hub URL]
                                      Store an artifact and sign contribution.submitted as the agent
  synbios task|inspect ...            Optional Synbios hand-off helpers

Run "exofab <command> --help" for details.
Exit status: 0 success, 1 failure, 2 usage error.
`;

const HELP = {
  serve: `Usage: exofab serve [--data DIR] [--port N]

Runs the hub and the browser client on http://127.0.0.1:N (default ${DEFAULT_PORT}).
Data is kept in DIR (default ./${DEFAULT_DATA}). A lock file in DIR stops a second
hub or an import from using the same directory at the same time. Stop with Ctrl+C.
`,
  demo: `Usage: exofab demo [--out DIR] [--data DIR]

Runs the synthetic first-slice journey through the HTTP API of a hub started on a
free loopback port: Ada and Ben form a team, agree a charter, Ben delegates to his
agent scribe, scribe submits, Ada reviews and accepts. The result is exported to
--out (default: a new temporary directory) and verified from disk. --out must
not already hold an export (bundle.json, blobs or VERIFY.txt); the demonstration
checks this before it starts.
--data keeps the hub's data in DIR, which must be empty or absent; without it a
temporary directory is used and removed afterwards. All data is fictional.
`,
  keygen: `Usage: exofab keygen OUT.pem

Creates an Ed25519 key as a PKCS#8 PEM file with mode 0600 and prints
{"id", "keyFile"}. Refuses to overwrite an existing file. The key is never printed.
`,
  verify: `Usage: exofab verify BUNDLE [--expect-head H] [--expect-project P] [--blobs DIR]

Checks every record id, signature, link and Koinos 0.1 authority rule of a
koinos-bundle/0.1 file, offline. --expect-head and --expect-project must match
exactly (a shorter history also verifies, so pin a head you trust). With --blobs,
also recomputes the SHA-256 of each agreement text and artifact from DIR/<sha256 hex>.
Prints a JSON summary with every cited URI. A URI that is not an ni:///sha-256 URI
is reported with a warning on stderr; it is never fetched or checked.
Exit status 1 if anything does not verify.
`,
  export: `Usage: exofab export PROJECT OUTDIR [--data DIR]

Reads project PROJECT from the hub data in DIR (default ./${DEFAULT_DATA}) without
a running hub, and writes OUTDIR/bundle.json, OUTDIR/blobs/<sha256 hex> for every
cited text and artifact, and OUTDIR/VERIFY.txt. Files are created exclusively;
nothing is overwritten. Refuses if any cited bytes are missing.
`,
  import: `Usage: exofab import BUNDLE [--data DIR] [--expect-head H] [--blobs DIR]

Verifies BUNDLE and stores it unchanged in the hub data in DIR (default
./${DEFAULT_DATA}), so signatures and attribution are kept. Refuses a history that
does not extend the one already stored. With --blobs, every cited text and
artifact must be in DIR/<sha256 hex> with matching bytes; they are stored too.
Warns on stderr when a history not started on this hub names identities
registered here: the project then appears in their lists, so import only
histories those people agreed to.
Refused while a hub is running on the same data directory.
`,
  agent: `Usage:
  exofab agent register --name NAME --key KEY.pem [--hub URL]
      Registers the agent whose key is in KEY.pem under the person whose token
      is in EXOFAB_TOKEN. The key signs a proof of possession. Prints the agent
      token once: store it privately and pass it as EXOFAB_AGENT_TOKEN.
  exofab agent submit --project PID --key KEY.pem --artifact FILE --title TEXT
                      --summary TEXT [--delegation ID] [--hub URL]
      As the agent in EXOFAB_AGENT_TOKEN: stores the bytes of FILE in the project,
      then signs contribution.submitted citing them, under the agent's active
      delegation (or the one given by --delegation).

--hub defaults to EXOFAB_HUB or ${DEFAULT_HUB}. Only loopback hubs are accepted.
`,
};

class UsageError extends Error {}
class CliError extends Error {}

// Untrusted text (hub messages, record fields) cannot drive the terminal:
// everything written to stdout or stderr from them goes through safe().
const printJson = (stream, value) => stream.write(`${safe(JSON.stringify(value, null, 2))}\n`);

function parse(args, options, positionals) {
  const parsed = parseArgs({ args, options: { ...options, help: { type: 'boolean', short: 'h' } }, allowPositionals: true, strict: true });
  if (!parsed.values.help && parsed.positionals.length !== positionals) {
    throw new UsageError(positionals === 0 ? 'unexpected argument' : `expected ${positionals} argument${positionals === 1 ? '' : 's'}`);
  }
  return parsed;
}

function required(values, names) {
  for (const name of names) if (values[name] === undefined) throw new UsageError(`--${name} is required`);
}

function parsePort(text) {
  if (!/^\d{1,5}$/.test(text) || Number(text) > 65535) throw new UsageError('--port must be a number from 0 to 65535');
  return Number(text);
}

// --- Data directory lock ------------------------------------------------------------------

// One process owns a data directory at a time (the hub's mutexes are per
// process). A lock left by a process that no longer runs is replaced, but only
// by the process that also holds exofab.lock.break: without it, two starters
// could each remove the stale lock, one of them removing the other's new one.
function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

// The pid in a lock file: undefined when there is no file, null when it
// cannot be read (treated as held, to be safe).
async function lockPid(path) {
  try {
    const pid = JSON.parse(await readFile(path, 'utf8')).pid;
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  } catch (error) {
    return error.code === 'ENOENT' ? undefined : null;
  }
}

async function createLock(path) {
  try {
    await writeFile(path, `${JSON.stringify({ pid: process.pid })}\n`, { flag: 'wx', mode: 0o600 });
    return true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return false;
  }
}

export async function acquireLock(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, 'exofab.lock');
  const breaker = `${path}.break`;
  const held = { path, release: () => unlink(path).catch(() => {}) };
  const inUse = (pid) =>
    new CliError(`The data directory is in use${pid ? ` by process ${pid}` : ''}. If no Exofab process uses it, remove ${path}.`);
  const refuseIfLive = async () => {
    const pid = await lockPid(path);
    if (pid === null || (pid !== undefined && isRunning(pid))) throw inUse(pid);
    return pid;
  };

  if (await createLock(path)) return held;
  await refuseIfLive();
  if (!(await createLock(breaker))) {
    throw new CliError(`Another process is replacing a stale lock in ${dir}. Try again; if it persists and no Exofab process runs, remove ${path} and ${breaker}.`);
  }
  try {
    // Holding the breaker, look again: the stale lock may be gone or replaced by now.
    if ((await refuseIfLive()) !== undefined) {
      try {
        await unlink(path);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    if (await createLock(path)) return held;
    await refuseIfLive();
    throw new CliError(`Could not lock the data directory; remove ${path} if no Exofab process uses it.`);
  } finally {
    await unlink(breaker).catch(() => {});
  }
}

function waitForStop(signal) {
  return new Promise((resolve) => {
    const done = () => {
      process.off('SIGINT', done);
      process.off('SIGTERM', done);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
    if (signal?.aborted) done();
    else signal?.addEventListener('abort', done, { once: true });
  });
}

// --- Commands -------------------------------------------------------------------------------

async function serve(args, io) {
  const { values } = parse(args, { data: { type: 'string' }, port: { type: 'string' } }, 0);
  if (values.help) return help(io, 'serve');
  const port = parsePort(values.port ?? String(DEFAULT_PORT));
  const dir = resolve(values.data ?? DEFAULT_DATA);
  const lock = await acquireLock(dir);
  let handle;
  try {
    handle = await createServer({ hub: new Hub({ store: new FileStore(dir) }), port, log: (m) => io.stderr.write(`${safe(m)}\n`) });
    io.stdout.write(`Exofab hub ${VERSION} (local prototype; synthetic data only) at ${handle.url}\n`);
    io.stdout.write(`Data directory: ${values.data ?? DEFAULT_DATA}. Stop with Ctrl+C.\n`);
    io.onListening?.(handle);
    await waitForStop(io.signal);
  } finally {
    await handle?.close();
    await lock.release();
  }
  return 0;
}

async function demo(args, io) {
  const { values } = parse(args, { out: { type: 'string' }, data: { type: 'string' } }, 0);
  if (values.help) return help(io, 'demo');
  const outDir = values.out === undefined ? await mkdtemp(join(tmpdir(), 'exofab-demo-out-')) : resolve(values.out);
  const dataDir = values.data === undefined ? await mkdtemp(join(tmpdir(), 'exofab-demo-data-')) : resolve(values.data);
  try {
    const result = await runDemo({ dataDir, outDir, log: (line) => io.stdout.write(`${safe(line)}\n`) });
    return result.verified.ok ? 0 : 1;
  } finally {
    if (values.data === undefined) await rm(dataDir, { recursive: true, force: true });
  }
}

async function keygen(args, io) {
  const { values, positionals } = parse(args, {}, 1);
  if (values.help) return help(io, 'keygen');
  const [keyFile] = positionals;
  const identity = await generateIdentity({ extractable: true });
  try {
    await writeFile(keyFile, await exportPkcs8Pem(identity.privateKey), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code === 'EEXIST') throw new CliError(`${keyFile} already exists; keygen never overwrites a key file`);
    throw new CliError(`Cannot write ${keyFile} (${error.code ?? 'error'})`);
  }
  printJson(io.stdout, { id: identity.id, keyFile });
  return 0;
}

async function verify(args, io) {
  const { values, positionals } = parse(args, { 'expect-head': { type: 'string' }, 'expect-project': { type: 'string' }, blobs: { type: 'string' } }, 1);
  if (values.help) return help(io, 'verify');
  const result = await verifyExport({
    bundlePath: positionals[0],
    blobsDir: values.blobs,
    expectedHead: values['expect-head'],
    expectedProject: values['expect-project'],
  });
  const { state, cited, ...summary } = result;
  printJson(io.stdout, {
    ...summary,
    cited: cited.map(({ kind, id, uri, digest }) => ({ kind, id, uri, digest })),
    blobs:
      result.blobs?.map(({ kind, id, uri, digest, ok, uriChecked, problem }) =>
        ok ? { kind, id, uri, digest, ok, uriChecked } : { kind, id, uri, digest, ok, problem },
      ) ?? null,
  });
  if (!result.ok) io.stderr.write('exofab verify: the history verifies, but cited bytes are missing or do not match\n');
  // A URI of another scheme is neither fetched nor checked; only the digest binds the bytes.
  for (const { kind, id, uri } of cited.filter((c) => !c.uri.startsWith(NI_PREFIX))) {
    io.stderr.write(`${safe(`exofab verify: warning: ${kind} ${id} cites ${JSON.stringify(uri)}, which is not an ni:///sha-256 URI; it was not checked or fetched`)}\n`);
  }
  return result.ok ? 0 : 1;
}

async function exportCommand(args, io) {
  const { values, positionals } = parse(args, { data: { type: 'string' } }, 2);
  if (values.help) return help(io, 'export');
  const [project, outDir] = positionals;
  const dir = resolve(values.data ?? DEFAULT_DATA);
  if (!(await stat(join(dir, 'hub.json')).catch(() => null))) throw new CliError(`No hub data in ${values.data ?? DEFAULT_DATA}`);
  const store = new FileStore(dir);
  const bundle = await store.readBundle(project);
  if (!bundle) throw new CliError(`Project ${project} is not stored in ${values.data ?? DEFAULT_DATA}`);
  const state = await verifyBundle(bundle, { expectedProject: project });
  const blobs = new Map();
  for (const { digest } of referencedDigests(state)) {
    const bytes = await store.getBlob(digest);
    if (bytes) blobs.set(digest, bytes);
  }
  const exported = await writeExport({ outDir, bundle, blobs });
  printJson(io.stdout, { project: exported.project, head: exported.head, count: exported.count, outDir, blobs: exported.digests.length });
  return 0;
}

async function importCommand(args, io) {
  const { values, positionals } = parse(args, { data: { type: 'string' }, 'expect-head': { type: 'string' }, blobs: { type: 'string' } }, 1);
  if (values.help) return help(io, 'import');
  const bundle = await readBundleFile(positionals[0]);
  // Check the cited bytes before storing anything, so a bad directory changes nothing.
  const bytes = new Map();
  if (values.blobs !== undefined) {
    for (const { digest, kind, id } of referencedDigests(await verifyBundle(bundle))) {
      const data = await readFileCapped(join(values.blobs, digest), EXPORT_LIMITS.blobBytes, `blobs/${digest}`);
      if (!data) throw new CliError(`--blobs has no file for ${kind} ${id} (sha256 ${digest})`);
      if ((await sha256Hex(data)) !== digest) throw new CliError(`--blobs file ${digest} does not match its digest`);
      bytes.set(digest, data);
    }
  }
  const dir = resolve(values.data ?? DEFAULT_DATA);
  const lock = await acquireLock(dir);
  try {
    const store = new FileStore(dir);
    const hub = new Hub({ store });
    const result = await hub.importBundle(bundle, values['expect-head'] === undefined ? {} : { expectedHead: values['expect-head'] });
    for (const [digest, data] of bytes) {
      await store.putBlob(data);
      await store.linkBlob(result.project, digest);
    }
    printJson(io.stdout, { ...result, blobs: bytes.size });
    if (result.registered) {
      io.stderr.write(
        `exofab import: warning: this history was not started on this hub, and it names ${result.registered.length} ` +
          'identities registered here as participants. Each now sees the project in their list. Import only ' +
          `histories those people agreed to: ${result.registered.join(', ')}\n`,
      );
    }
    return 0;
  } finally {
    await lock.release();
  }
}

async function loadKey(path, io) {
  const bytes = await readFileCapped(path, KEY_FILE_BYTES, 'The key file');
  if (!bytes) throw new CliError('The key file does not exist');
  if (process.platform !== 'win32' && ((await stat(path)).mode & 0o077) !== 0) {
    io.stderr.write('exofab: warning: the key file is readable by other users; run chmod 600 on it\n');
  }
  try {
    return await identityFromPkcs8Pem(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new CliError('The key file is not an Ed25519 PKCS#8 PEM private key');
  }
}

function hubClient(values, env, tokenName) {
  const token = env[tokenName];
  if (typeof token !== 'string' || token === '') throw new UsageError(`Set ${tokenName} in the environment`);
  try {
    return new ExofabClient({ baseUrl: values.hub ?? env.EXOFAB_HUB ?? DEFAULT_HUB, token });
  } catch (error) {
    throw new UsageError(error.message);
  }
}

async function agentRegister(args, io) {
  const { values } = parse(args, { name: { type: 'string' }, key: { type: 'string' }, hub: { type: 'string' } }, 0);
  if (values.help) return help(io, 'agent');
  required(values, ['name', 'key']);
  const client = hubClient(values, io.env, 'EXOFAB_TOKEN');
  const identity = await loadKey(values.key, io);
  const { agent, token } = await client.registerAgent({ name: values.name, identity });
  printJson(io.stdout, { agent, token });
  io.stderr.write('exofab: this agent token is shown only once. Keep it private and pass it as EXOFAB_AGENT_TOKEN.\n');
  return 0;
}

// The agent's active delegation: the one named, or its only active one.
function chooseDelegation(state, agent, named, now) {
  const active = state.delegations.filter((d) => d.agent === agent && !d.revoked && d.expires > now);
  if (named !== undefined) {
    const found = active.find((d) => d.id === named);
    if (!found) throw new CliError(`Delegation ${named} is not an active delegation to this agent`);
    return found;
  }
  if (active.length === 1) return active[0];
  if (active.length === 0) throw new CliError('This agent has no active delegation in the project');
  throw new CliError(`This agent has ${active.length} active delegations; choose one with --delegation (${active.map((d) => d.id).join(', ')})`);
}

async function agentSubmit(args, io) {
  const options = { project: {}, key: {}, artifact: {}, title: {}, summary: {}, delegation: {}, hub: {} };
  for (const option of Object.values(options)) option.type = 'string';
  const { values } = parse(args, options, 0);
  if (values.help) return help(io, 'agent');
  required(values, ['project', 'key', 'artifact', 'title', 'summary']);
  const client = hubClient(values, io.env, 'EXOFAB_AGENT_TOKEN');
  const identity = await loadKey(values.key, io);
  const me = await client.me();
  if (me.kind !== 'agent') throw new CliError('EXOFAB_AGENT_TOKEN does not belong to an agent');
  if (me.id !== identity.id) throw new CliError('The key file does not belong to the agent in EXOFAB_AGENT_TOKEN');
  const artifact = await readFileCapped(values.artifact, ARTIFACT_BYTES, 'The artifact file');
  if (!artifact) throw new CliError('The artifact file does not exist');
  const { state } = await client.getProject(values.project);
  const delegation = chooseDelegation(state, me.id, values.delegation, new Date().toISOString());
  const stored = await client.putBlob(values.project, artifact);
  const body = {
    title: values.title,
    summary: values.summary,
    artifact: { uri: stored.uri, digest: stored.digest },
    agreement: delegation.agreement,
    delegation: delegation.id,
  };
  const result = await client.appendSigned({ pid: values.project, identity, kind: 'contribution.submitted', body });
  printJson(io.stdout, { project: values.project, contribution: result.head, count: result.count, delegation: delegation.id, artifact: stored });
  return 0;
}

async function agent(args, io) {
  const [sub, ...rest] = args;
  if (sub === 'register') return agentRegister(rest, io);
  if (sub === 'submit') return agentSubmit(rest, io);
  if (sub === undefined || sub === '--help' || sub === '-h' || sub === 'help') return help(io, 'agent', sub === undefined ? 2 : 0);
  throw new UsageError('agent takes register or submit');
}

function help(io, command, status = 0) {
  (status === 0 ? io.stdout : io.stderr).write(command ? HELP[command] : USAGE);
  return status;
}

const COMMANDS = { serve, demo, keygen, verify, export: exportCommand, import: importCommand, agent };

function describe(error) {
  if (error instanceof ExofabHttpError) return `the hub refused (${error.status} ${error.code}${error.koinosCode ? `/${error.koinosCode}` : ''}): ${error.message}`;
  if (error instanceof KoinosError) return `does not verify (${error.code}): ${error.message}`;
  if (error instanceof HubError) return `refused (${error.code}): ${error.message}`;
  if (error instanceof StoreError && (error.code === 'invalid' || error.code === 'full')) return error.message;
  if (error instanceof StoreError) return `the stored hub data failed a check (${error.code}): ${error.message}`;
  if (error instanceof ExportError || error instanceof CliError) return error.message;
  if (error?.cause?.code === 'ECONNREFUSED') return 'cannot reach the hub; is "exofab serve" running?';
  if (error?.code === 'EEXIST') return `${error.path ?? 'a file'} already exists; nothing was overwritten`;
  return error?.message ?? String(error);
}

// io: {stdout, stderr, env, signal}. signal stops `serve`; onListening(handle) is called once it listens.
export async function main(argv, io = {}) {
  io = { stdout: process.stdout, stderr: process.stderr, env: process.env, ...io };
  const [command, ...args] = argv;
  if (command === undefined) return help(io, null, 2);
  if (command === '--help' || command === '-h' || command === 'help') return help(io, null);
  if (command === '--version') {
    io.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (command === 'synbios') return synbiosCommand(args, { stdout: io.stdout, stderr: io.stderr, env: io.env });
  const run = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : null;
  try {
    if (!run) throw new UsageError(`unknown command ${JSON.stringify(command)}`);
    return await run(args, io);
  } catch (error) {
    if (error instanceof UsageError || (error instanceof TypeError && error.code?.startsWith('ERR_PARSE_ARGS'))) {
      io.stderr.write(`exofab${run ? ` ${command}` : ''}: ${safe(error.message)}\nRun "exofab ${run ? `${command} ` : ''}--help" for usage.\n`);
      return 2;
    }
    io.stderr.write(`exofab ${command}: ${safe(describe(error))}\n`);
    return 1;
  }
}

function invokedDirectly() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) process.exitCode = await main(process.argv.slice(2));
