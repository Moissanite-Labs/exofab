// Portable exports: a koinos-bundle/0.1 file, the exact bytes its records cite,
// and a short note on how to check both. Used by `exofab export`,
// `exofab verify` and the demonstration. Node.js only.
//
// Layout of an export directory:
//   bundle.json      canonical JSON of the bundle, then a newline
//   blobs/<sha256>   each cited agreement text and artifact, named by its hex digest
//   VERIFY.txt       how to verify, with and without Exofab
import { mkdir, open, constants } from 'node:fs/promises';
import { join } from 'node:path';
import { BUNDLE_FORMAT, LIMITS, NI_PREFIX, canonicalize, hexFromNiUri, sha256Hex, verifyBundle } from './koinos/index.mjs';
import { parseStrictJson } from './json/strict.mjs';

export const EXPORT_LIMITS = Object.freeze({
  bundleBytes: LIMITS.bundleBytes + 1, // canonical JSON plus a final newline
  blobBytes: 16 * 1024 * 1024,
});
const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
const HEX64 = /^[0-9a-f]{64}$/;

export class ExportError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ExportError';
  }
}

// Every digest the verified state cites: agreement terms, then artifacts.
export function referencedDigests(state) {
  const out = [];
  for (const a of state.agreements) out.push({ kind: 'agreement', id: a.id, title: a.title, uri: a.uri, digest: a.digest });
  for (const c of state.contributions) out.push({ kind: 'artifact', id: c.id, title: c.title, uri: c.artifact.uri, digest: c.artifact.digest });
  return out;
}

// Reads a regular file (never through a symbolic link) of at most `cap` bytes.
export async function readFileCapped(path, cap, label) {
  let handle;
  try {
    handle = await open(path, READ_FLAGS);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error.code === 'ELOOP') throw new ExportError(`${label} is a symbolic link`);
    throw new ExportError(`Cannot read ${label} (${error.code ?? 'error'})`, { cause: error });
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new ExportError(`${label} is not a regular file`);
    if (info.size > cap) throw new ExportError(`${label} is larger than ${cap} bytes`);
    const bytes = await handle.readFile();
    if (bytes.length > cap) throw new ExportError(`${label} is larger than ${cap} bytes`);
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  } finally {
    await handle.close();
  }
}

export function verifyNote({ project, head, count }) {
  return `Exofab export (${BUNDLE_FORMAT})

project: ${project}
head:    ${head}
records: ${count}

Files
  bundle.json     The project's complete signed Koinos 0.1 history, as canonical JSON.
  blobs/<sha256>  The exact bytes the records cite: agreement terms and contribution
                  artifacts. Each file is named by the lowercase hex SHA-256 of its bytes.

Verify with Exofab (offline; no hub is needed). From this directory, with
EXOFAB set to the path of an Exofab checkout:
  node "$EXOFAB/src/cli.mjs" verify bundle.json --blobs blobs --expect-project ${project} --expect-head ${head}
This checks every record id, signature, link and Koinos 0.1 authority rule, then
recomputes the SHA-256 of every cited file. Where a record cites an ni:///sha-256
URI, it checks that the URI names the same digest; any other URI is shown with a
warning and is never fetched.

Verify without Exofab:
  1. Check bundle.json with any Koinos 0.1 verifier, for example the Koinos reference
     implementation. From this directory, with KOINOS set to the path of a Koinos
     checkout: node "$KOINOS/src/cli.mjs" verify ./bundle.json ${head} ${project}
     (the last two arguments pin the head and the project).
  2. Recompute each file's SHA-256 (sha256sum blobs/* or shasum -a 256 blobs/*). It must
     equal the file name, the "digest" of the agreement.proposed record that cites it,
     or the "artifact.digest" of the contribution.submitted record that cites it.

Trust notes
  - A shorter history also verifies. Compare the head above with one you obtained
    from a participant you trust.
  - A signature proves control of a key, not identity. Names are declarations.
  - Nothing here is encrypted: whoever receives these files can read every record.
`;
}

