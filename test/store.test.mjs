// Tests for the hub file store in src/hub/store.mjs. Every test works in its
// own temporary directory and removes it afterwards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir, stat, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore, StoreError, atomicWrite, eventHash, HUB_FORMAT, CREDENTIALS_FORMAT } from '../src/hub/store.mjs';
import { generateIdentity, createRecord, BUNDLE_FORMAT, sha256Hex, canonicalize } from '../src/koinos/index.mjs';

const T0 = '2026-10-31T12:00:00.000Z';
const PID = '6f1c2a4e-8b3d-4c5e-9a7b-1d2e3f4a5b6c';

async function tempStore(t) {
  const dir = await mkdtemp(join(tmpdir(), 'exofab-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new FileStore(join(dir, 'data'));
  await store.init();
  return { store, data: join(dir, 'data') };
}

const refuses = (promise, code) => assert.rejects(promise, (error) => error instanceof StoreError && error.code === code);

// A small valid Koinos history (genesis plus one agreement) for bundle tests.
const ada = await generateIdentity();
const ben = await generateIdentity();
const records = [];
records.push(
  await createRecord({
    records,
    identity: ada,
    kind: 'project.created',
    project: PID,
    time: T0,
    body: {
      title: 'Recipe scaling skill',
      description: 'Synthetic test project.',
      participants: [
        { id: ada.id, name: 'Ada', kind: 'human' },
        { id: ben.id, name: 'Ben', kind: 'human' },
      ],
    },
  }),
);
const DIGEST = await sha256Hex('terms');
for (const title of ['Charter', 'Charter v2']) {
  records.push(
    await createRecord({
      records,
      identity: ada,
      kind: 'agreement.proposed',
      time: T0,
      body: { title, uri: `urn:example:${title.length}`, digest: DIGEST, parties: [ada.id, ben.id] },
    }),
  );
}
const bundleOf = (n) => ({ format: BUNDLE_FORMAT, records: records.slice(0, n) });

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    out.push({ path, dir: entry.isDirectory() });
    if (entry.isDirectory()) out.push(...(await walk(path)));
  }
  return out;
}

test('init creates the layout with owner-only permissions and is idempotent', async (t) => {
  const { store, data } = await tempStore(t);
  assert.equal((await stat(data)).mode & 0o777, 0o700);
  for (const d of ['projects', 'blobs']) assert.equal((await stat(join(data, d))).mode & 0o777, 0o700);
  assert.deepEqual(JSON.parse(await readFile(join(data, 'hub.json'), 'utf8')), { format: HUB_FORMAT, events: [] });
  assert.deepEqual(JSON.parse(await readFile(join(data, 'credentials.json'), 'utf8')), { format: CREDENTIALS_FORMAT, tokens: {} });
  assert.deepEqual(JSON.parse(await readFile(join(data, 'pins.json'), 'utf8')), {});
  await store.appendHubEvent({ time: T0, author: ada.id, type: 'person.registered', body: { id: ada.id, name: 'Ada' } });
  await store.init(); // must not reset existing files
  assert.equal((await store.readHubEvents()).length, 1);
});

test('every file the store writes is mode 0600 and no temporary file is left behind', async (t) => {
  const { store, data } = await tempStore(t);
  await store.appendHubEvent({ time: T0, author: ada.id, type: 'person.registered', body: { id: ada.id, name: 'Ada' } });
  await store.putCredential(await sha256Hex('token'), { id: ada.id, kind: 'human' });
  await store.writeBundle(PID, bundleOf(2));
  await store.writePin(PID, records[1].id);
  const { digest } = await store.putBlob(new TextEncoder().encode('terms'));
  await store.linkBlob(PID, digest);
  const entries = await walk(data);
  assert.equal(entries.length, 8);
  for (const { path, dir } of entries) {
    assert.ok(!path.endsWith('.tmp'), `leftover temporary file ${path}`);
    assert.equal((await stat(path)).mode & 0o777, dir ? 0o700 : 0o600, path);
  }
});

