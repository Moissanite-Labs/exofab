// Synthetic end-to-end journey of the first slice, driven through the HTTP API
// with ExofabClient against a hub on 127.0.0.1 with a fresh data directory.
// Every person, agent, brief, charter and artifact here is fictional.
//
// Keys: Ada's and Ben's are generated in memory, non-extractable, as a browser
// would keep them. Scribe's key belongs to the agent's runtime, so it is
// written as a PKCS#8 PEM (mode 0600) to a temporary directory, loaded back,
// and that directory is removed at the end. The hub only ever receives
// public keys, proofs and signed records.
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportPkcs8Pem, generateIdentity, identityFromPkcs8Pem, sha256Hex, utf8 } from './koinos/index.mjs';
import { FileStore } from './hub/store.mjs';
import { Hub } from './hub/hub.mjs';
import { createServer } from './server.mjs';
import { ExofabClient } from './client.mjs';
import { referencedDigests, verifyExport, writeExport } from './export.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const TEXT = 'text/plain; charset=utf-8';

export const DEMO_COMPENSATION = 'None offered. Credit is recorded for accepted work only.';
export const NO_ECONOMIC_RIGHT =
  'This record does not create, transfer, or promise any payment, equity, revenue share, token, or other economic right.';

export const DEMO_BRIEF = Object.freeze({
  title: 'Recipe-scaling skill for Exo (synthetic)',
  summary:
    'Synthetic demonstration brief. A small Exo skill that scales home-baking recipes up and down, with tests. ' +
    'Ada runs a fictional community of home bakers and needs a builder.',
  compensation: DEMO_COMPENSATION,
  roles: [{ title: 'Skill builder', skills: ['exo-skills', 'testing'], commitment: 'A few evenings' }],
  listed: true,
});

export const DEMO_CHARTER = `Charter (synthetic demonstration)

Project: Recipe-scaling skill for Exo (synthetic)
Parties: Ada and Ben, fictional people in a synthetic demonstration.

Scope
- One Exo skill that scales the ingredient amounts of a home-baking recipe by a factor.
- Tests for the scaling rules.

Acceptance criteria
- Every ingredient amount is multiplied by the requested factor.
- The tests included in the artifact pass.
- Ada reviews the exact artifact bytes and approves them before acceptance.

Credit
- An accepted contribution is recorded as credit for the submitter and, for agent work,
  the responsible principal. Credit is a record of accepted work, visible to the team.

${NO_ECONOMIC_RIGHT}
`;

export const DEMO_ARTIFACT = `# recipe-scale (synthetic demonstration skill)

Scales the ingredient amounts of a recipe by a factor.

## Rules
- Multiply every amount by the factor.
- Round grams to the nearest whole gram; keep spoon measures to two decimals.

## Tests (synthetic)
- 2 x 250 g flour = 500 g flour: pass
- 0.5 x 3 eggs = 1.5 eggs: pass
- 1.5 x 0.75 tsp salt = 1.13 tsp salt: pass
`;

class DemoError extends Error {}

async function freshDirectory(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if ((await readdir(dir)).length > 0) throw new DemoError(`The demonstration needs an empty data directory: ${dir}`);
}

async function fetchChecked(client, pid, digest, label) {
  const bytes = await client.getBlob(pid, digest);
  if ((await sha256Hex(bytes)) !== digest) throw new DemoError(`${label} bytes from the hub do not match their digest`);
  return bytes;
}

