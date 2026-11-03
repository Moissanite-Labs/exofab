// Differential tests against a Koinos 0.1 checkout, for a maintainer to run:
//   KOINOS_DIR=/path/to/koinos node --test test/interop-koinos.test.mjs
// Without KOINOS_DIR every test here is skipped. With it, the Koinos command-line
// tool ($KOINOS_DIR/src/cli.mjs) runs as a separate process on temporary files;
// no Koinos code is imported into this process. Synthetic identities only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  KoinosError,
  PROTOCOL,
  BUNDLE_FORMAT,
  KEY_PREFIX,
  b64url,
  sha256Hex,
  niUri,
  generateIdentity,
  signText,
  recordId,
  signingText,
  createRecord,
  createBundle,
  verifyBundle,
} from '../src/koinos/index.mjs';

// Resolved once: the CLI also runs with a temporary directory as its cwd, where
// a relative KOINOS_DIR would point somewhere else.
const KOINOS_DIR = process.env.KOINOS_DIR ? resolve(process.env.KOINOS_DIR) : undefined;
const SKIP ='KOINOS_DIR is not set; Koinos differential tests skipped. Set KOINOS_DIR to a Koinos 0.1 checkout to run them.';

const BASE = Date.UTC(2026, 9, 29);
const EXPIRES = '2026-11-12T00:00:00.000Z';
const OTHER_PROJECT = '0b5d7a3e-2f4c-4d1a-9e8b-7c6d5e4f3a2b';
const TERMS = await sha256Hex('Charter: scope, acceptance criteria, credit. Creates no economic right.\n');
const ART = await sha256Hex('Synthetic artifact bytes.\n');

const keys = KOINOS_DIR
  ? {
      ada: await generateIdentity(),
      ben: await generateIdentity(),
      scribe: await generateIdentity(),
      helper: await generateIdentity(),
    }
  : null;
const id = (who) => keys[who].id;

async function requireKoinos(t) {
  if (!KOINOS_DIR) {
    t.skip(SKIP);
    return false;
  }
  await access(join(KOINOS_DIR, 'src', 'cli.mjs')).catch(() => {
    throw new Error(`KOINOS_DIR is set but ${join(KOINOS_DIR, 'src', 'cli.mjs')} is missing`);
  });
  return true;
}

// Runs the Koinos CLI. Resolves {ok, stdout, stderr}; ok is false on a
// non-zero exit. Spawn failures and timeouts reject. The CLI needs no
// environment, so none is passed on: no credentials reach sibling code, and
// NODE_OPTIONS or the test runner's own variables cannot change how it runs.
function koinos(args, cwd) {
  const env = { PATH: process.env.PATH ?? '' };
  return new Promise((done, reject) => {
    execFile(
      process.execPath,
      [join(KOINOS_DIR, 'src', 'cli.mjs'), ...args],
      { cwd, env, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') reject(error);
        else done({ ok: !error, stdout, stderr });
      },
    );
  });
}