test('hub events form a verified hash chain', async (t) => {
  const { store } = await tempStore(t);
  const first = await store.appendHubEvent({ time: T0, author: ada.id, type: 'person.registered', body: { id: ada.id, name: 'Ada' } });
  const second = await store.appendHubEvent({ time: T0, author: null, type: 'note.added', body: { list: [1, 'two', null] } });
  assert.equal(first.seq, 0);
  assert.equal(first.prev, null);
  assert.equal(first.hash, await sha256Hex(canonicalize({ seq: 0, prev: null, time: T0, author: ada.id, type: 'person.registered', body: { id: ada.id, name: 'Ada' } })));
  assert.equal(second.seq, 1);
  assert.equal(second.prev, first.hash);
  assert.equal(second.hash, await eventHash(second));
  assert.deepEqual(await store.readHubEvents(), [first, second]);
  // A fresh store over the same directory verifies from disk.
  assert.deepEqual(await new FileStore(store.dir).readHubEvents(), [first, second]);
});

test('appendHubEvent validates its input before writing', async (t) => {
  const { store } = await tempStore(t);
  await refuses(store.appendHubEvent({ time: '2026-10-31T12:00:00Z', author: null, type: 'a.b', body: {} }), 'invalid');
  await refuses(store.appendHubEvent({ time: T0, author: '', type: 'a.b', body: {} }), 'invalid');
  await refuses(store.appendHubEvent({ time: T0, author: null, type: 'NoDot', body: {} }), 'invalid');
  await refuses(store.appendHubEvent({ time: T0, author: null, type: 'a.b', body: [] }), 'invalid');
  // Values that are not canonical JSON are refused and nothing is written.
  await assert.rejects(store.appendHubEvent({ time: T0, author: null, type: 'a.b', body: { n: 1.5 } }));
  assert.deepEqual(await store.readHubEvents(), []);
});

test('concurrent appends are serialized into one unbroken chain', async (t) => {
  const { store } = await tempStore(t);
  const events = await Promise.all(
    Array.from({ length: 25 }, (_, i) => store.appendHubEvent({ time: T0, author: null, type: 'test.event', body: { i } })),
  );
  assert.deepEqual(events.map((e) => e.seq).sort((a, b) => a - b), [...Array(25).keys()]);
  const stored = await new FileStore(store.dir).readHubEvents();
  assert.equal(stored.length, 25);
  stored.forEach((e, i) => assert.equal(e.prev, i === 0 ? null : stored[i - 1].hash));
});

test('a tampered hub log fails closed with hub-chain', async (t) => {
  const tampers = {
    'edited body': (doc) => {
      doc.events[1].body.name = 'Mallory';
    },
    'edited hash': (doc) => {
      doc.events[1].hash = '0'.repeat(64);
    },
    'rehashed event that breaks the next link': async (doc) => {
      doc.events[1].body.name = 'Mallory';
      doc.events[1].hash = await eventHash(doc.events[1]);
    },
    'removed middle event': (doc) => {
      doc.events.splice(1, 1);
    },
    'reordered events': (doc) => {
      [doc.events[0], doc.events[1]] = [doc.events[1], doc.events[0]];
    },
    'edited sequence': (doc) => {
      doc.events[2].seq = 7;
    },
    'extra field': (doc) => {
      doc.events[0].extra = true;
    },
    'missing field': (doc) => {
      delete doc.events[0].author;
    },
    'bad time': (doc) => {
      doc.events[0].time = 'yesterday';
    },
    'wrong format': (doc) => {
      doc.format = 'other/1';
    },
    'events not a list': (doc) => {
      doc.events = {};
    },
  };
  for (const [name, tamper] of Object.entries(tampers)) {
    const { store, data } = await tempStore(t);
    for (const n of ['Ada', 'Ben', 'Ada again']) {
      await store.appendHubEvent({ time: T0, author: ada.id, type: 'profile.updated', body: { name: n } });
    }
    const path = join(data, 'hub.json');
    const doc = JSON.parse(await readFile(path, 'utf8'));
    await tamper(doc);
    await writeFile(path, JSON.stringify(doc));
    await refuses(new FileStore(data).readHubEvents(), 'hub-chain').catch((e) => assert.fail(`${name}: ${e.message}`));
    // The same store instance notices the change on disk too.
    await refuses(store.readHubEvents(), 'hub-chain');
    await refuses(store.appendHubEvent({ time: T0, author: null, type: 'a.b', body: {} }), 'hub-chain');
  }
});