// Runs the journey and returns a summary. Resolves only if the export written
// to outDir verifies from disk.
export async function runDemo({ dataDir, outDir, log = (line) => process.stdout.write(`${line}\n`) } = {}) {
  if (typeof dataDir !== 'string' || typeof outDir !== 'string') throw new TypeError('runDemo needs dataDir and outDir');
  await freshDirectory(dataDir);
  const keyDir = await mkdtemp(join(tmpdir(), 'exofab-demo-agent-'));
  const server = await createServer({ hub: new Hub({ store: new FileStore(dataDir) }), port: 0, log });
  const step = (n, text) => log(`${String(n).padStart(2)}. ${text}`);
  try {
    log('Exofab synthetic demonstration: fictional people, agent and data');
    log(`Hub: ${server.url} (loopback only)`);
    const hub = new ExofabClient({ baseUrl: server.url });

    // 1. People register with keys generated and kept on their side.
    const adaKey = await generateIdentity();
    const benKey = await generateIdentity();
    const ada = hub.withToken((await hub.registerPerson({ name: 'Ada', identity: adaKey })).token);
    const ben = hub.withToken((await hub.registerPerson({ name: 'Ben', identity: benKey })).token);
    step(1, 'Ada and Ben registered keys generated in memory (non-extractable); the hub holds public keys only');

    await ada.updateProfile({
      headline: 'Runs a fictional home-baking community (synthetic person)',
      skills: ['community', 'recipes'],
      seeking: ['A builder for a recipe-scaling skill'],
      listed: true,
    });
    await ben.updateProfile({
      headline: 'Builds Exo skills (synthetic person)',
      skills: ['exo-skills', 'testing'],
      seeking: ['Small skill projects'],
      listed: true,
    });
    step(2, 'Both listed explicit profiles with declared skills');

    const brief = await ada.publishBrief(DEMO_BRIEF);
    step(3, `Ada published the brief "${brief.title}"; compensation: ${brief.compensation}`);

    const suggestion = (await ben.suggestions()).find((s) => s.brief.id === brief.id);
    if (!suggestion || suggestion.reasons.length === 0) throw new DemoError('Ben was not shown the brief with a reason');
    step(4, `Ben was suggested the role "${suggestion.role.title}" because: ${suggestion.reasons.join('; ')}`);

    const interest = await ben.expressInterest(brief.id, { role: suggestion.role.id, note: 'I build Exo skills and can start this week. (synthetic)' });
    const candidate = await ada.getPerson(interest.candidate);
    await ada.decideInterest(interest.id, 'accept');
    step(5, `Ben expressed interest; Ada read ${candidate.name}'s profile and accepted: a double opt-in`);

    // 2. Ben's agent: its key lives in the agent runtime's key file.
    const generated = await generateIdentity({ extractable: true });
    const keyFile = join(keyDir, 'scribe.pem');
    await writeFile(keyFile, await exportPkcs8Pem(generated.privateKey), { flag: 'wx', mode: 0o600 });
    const scribeKey = await identityFromPkcs8Pem(await readFile(keyFile, 'utf8'));
    const registered = await ben.registerAgent({ name: 'scribe', identity: scribeKey });
    const scribe = hub.withToken(registered.token);
    await ben.nominateAgent(brief.id, scribeKey.id);
    step(6, 'Ben registered his agent scribe (its own key, proven by signature) and nominated it to the team');

    // 3. The Koinos record: every record below is signed by its actor's own key.
    const started = await ada.startSigned({ briefId: brief.id, identity: adaKey });
    const pid = started.project;
    step(7, `Ada signed project.created listing Ada, Ben and scribe; she is the steward (project ${pid})`);

    const terms = await ada.putBlob(pid, utf8(DEMO_CHARTER), TEXT);
    if (terms.digest !== (await sha256Hex(DEMO_CHARTER))) throw new DemoError('The hub reported a different charter digest');
    const proposal = { title: 'Charter (synthetic)', uri: terms.uri, digest: terms.digest, parties: [adaKey.id, benKey.id] };
    const agreement = (await ada.appendSigned({ pid, identity: adaKey, kind: 'agreement.proposed', body: proposal })).head;
    step(8, `Ada stored the charter text (sha256 ${terms.digest}) and proposed it as an agreement`);

    for (const [client, identity] of [[ada, adaKey], [ben, benKey]]) {
      await fetchChecked(client, pid, terms.digest, 'Charter');
      await client.appendSigned({ pid, identity, kind: 'agreement.consented', body: { agreement } });
    }
    step(9, 'Ada and Ben each read the exact charter bytes, checked the digest, and consented');

    const expires = new Date(Date.now() + 14 * DAY_MS).toISOString();
    const grant = { agent: scribeKey.id, agreement, scope: ['contribution.submit'], expires };
    const delegation = (await ben.appendSigned({ pid, identity: benKey, kind: 'delegation.granted', body: grant })).head;
    step(10, `Ben delegated contribution.submit to scribe under the charter until ${expires}`);

    const artifact = await scribe.putBlob(pid, utf8(DEMO_ARTIFACT), TEXT);
    const submission = {
      title: 'recipe-scale skill v1 (synthetic)',
      summary: 'Scales recipe amounts by a factor; the three synthetic tests in the file pass.',
      artifact: { uri: artifact.uri, digest: artifact.digest },
      agreement,
      delegation,
    };
    const contribution = (await scribe.appendSigned({ pid, identity: scribeKey, kind: 'contribution.submitted', body: submission })).head;
    step(11, `scribe stored the artifact (sha256 ${artifact.digest}) and signed contribution.submitted`);

    await fetchChecked(ada, pid, artifact.digest, 'Artifact');
    const reviewBody = { contribution, decision: 'approve', note: 'Read the exact artifact bytes; the rules and tests meet the charter. (synthetic)' };
    const review = (await ada.appendSigned({ pid, identity: adaKey, kind: 'contribution.reviewed', body: reviewBody })).head;
    step(12, 'Ada, neither the submitter nor the principal, reviewed the artifact bytes and approved');

    const accepted = await ada.appendSigned({ pid, identity: adaKey, kind: 'contribution.accepted', body: { contribution, review } });
    step(13, `Ada, as steward, accepted the contribution citing her review (${accepted.count} records)`);

    const credit = await ada.credit(benKey.id);
    step(14, `Credit visible to the team: Ben has ${credit.length} accepted contribution${credit.length === 1 ? '' : 's'}, submitted via scribe`);

    // 4. Export from the hub as a participant, then verify from disk only.
    const bundle = await ada.getBundle(pid);
    const blobs = new Map();
    for (const { digest } of referencedDigests(accepted.state)) blobs.set(digest, await fetchChecked(ada, pid, digest, 'Cited'));
    const exported = await writeExport({ outDir, bundle, blobs });
    const verified = await verifyExport({ bundlePath: exported.bundlePath, blobsDir: exported.blobsDir, expectedHead: accepted.head, expectedProject: pid });
    if (!verified.ok) throw new DemoError('The export does not verify from disk');
    step(15, `Exported and verified from disk: ${verified.count} records, every signature and authority rule, ${verified.blobs.length} digests`);

    log('');
    log(`Bundle:  ${exported.bundlePath}`);
    log(`Bytes:   ${exported.blobsDir}`);
    log(`Head:    ${accepted.head}`);
    log('Synthetic data only. Credit is a record of accepted work, not money.');

    return {
      url: server.url,
      project: pid,
      head: accepted.head,
      count: accepted.count,
      brief: brief.id,
      people: { ada: adaKey.id, ben: benKey.id },
      agent: scribeKey.id,
      agreement,
      delegation,
      contribution,
      review,
      credit,
      export: exported,
      verified: { ok: verified.ok, head: verified.head, count: verified.count, blobs: verified.blobs.length },
    };
  } finally {
    await server.close();
    await rm(keyDir, { recursive: true, force: true });
  }
}