async function withTemp(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'exofab-koinos-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const participants = (names) => names.map((n) => ({ id: id(n), name: n === 'ada' ? 'Ada' : n === 'ben' ? 'Ben' : n, kind: ['ada', 'ben'].includes(n) ? 'human' : 'agent' }));
const genesisBody = (names = ['ada', 'ben', 'scribe']) => ({
  title: 'Recipe scaler \u{1F35E}',
  description: 'Synthetic project: café bakers   scale recipes.',
  participants: participants(names),
});
const proposalBody = (parties = ['ada', 'ben']) => ({ title: 'Charter', uri: niUri(TERMS), digest: TERMS, parties: parties.map(id) });
const grantBody = (agreement, extra = {}) => ({ agent: id('scribe'), agreement, scope: ['contribution.submit'], expires: EXPIRES, ...extra });
const submitBody = (agreement, delegation, extra = {}) => ({
  title: 'Scaling module',
  summary: 'Scales quantities ½ → 1; tests are inside the artifact.',
  artifact: { uri: niUri(ART), digest: ART },
  agreement,
  delegation,
  ...extra,
});
const reviewBody = (contribution, decision = 'approve', note = 'Checked the exact bytes ✓') => ({ contribution, decision, note });

// Histories built with this implementation's createRecord (fully checked).
class Story {
  records = [];
  tick = 0;
  async add(who, kind, body) {
    const time = new Date(BASE + 1000 * this.tick++).toISOString();
    const record = await createRecord({ records: this.records, identity: keys[who], kind, body, time });
    this.records.push(record);
    return record;
  }
}

// Histories signed without any rule checks, to produce bundles that are
// correctly hashed, linked and signed but break exactly one rule.
class Raw {
  records = [];
  tick = 0;
  project = globalThis.crypto.randomUUID();
  async add(who, kind, body, overrides = {}) {
    const last = this.records.at(-1);
    const unsigned = {
      protocol: PROTOCOL,
      project: this.project,
      sequence: this.records.length,
      previous: last?.id ?? null,
      time: new Date(BASE + 1000 * this.tick++).toISOString(),
      actor: id(who),
      kind,
      body,
      ...overrides,
    };
    const recId = await recordId(unsigned);
    const record = { ...unsigned, id: recId, signature: await signText(keys[who].privateKey, signingText(recId)) };
    this.records.push(record);
    return record;
  }
  bundle() {
    return { format: BUNDLE_FORMAT, records: structuredClone(this.records) };
  }
}

async function consented(raw, { expires = EXPIRES, grant = true } = {}) {
  await raw.add('ada', 'project.created', genesisBody());
  const a = (await raw.add('ada', 'agreement.proposed', proposalBody())).id;
  await raw.add('ada', 'agreement.consented', { agreement: a });
  await raw.add('ben', 'agreement.consented', { agreement: a });
  const d = grant ? (await raw.add('ben', 'delegation.granted', grantBody(a, { expires }))).id : null;
  return { a, d };
}

async function submitted(raw, options) {
  const ids = await consented(raw, options);
  ids.c = (await raw.add('scribe', 'contribution.submitted', submitBody(ids.a, ids.d))).id;
  return ids;
}

async function accepted(raw) {
  const ids = await submitted(raw);
  ids.r = (await raw.add('ada', 'contribution.reviewed', reviewBody(ids.c))).id;
  ids.acc = (await raw.add('ada', 'contribution.accepted', { contribution: ids.c, review: ids.r })).id;
  return ids;
}

async function acceptedBundle() {
  const raw = new Raw();
  await accepted(raw);
  return raw.bundle();
}

// Compares Koinos import, verify and inspect with this implementation.
async function crossCheck(records) {
  const bundle = await createBundle(records);
  const ours = await verifyBundle(bundle);
  await withTemp(async (dir) => {
    const file = join(dir, 'exofab.bundle.json');
    const store = join(dir, 'store.json');
    await writeFile(file, JSON.stringify(bundle));
    const imported = await koinos(['import', store, file], dir);
    assert.ok(imported.ok, `Koinos import failed: ${imported.stderr}`);
    assert.deepStrictEqual(JSON.parse(imported.stdout), { head: ours.head, count: ours.count });
    const verified = await koinos(['verify', store, ours.head, ours.project.id], dir);
    assert.ok(verified.ok, `Koinos verify failed: ${verified.stderr}`);
    assert.deepStrictEqual(JSON.parse(verified.stdout), { valid: true, head: ours.head, count: ours.count });
    const inspected = await koinos(['inspect', store], dir);
    assert.ok(inspected.ok, `Koinos inspect failed: ${inspected.stderr}`);
    assert.deepStrictEqual(JSON.parse(inspected.stdout), ours);
  });
}

test('Koinos example bundle: this verifier derives the same state as Koinos inspect', async (t) => {
  if (!(await requireKoinos(t))) return;
  const path = join(KOINOS_DIR, 'examples', 'accepted.bundle.json');
  const ours = await verifyBundle(JSON.parse(await readFile(path, 'utf8')));
  const inspected = await koinos(['inspect', path]);
  assert.ok(inspected.ok, inspected.stderr);
  assert.deepStrictEqual(ours, JSON.parse(inspected.stdout));
  const verified = await koinos(['verify', path, ours.head, ours.project.id]);
  assert.ok(verified.ok, verified.stderr);
  assert.deepStrictEqual(JSON.parse(verified.stdout), { valid: true, head: ours.head, count: ours.count });
});

test('an eight-record lifecycle made by createRecord passes Koinos import, verify and inspect', async (t) => {
  if (!(await requireKoinos(t))) return;
  const s = new Story();
  await s.add('ada', 'project.created', genesisBody());
  const a = (await s.add('ada', 'agreement.proposed', proposalBody())).id;
  await s.add('ada', 'agreement.consented', { agreement: a });
  await s.add('ben', 'agreement.consented', { agreement: a });
  const d = (await s.add('ben', 'delegation.granted', grantBody(a))).id;
  const c = (await s.add('scribe', 'contribution.submitted', submitBody(a, d))).id;
  const r = (await s.add('ada', 'contribution.reviewed', reviewBody(c))).id;
  await s.add('ada', 'contribution.accepted', { contribution: c, review: r });
  assert.equal(s.records.length, 8);
  await crossCheck(s.records);
});

test('a history using every record kind derives the same state in both implementations', async (t) => {
  if (!(await requireKoinos(t))) return;
  const s = new Story();
  await s.add('ada', 'project.created', genesisBody(['ada', 'ben', 'scribe', 'helper']));
  const a = (await s.add('ada', 'agreement.proposed', proposalBody())).id;
  await s.add('ada', 'agreement.consented', { agreement: a });
  await s.add('ben', 'agreement.consented', { agreement: a });
  await s.add('ada', 'agreement.withdrawn', { agreement: a, reason: 'Reading the charter again' });
  await s.add('ada', 'agreement.consented', { agreement: a });
  const d = (await s.add('ben', 'delegation.granted', grantBody(a))).id;
  const helperGrant = (await s.add('ada', 'delegation.granted', grantBody(a, { agent: id('helper') }))).id;
  const c1 = (await s.add('scribe', 'contribution.submitted', submitBody(a, d))).id;
  const c2 = (await s.add('ben', 'contribution.submitted', submitBody(a, null, { title: 'Docs' }))).id;
  await s.add('ada', 'contribution.reviewed', reviewBody(c1, 'request_changes', 'Handle zero quantities.'));
  const r1 = (await s.add('ada', 'contribution.reviewed', reviewBody(c1, 'approve', 'Fixed.'))).id;
  await s.add('ada', 'contribution.accepted', { contribution: c1, review: r1 });
  await s.add('ben', 'contribution.disputed', { contribution: c1, reason: 'Attribution note missing' });
  await s.add('ada', 'delegation.revoked', { delegation: helperGrant, reason: 'Not needed' });
  const r2 = (await s.add('ada', 'contribution.reviewed', reviewBody(c2))).id;
  await s.add('ada', 'contribution.accepted', { contribution: c2, review: r2 });
  const b = (await s.add('ada', 'agreement.proposed', proposalBody(['ben']))).id;
  await s.add('ben', 'agreement.consented', { agreement: b });
  await crossCheck(s.records);
});

// Known divergences where the Koinos reference accepts a bundle Exofab rejects
// on purpose. Exofab's rejection is always asserted. While Koinos still accepts,
// its half is reported as TODO with this reason, in full, without failing the
// run; once upstream rejects, the case passes normally and the entry can go.
const KNOWN_UPSTREAM = {};

// name -> [expected Exofab error code, builder]. A builder returns {bundle, pins?};
// pins go to both verifiers. The code shows the intended rule is what fails.
const MUTATIONS = {
  'bad signature': ['signature', async () => {
    const bundle = await acceptedBundle();
    bundle.records[1].signature = bundle.records[2].signature;
    return { bundle };
  }],
  'changed signed body': ['id', async () => {
    const bundle = await acceptedBundle();
    bundle.records[0].body.title = 'Tampered';
    return { bundle };
  }],
  'reordered records': ['chain', async () => {
    const bundle = await acceptedBundle();
    [bundle.records[2], bundle.records[3]] = [bundle.records[3], bundle.records[2]];
    return { bundle };
  }],
  'unsupported bundle format': ['format', async () => ({ bundle: { ...(await acceptedBundle()), format: 'koinos-bundle/0.2' } })],
  'unknown record field': ['envelope', async () => {
    const bundle = await acceptedBundle();
    bundle.records[0].extra = true;
    return { bundle };
  }],
  'unknown bundle field': ['format', async () => ({ bundle: { ...(await acceptedBundle()), extra: 1 } })],
  'wrong protocol, correctly signed': ['envelope', async () => {
    const raw = new Raw();
    await raw.add('ada', 'project.created', genesisBody(), { protocol: 'koinos/0.2' });
    return { bundle: raw.bundle() };
  }],
  'reviewer is the principal': ['authority', async () => {
    const raw = new Raw();
    const { c } = await submitted(raw);
    await raw.add('ben', 'contribution.reviewed', reviewBody(c));
    return { bundle: raw.bundle() };
  }],
  'acceptance after the grant was revoked': ['authority', async () => {
    const raw = new Raw();
    const { c, d } = await submitted(raw);
    const r = (await raw.add('ada', 'contribution.reviewed', reviewBody(c))).id;
    await raw.add('ben', 'delegation.revoked', { delegation: d, reason: 'Stop' });
    await raw.add('ada', 'contribution.accepted', { contribution: c, review: r });
    return { bundle: raw.bundle() };
  }],
  'submission at the grant expiry instant': ['authority', async () => {
    const raw = new Raw();
    // Records are one second apart; the submission is record 5.
    await submitted(raw, { expires: new Date(BASE + 5000).toISOString() });
    return { bundle: raw.bundle() };
  }],
  'non-canonical time, correctly signed': ['time', async () => {
    const raw = new Raw();
    await raw.add('ada', 'project.created', genesisBody());
    await raw.add('ada', 'agreement.proposed', proposalBody(), { time: '2026-10-29T00:00:01Z' });
    return { bundle: raw.bundle() };
  }],
  'duplicate active consent': ['state', async () => {
    const raw = new Raw();
    const { a } = await consented(raw, { grant: false });
    await raw.add('ada', 'agreement.consented', { agreement: a });
    return { bundle: raw.bundle() };
  }],
  'truncated history against a head pin': ['pin', async () => {
    const bundle = await acceptedBundle();
    const head = bundle.records.at(-1).id;
    bundle.records.pop();
    return { bundle, pins: { expectedHead: head } };
  }],
  'wrong project pin': ['pin', async () => {
    const bundle = await acceptedBundle();
    return { bundle, pins: { expectedHead: bundle.records.at(-1).id, expectedProject: OTHER_PROJECT } };
  }],
  'agent consents': ['authority', async () => {
    const raw = new Raw();
    const { a } = await consented(raw, { grant: false });
    await raw.add('scribe', 'agreement.consented', { agreement: a });
    return { bundle: raw.bundle() };
  }],
  'acceptance cites a superseded review': ['state', async () => {
    const raw = new Raw();
    const { c } = await submitted(raw);
    const first = (await raw.add('ada', 'contribution.reviewed', reviewBody(c))).id;
    await raw.add('ada', 'contribution.reviewed', reviewBody(c, 'request_changes', 'One more fix.'));
    await raw.add('ada', 'contribution.accepted', { contribution: c, review: first });
    return { bundle: raw.bundle() };
  }],
  'human submission with a delegation': ['field', async () => {
    const raw = new Raw();
    const { a, d } = await consented(raw);
    await raw.add('ben', 'contribution.submitted', submitBody(a, d));
    return { bundle: raw.bundle() };
  }],
  'time moves backwards': ['time', async () => {
    const raw = new Raw();
    await raw.add('ada', 'project.created', genesisBody(), { time: '2026-10-29T00:00:10.000Z' });
    await raw.add('ada', 'agreement.proposed', proposalBody(), { time: '2026-10-29T00:00:09.999Z' });
    return { bundle: raw.bundle() };
  }],
  'non-steward proposes an agreement': ['authority', async () => {
    const raw = new Raw();
    await raw.add('ada', 'project.created', genesisBody());
    await raw.add('ben', 'agreement.proposed', proposalBody(['ben']));
    return { bundle: raw.bundle() };
  }],
  'record from another project': ['project', async () => {
    const raw = new Raw();
    await raw.add('ada', 'project.created', genesisBody());
    await raw.add('ada', 'agreement.proposed', proposalBody(), { project: OTHER_PROJECT });
    return { bundle: raw.bundle() };
  }],
  'dispute of a contribution that is not accepted': ['state', async () => {
    const raw = new Raw();
    const { c } = await submitted(raw);
    await raw.add('ben', 'contribution.disputed', { contribution: c, reason: 'Premature' });
    return { bundle: raw.bundle() };
  }],
  'delegation with an extra scope': ['field', async () => {
    const raw = new Raw();
    const { a } = await consented(raw, { grant: false });
    await raw.add('ben', 'delegation.granted', grantBody(a, { scope: ['contribution.submit', 'contribution.review'] }));
    return { bundle: raw.bundle() };
  }],
  'padded signature encoding': ['signature', async () => {
    const bundle = await acceptedBundle();
    bundle.records[0].signature += '==';
    return { bundle };
  }],
};

test('mutated bundles are rejected by both implementations', async (t) => {
  if (!(await requireKoinos(t))) return;
  // Control: the unmutated history is accepted by both, so each rejection below is meaningful.
  const control = await acceptedBundle();
  const state = await verifyBundle(control);
  await withTemp(async (dir) => {
    const file = join(dir, 'control.json');
    await writeFile(file, JSON.stringify(control));
    const result = await koinos(['verify', file, state.head, state.project.id], dir);
    assert.ok(result.ok, `Koinos rejected the control bundle: ${result.stderr}`);
  });
  assert.ok(Object.keys(MUTATIONS).length >= 12);
  for (const name of Object.keys(KNOWN_UPSTREAM)) assert.ok(Object.hasOwn(MUTATIONS, name), `KNOWN_UPSTREAM names no mutation: ${name}`);
  for (const [name, [code, build]] of Object.entries(MUTATIONS)) {
    await t.test(name, async (st) => {
      const { bundle, pins = {} } = await build();
      await assert.rejects(verifyBundle(bundle, pins), (error) => {
        assert.ok(error instanceof KoinosError, `Exofab accepted the mutated bundle: ${name}`);
        assert.equal(error.code, code, error.message);
        return true;
      });
      await withTemp(async (dir) => {
        const file = join(dir, 'mutated.json');
        await writeFile(file, JSON.stringify(bundle));
        const args = ['verify', file];
        if (pins.expectedHead !== undefined) args.push(pins.expectedHead);
        if (pins.expectedProject !== undefined) args.push(pins.expectedProject);
        const result = await koinos(args, dir);
        if (result.ok && Object.hasOwn(KNOWN_UPSTREAM, name)) st.todo(KNOWN_UPSTREAM[name]);
        assert.equal(result.ok, false, `The Koinos reference accepted the mutated bundle: ${name}`);
      });
    });
  }
});