test('hub log parsing is strict: duplicate keys, a BOM, or a missing file fail closed', async (t) => {
  const { store, data } = await tempStore(t);
  const path = join(data, 'hub.json');
  await writeFile(path, `{"format":"${HUB_FORMAT}","events":[],"events":[]}`);
  await refuses(store.readHubEvents(), 'hub-chain');
  await writeFile(path, `﻿{"format":"${HUB_FORMAT}","events":[]}`);
  await refuses(store.readHubEvents(), 'hub-chain');
  await rm(path);
  await refuses(store.readHubEvents(), 'hub-chain');
});

test('writeBundle stores canonical JSON and accepts only exact extensions', async (t) => {
  const { store, data } = await tempStore(t);
  assert.equal(await store.readBundle(PID), null);
  await store.writeBundle(PID, bundleOf(1));
  assert.equal(await readFile(join(data, 'projects', `${PID}.json`), 'utf8'), `${canonicalize(bundleOf(1))}\n`);
  await store.writeBundle(PID, bundleOf(2));
  await store.writeBundle(PID, bundleOf(2)); // an identical history is a no-op
  assert.deepEqual(await store.readBundle(PID), bundleOf(2));
  assert.deepEqual(await store.listProjects(), [PID]);

  await refuses(store.writeBundle(PID, bundleOf(1)), 'diverged');
  const forked = structuredClone(bundleOf(3));
  forked.records[1] = { ...forked.records[2], sequence: 1 };
  await refuses(store.writeBundle(PID, forked), 'diverged');
  const edited = structuredClone(bundleOf(3));
  edited.records[1].body.title = 'Changed';
  await refuses(store.writeBundle(PID, edited), 'diverged');
  assert.deepEqual(await store.readBundle(PID), bundleOf(2));
  await store.writeBundle(PID, bundleOf(3));
  assert.equal((await store.readBundle(PID)).records.length, 3);
});

test('writeBundle validates structure, project ids, and canonical form', async (t) => {
  const { store } = await tempStore(t);
  await refuses(store.writeBundle(PID, { format: 'other', records: records.slice(0, 1) }), 'invalid');
  await refuses(store.writeBundle(PID, { format: BUNDLE_FORMAT, records: [] }), 'invalid');
  await refuses(store.writeBundle(PID, { format: BUNDLE_FORMAT, records: records.slice(0, 1), extra: 1 }), 'invalid');
  await refuses(store.writeBundle(PID, { format: BUNDLE_FORMAT, records: [{ id: 'nope' }] }), 'invalid');
  await refuses(store.writeBundle(PID, { format: BUNDLE_FORMAT, records: [{ ...records[0], extra: 0.5 }] }), 'invalid');
  const other = '0f1c2a4e-8b3d-4c5e-9a7b-1d2e3f4a5b6c';
  await refuses(store.writeBundle(other, bundleOf(1)), 'invalid');
  for (const pid of ['../escape', `${PID}/../x`, PID.toUpperCase(), '', 'not-a-uuid', `${PID}.json`, null]) {
    await refuses(store.writeBundle(pid, bundleOf(1)), 'invalid');
    await refuses(store.readBundle(pid), 'invalid');
    await refuses(store.writePin(pid, records[0].id), 'invalid');
    await refuses(store.linkBlob(pid, DIGEST), 'invalid');
  }
});