// Opens a new file exclusively and writes it, mode 0600.
async function writeNew(path, data) {
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

// Verifies the bundle and the bytes, then writes the export. Files are created
// exclusively, so nothing that already exists is overwritten. `blobs` maps hex
// digests to bytes and must hold every digest the records cite.
export async function writeExport({ outDir, bundle, blobs }) {
  const state = await verifyBundle(bundle);
  const cited = referencedDigests(state);
  for (const { digest, kind, id } of cited) {
    const bytes = blobs.get(digest);
    if (!bytes) throw new ExportError(`The bytes of ${kind} ${id} (sha256 ${digest}) are not available, so the export would be incomplete`);
    if ((await sha256Hex(bytes)) !== digest) throw new ExportError(`The stored bytes for sha256 ${digest} do not match their digest`);
  }
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  await mkdir(join(outDir, 'blobs'), { mode: 0o700 });
  await writeNew(join(outDir, 'bundle.json'), `${canonicalize(bundle)}\n`);
  const digests = [...new Set(cited.map((c) => c.digest))];
  for (const digest of digests) await writeNew(join(outDir, 'blobs', digest), blobs.get(digest));
  const summary = { project: state.project.id, head: state.head, count: state.count };
  await writeNew(join(outDir, 'VERIFY.txt'), verifyNote(summary));
  return { ...summary, bundlePath: join(outDir, 'bundle.json'), blobsDir: join(outDir, 'blobs'), digests };
}

export async function readBundleFile(path) {
  const bytes = await readFileCapped(path, EXPORT_LIMITS.bundleBytes, 'The bundle file');
  if (!bytes) throw new ExportError('The bundle file does not exist');
  try {
    return parseStrictJson(bytes, { maxBytes: EXPORT_LIMITS.bundleBytes });
  } catch (error) {
    throw new ExportError(`The bundle file is not strict JSON: ${error.message}`, { cause: error });
  }
}

// Checks one cited file: present, SHA-256 equal to the digest, and an ni: URI
// that names the same digest. A URI of another scheme is reported, not fetched.
async function checkBlob(blobsDir, item) {
  const result = { ...item, ok: false };
  if (!HEX64.test(item.digest)) return { ...result, problem: 'digest is not lowercase SHA-256 hex' };
  const bytes = await readFileCapped(join(blobsDir, item.digest), EXPORT_LIMITS.blobBytes, `blobs/${item.digest}`);
  if (!bytes) return { ...result, problem: 'file is missing' };
  if ((await sha256Hex(bytes)) !== item.digest) return { ...result, problem: 'file bytes do not match the digest' };
  if (item.uri.startsWith(NI_PREFIX)) {
    let named;
    try {
      named = hexFromNiUri(item.uri);
    } catch {
      return { ...result, problem: 'ni: URI is malformed' };
    }
    if (named !== item.digest) return { ...result, problem: 'ni: URI names a different digest' };
    return { ...result, ok: true, uriChecked: true };
  }
  return { ...result, ok: true, uriChecked: false };
}

// Verifies a bundle file and, with blobsDir, every cited file. Throws
// KoinosError for a history that does not verify; returns a summary whose
// `ok` is false when a cited file is missing or wrong.
export async function verifyExport({ bundlePath, blobsDir, expectedHead, expectedProject }) {
  const bundle = await readBundleFile(bundlePath);
  const pins = {};
  if (expectedHead !== undefined) pins.expectedHead = expectedHead;
  if (expectedProject !== undefined) pins.expectedProject = expectedProject;
  const state = await verifyBundle(bundle, pins);
  const cited = referencedDigests(state);
  const blobs = blobsDir === undefined ? null : await Promise.all(cited.map((item) => checkBlob(blobsDir, item)));
  return {
    ok: blobs === null || blobs.every((b) => b.ok),
    project: state.project.id,
    title: state.project.title,
    head: state.head,
    count: state.count,
    participants: state.participants.map((p) => ({ id: p.id, name: p.name, kind: p.kind })),
    contributions: state.contributions.map((c) => ({ id: c.id, title: c.title, status: c.status, actor: c.actor, principal: c.principal })),
    cited,
    blobs,
    state,
  };
}