test('pins move only forward and a stored history must extend the pin', async (t) => {
  const { store, data } = await tempStore(t);
  await refuses(store.writePin(PID, records[0].id), 'invalid'); // nothing stored yet
  await store.writeBundle(PID, bundleOf(3));
  await store.writePin(PID, records[1].id);
  assert.deepEqual(await store.readPins(), { [PID]: records[1].id });
  await refuses(store.writePin(PID, records[0].id), 'pin'); // rollback
  await refuses(store.writePin(PID, 'a'.repeat(64)), 'pin'); // not in the history
  await refuses(store.writePin(PID, 'A'.repeat(64)), 'invalid');
  await store.writePin(PID, records[1].id); // same head is fine
  await store.writePin(PID, records[2].id);
  assert.deepEqual(await store.readPins(), { [PID]: records[2].id });

  // Replacing the stored file with an older history is detected on read.
  const path = join(data, 'projects', `${PID}.json`);
  await writeFile(path, canonicalize(bundleOf(2)));
  await refuses(store.readBundle(PID), 'pin');
  await refuses(store.writeBundle(PID, bundleOf(2)), 'pin');
  // Deleting it is detected too, and the project is still listed.
  await rm(path);
  assert.deepEqual(await store.listProjects(), [PID]);
  await refuses(store.readBundle(PID), 'pin');
  await refuses(store.writeBundle(PID, bundleOf(1)), 'pin');
});

test('stored bundles and pins are parsed strictly', async (t) => {
  const { store, data } = await tempStore(t);
  await store.writeBundle(PID, bundleOf(1));
  const path = join(data, 'projects', `${PID}.json`);
  const text = canonicalize(bundleOf(1));
  await writeFile(path, text.replace('{"format"', '{"format":"x","format"'));
  await refuses(store.readBundle(PID), 'corrupt');
  await writeFile(path, `${text}trailing`);
  await refuses(store.readBundle(PID), 'corrupt');
  await writeFile(path, text);
  assert.equal((await store.readBundle(PID)).records.length, 1);
  await writeFile(join(data, 'pins.json'), JSON.stringify({ [PID]: 'not-a-hash' }));
  await refuses(store.readPins(), 'corrupt');
  await refuses(store.readBundle(PID), 'corrupt');
});

test('blobs are content addressed, verified on read, and digests are validated', async (t) => {
  const { store, data } = await tempStore(t);
  const bytes = new TextEncoder().encode('Charter text\n');
  const { digest, size } = await store.putBlob(bytes);
  assert.equal(digest, await sha256Hex(bytes));
  assert.equal(size, bytes.length);
  assert.deepEqual(await store.getBlob(digest), bytes);
  assert.deepEqual(await store.putBlob(bytes), { digest, size }); // idempotent
  assert.equal(await store.getBlob('0'.repeat(64)), null);
  for (const bad of ['../hub.json', '../../etc/passwd', digest.toUpperCase(), digest.slice(1), `${digest}0`, `${digest.slice(0, 62)}/x`, '', null, 42]) {
    await refuses(store.getBlob(bad), 'invalid');
  }
  await refuses(store.putBlob('text'), 'invalid');
  // Bytes changed on disk are refused rather than served.
  await writeFile(join(data, 'blobs', digest), 'tampered');
  await refuses(store.getBlob(digest), 'corrupt');
});

test('a symbolic link planted in the blob directory is not followed', async (t) => {
  const { store, data } = await tempStore(t);
  const digest = await sha256Hex('x');
  await symlink(join(data, 'hub.json'), join(data, 'blobs', digest));
  await refuses(store.getBlob(digest), 'corrupt');
});

test('project blob lists record which bytes were stored for a project', async (t) => {
  const { store } = await tempStore(t);
  assert.deepEqual(await store.readProjectBlobs(PID), []);
  const a = await sha256Hex('a');
  const b = await sha256Hex('b');
  await store.linkBlob(PID, b);
  await store.linkBlob(PID, a);
  await store.linkBlob(PID, b);
  assert.deepEqual(await store.readProjectBlobs(PID), [a, b].sort());
  await refuses(store.linkBlob(PID, 'xyz'), 'invalid');
  // The blob list file is not mistaken for a project.
  assert.deepEqual(await store.listProjects(), []);
});

test('credentials store token hashes only, once each', async (t) => {
  const { store } = await tempStore(t);
  const hash = await sha256Hex('exf_example');
  await store.putCredential(hash, { id: ada.id, kind: 'human' });
  assert.deepEqual((await store.readCredentials()).tokens, { [hash]: { id: ada.id, kind: 'human' } });
  await refuses(store.putCredential(hash, { id: ben.id, kind: 'human' }), 'exists');
  await refuses(store.putCredential('exf_example', { id: ada.id, kind: 'human' }), 'invalid');
  await refuses(store.putCredential(await sha256Hex('x'), { id: ada.id, kind: 'admin' }), 'invalid');
  await refuses(store.putCredential(await sha256Hex('x'), { id: '', kind: 'agent' }), 'invalid');
});

test('atomicWrite cleans up its temporary file when the rename fails', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'exofab-atomic-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const target = join(dir, 'target');
  await mkdir(join(target, 'inside'), { recursive: true });
  await assert.rejects(atomicWrite(target, 'data'));
  assert.deepEqual(await readdir(dir), ['target']);
  assert.ok((await stat(target)).isDirectory());
  await assert.rejects(atomicWrite(join(dir, 'missing', 'file'), 'data'));
  await atomicWrite(join(dir, 'ok'), 'first');
  await atomicWrite(join(dir, 'ok'), 'second');
  assert.equal(await readFile(join(dir, 'ok'), 'utf8'), 'second');
  assert.deepEqual((await readdir(dir)).sort(), ['ok', 'target']);
});

test('a failed write leaves the previous file intact', async (t) => {
  const { store, data } = await tempStore(t);
  await store.writeBundle(PID, bundleOf(2));
  const before = await readFile(join(data, 'projects', `${PID}.json`), 'utf8');
  await refuses(store.writeBundle(PID, bundleOf(1)), 'diverged');
  await assert.rejects(store.writeBundle(PID, { format: BUNDLE_FORMAT, records: [...records.slice(0, 2), { ...records[2], bad: 1.5 }] }));
  assert.equal(await readFile(join(data, 'projects', `${PID}.json`), 'utf8'), before);
  assert.ok(!(await readdir(join(data, 'projects'))).some((n) => n.endsWith('.tmp')));
});

test('oversized files are refused before parsing', async (t) => {
  const { store, data } = await tempStore(t);
  await writeFile(join(data, 'pins.json'), `{}${' '.repeat(4 * 1024 * 1024)}`);
  await refuses(store.readPins(), 'corrupt');
});

test('a write that would pass a file’s read cap is refused before writing, so the store still loads', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'exofab-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const limits = { hubBytes: 4096, credentialsBytes: 1024, projectBlobsBytes: 512 };
  const store = new FileStore(dir, { limits });
  await store.init();
  const fillUntilFull = async (write) => {
    let written = 0;
    await assert.rejects(async () => {
      for (;;) {
        await write(written);
        written++;
      }
    }, (error) => error instanceof StoreError && error.code === 'full');
    assert.ok(written > 0);
    return written;
  };

  // Hub log: the refused append changes nothing, and the log still verifies and loads.
  const events = await fillUntilFull(() => store.appendHubEvent({ time: T0, author: null, type: 'test.filler', body: { text: 'x'.repeat(300) } }));
  const hubBefore = await readFile(join(dir, 'hub.json'));
  assert.ok(hubBefore.length <= limits.hubBytes);
  await refuses(store.appendHubEvent({ time: T0, author: null, type: 'test.filler', body: { text: 'x'.repeat(300) } }), 'full');
  assert.deepEqual(await readFile(join(dir, 'hub.json')), hubBefore);
  const reopened = new FileStore(dir, { limits });
  assert.equal((await reopened.readHubEvents()).length, events);

  // Credentials and a project's blob list behave the same way.
  const tokens = await fillUntilFull(async (i) => store.putCredential(await sha256Hex(`token ${i}`), { id: ada.id, kind: 'human' }));
  assert.equal(Object.keys((await reopened.readCredentials()).tokens).length, tokens);
  const linked = await fillUntilFull(async (i) => store.linkBlob(PID, await sha256Hex(`blob ${i}`)));
  assert.equal((await reopened.readProjectBlobs(PID)).length, linked);
  assert.ok(!(await readdir(dir)).some((n) => n.endsWith('.tmp')));
});
