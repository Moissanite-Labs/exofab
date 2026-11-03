// Tests for the hub rules in src/hub/hub.mjs: the first-slice journey with
// synthetic people Ada and Ben and Ben's agent scribe, plus a refusal test for
// every hub policy and authority rule. Each test uses its own temporary data
// directory and an injected clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hub, HubError, HUB_LIMITS, TOKEN_PATTERN, DELEGATION_EXPIRED, personProofText, agentProofText } from '../src/hub/hub.mjs';
import { FileStore, StoreError } from '../src/hub/store.mjs';
import {
  BUNDLE_FORMAT,
  generateIdentity,
  signText,
  draftRecord,
  signDraft,
  checkDraft,
  createRecord,
  verifyBundle,
  exportPkcs8Pem,
  sha256Hex,
  niUri,
  utf8,
  fromUtf8,
  hex,
  b64url,
  fromBase64Canonical,
  base64,
} from '../src/koinos/index.mjs';

const T0 = Date.parse('2026-10-31T12:00:00.000Z');
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const CHARTER = 'Charter (synthetic)\nScope: a recipe-scaling skill for Exo.\nDone when: tests pass and Ada approves.\nCredit: recorded for the submitter and principal.\nThis record creates no economic right.\n';
const ARTIFACT = 'recipe-scaling skill v1 (synthetic)\ntests: 12 passed\n';
const BRIEF = Object.freeze({
  title: 'Recipe scaling skill for Exo',
  summary: 'A skill that scales home-baking recipes up and down, with tests. Synthetic demonstration brief.',
  compensation: 'No payment is offered. Accepted work is recorded as credit for the team.',
  roles: [{ title: 'Skill builder', skills: ['exo-skills', 'testing'], commitment: 'A few evenings' }],
  listed: true,
});
const BEN_PROFILE = Object.freeze({ headline: 'Builds Exo skills', skills: ['exo-skills', 'testing'], seeking: ['Small skill projects'], listed: true });

// --- Harness --------------------------------------------------------------------------

const refuses = (promise, code, details = {}) =>
  assert.rejects(promise, (error) => {
    assert.ok(error instanceof HubError, `expected HubError ${code}, got ${error?.name}: ${error?.message}`);
    assert.equal(error.code, code, error.message);
    for (const [key, value] of Object.entries(details)) assert.equal(error[key], value, `${key}: ${error.message}`);
    return true;
  });

async function world(t) {
  const dir = await mkdtemp(join(tmpdir(), 'exofab-hub-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const w = { dir, now: T0 };
  w.clock = () => new Date(w.now);
  w.iso = (offset = 0) => new Date(w.now + offset).toISOString();
  w.tick = (ms = 1000) => {
    w.now += ms;
  };
  w.store = new FileStore(dir);
  w.hub = new Hub({ store: w.store, clock: w.clock });
  return w;
}

async function registerPerson(w, name, { identity, extractable = false } = {}) {
  identity ??= await generateIdentity({ extractable });
  const { nonce } = await w.hub.challenge();
  const signature = await signText(identity.privateKey, personProofText(nonce, identity.id));
  const { person, token } = await w.hub.registerPerson({ name, key: identity.id, nonce, signature });
  return { identity, id: identity.id, person, token, auth: await w.hub.authenticate(token) };
}

async function registerAgent(w, principal, name) {
  const identity = await generateIdentity();
  const { nonce } = await w.hub.challenge();
  const signature = await signText(identity.privateKey, agentProofText(nonce, identity.id, principal.id));
  const { agent, token } = await w.hub.registerAgent(principal.auth, { name, key: identity.id, nonce, signature });
  return { identity, id: identity.id, agent, token, auth: await w.hub.authenticate(token) };
}

// Drafts and signs without Koinos rule checks, so refusals come from the hub.
async function sign(w, who, kind, body, { time, records, project } = {}) {
  const history = records ?? (await w.hub.getBundle(w.ada.auth, w.pid)).records;
  const draft = await draftRecord({ records: history, actor: who.id, kind, body, time: time ?? w.iso(), project });
  return signDraft(draft, who.identity.privateKey);
}

async function append(w, who, kind, body, options) {
  w.tick();
  return w.hub.appendRecord(who.auth, w.pid, await sign(w, who, kind, body, options));
}

// --- Journey steps (each builds on the previous) ------------------------------------------

async function formTeam(w, { nominate = true } = {}) {
  w.ada = await registerPerson(w, 'Ada', { extractable: true });
  w.ben = await registerPerson(w, 'Ben');
  w.benProfile = await w.hub.updateProfile(w.ben.auth, BEN_PROFILE);
  w.scribe = await registerAgent(w, w.ben, 'scribe');
  w.brief = await w.hub.publishBrief(w.ada.auth, BRIEF);
  w.suggested = await w.hub.suggestions(w.ben.auth);
  w.interest = await w.hub.expressInterest(w.ben.auth, w.brief.id, { role: 'r1', note: 'I build Exo skills and can start this week.' });
  w.decided = await w.hub.decideInterest(w.ada.auth, w.interest.id, { decision: 'accept' });
  if (nominate) await w.hub.nominateAgent(w.ben.auth, w.brief.id, { agent: w.scribe.id });
}

async function startRecord(w) {
  w.draft = await w.hub.genesisDraft(w.ada.auth, w.brief.id);
  const genesis = await sign(w, w.ada, 'project.created', w.draft.body, { records: [], project: w.draft.project });
  w.started = await w.hub.startProject(w.ada.auth, w.brief.id, genesis);
  w.pid = w.started.project;
}

async function agree(w) {
  w.terms = await w.hub.putBlob(w.ada.auth, w.pid, utf8(CHARTER));
  const proposal = { title: 'Charter', uri: w.terms.uri, digest: w.terms.digest, parties: [w.ada.id, w.ben.id] };
  w.agreement = (await append(w, w.ada, 'agreement.proposed', proposal)).head;
  await append(w, w.ada, 'agreement.consented', { agreement: w.agreement });
  await append(w, w.ben, 'agreement.consented', { agreement: w.agreement });
}

async function delegate(w) {
  w.expires = w.iso(14 * DAY);
  const grant = { agent: w.scribe.id, agreement: w.agreement, scope: ['contribution.submit'], expires: w.expires };
  w.delegation = (await append(w, w.ben, 'delegation.granted', grant)).head;
}

async function submit(w) {
  w.artifact = await w.hub.putBlob(w.scribe.auth, w.pid, utf8(ARTIFACT));
  const body = {
    title: 'Recipe scaling skill v1',
    summary: 'Scales ingredient amounts; 12 tests pass.',
    artifact: { uri: w.artifact.uri, digest: w.artifact.digest },
    agreement: w.agreement,
    delegation: w.delegation,
  };
  w.contribution = (await append(w, w.scribe, 'contribution.submitted', body)).head;
}

async function review(w) {
  const body = { contribution: w.contribution, decision: 'approve', note: 'Read the code and the tests; approved.' };
  w.review = (await append(w, w.ada, 'contribution.reviewed', body)).head;
}

async function accept(w) {
  w.accepted = await append(w, w.ada, 'contribution.accepted', { contribution: w.contribution, review: w.review });
}

const STEPS = { team: formTeam, started: startRecord, agreed: agree, delegated: delegate, submitted: submit, reviewed: review, accepted: accept };

async function setup(t, upTo, options) {
  const w = await world(t);
  const names = Object.keys(STEPS);
  for (const name of names.slice(0, names.indexOf(upTo) + 1)) await STEPS[name](w, options);
  return w;
}

async function filesUnder(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(path)));
    else out.push(path);
  }
  return out;
}

const hasNumber = (value) =>
  typeof value === 'number' || (value !== null && typeof value === 'object' && Object.values(value).some(hasNumber));

// --- The journey ----------------------------------------------------------------------------

test('the full journey: from a listed brief to an accepted contribution anyone can verify', async (t) => {
  const w = await world(t);

  // 1-2. Ada publishes a brief; Ben's declared skills make it a suggestion, with reasons.
  const ada = (w.ada = await registerPerson(w, 'Ada', { extractable: true }));
  const ben = (w.ben = await registerPerson(w, 'Ben'));
  await w.hub.updateProfile(ben.auth, BEN_PROFILE);
  const scribe = (w.scribe = await registerAgent(w, ben, 'scribe'));
  const brief = (w.brief = await w.hub.publishBrief(ada.auth, BRIEF));
  assert.equal(ada.person.kind, 'human');
  assert.equal(ada.person.listed, false); // private by default
  assert.match(ada.token, TOKEN_PATTERN);
  assert.deepEqual(ada.auth, { id: ada.id, kind: 'human' });
  assert.deepEqual(scribe.auth, { id: scribe.id, kind: 'agent', principal: ben.id });
  assert.deepEqual(scribe.agent, { id: scribe.id, kind: 'agent', name: 'scribe', principal: ben.id });
  assert.match(brief.id, /^brf_[0-9a-f]{16}$/);
  assert.equal(brief.owner, ada.id);
  assert.equal(brief.status, 'open');
  assert.equal(brief.compensation, BRIEF.compensation);
  assert.deepEqual(brief.roles, [{ id: 'r1', title: 'Skill builder', skills: ['exo-skills', 'testing'], commitment: 'A few evenings', open: true }]);
  assert.deepEqual(brief.team, { members: [ada.id], agents: [] });
  assert.equal(brief.project, null);
  assert.deepEqual(brief.interests, []);
  assert.deepEqual(await w.hub.suggestions(ben.auth), [
    {
      brief: { id: brief.id, title: BRIEF.title, summary: BRIEF.summary, owner: ada.id },
      role: { id: 'r1', title: 'Skill builder' },
      reasons: ['shared skill: exo-skills', 'shared skill: testing'],
    },
  ]);
  assert.deepEqual(await w.hub.suggestions(ada.auth), []);
  assert.deepEqual(await w.hub.briefSuggestions(ada.auth, brief.id), [
    {
      person: { id: ben.id, name: 'Ben', headline: 'Builds Exo skills' },
      role: { id: 'r1', title: 'Skill builder' },
      reasons: ['shared skill: exo-skills', 'shared skill: testing'],
    },
  ]);

  // 3. Ben expresses interest; only Ada and Ben can see it.
  const interest = await w.hub.expressInterest(ben.auth, brief.id, { role: 'r1', note: 'I build Exo skills and can start this week.' });
  assert.match(interest.id, /^int_[0-9a-f]{16}$/);
  assert.equal(interest.status, 'pending');
  assert.equal(interest.candidateName, 'Ben');
  assert.deepEqual((await w.hub.getBrief(ada.auth, brief.id)).interests.map((i) => [i.id, i.note]), [[interest.id, interest.note]]);
  assert.equal((await w.hub.getBrief(ben.auth, brief.id)).team, undefined); // not on the team yet

  // 4. Ada accepts: a double opt-in, and Ben joins the team.
  const decided = await w.hub.decideInterest(ada.auth, interest.id, { decision: 'accept' });
  assert.equal(decided.status, 'accepted');
  assert.equal(decided.decided, w.iso());
  const adaView = await w.hub.getBrief(ada.auth, brief.id);
  assert.deepEqual(adaView.team, { members: [ada.id, ben.id], agents: [] });
  assert.equal(adaView.roles[0].open, false);
  assert.deepEqual(await w.hub.briefSuggestions(ada.auth, brief.id), []); // role filled, Ben on the team
  assert.deepEqual((await w.hub.getBrief(ben.auth, brief.id)).interests.map((i) => i.status), ['accepted']);

  // 5. Ben nominates his own agent.
  const nominated = await w.hub.nominateAgent(ben.auth, brief.id, { agent: scribe.id });
  assert.deepEqual(nominated.team, { members: [ada.id, ben.id], agents: [scribe.id] });
  assert.deepEqual((await w.hub.me(ben.auth)).agents, [{ id: scribe.id, name: 'scribe' }]);

  // 6. Ada starts the record with exactly the team.
  await startRecord(w);
  assert.match(w.draft.project, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(w.draft.body, {
    title: BRIEF.title,
    description: BRIEF.summary,
    participants: [
      { id: ada.id, name: 'Ada', kind: 'human' },
      { id: ben.id, name: 'Ben', kind: 'human' },
      { id: scribe.id, name: 'scribe', kind: 'agent' },
    ],
  });
  assert.equal(w.started.count, 1);
  assert.equal(w.started.project, w.draft.project);
  assert.equal((await w.hub.getBrief(ada.auth, brief.id)).project, w.pid);
  assert.deepEqual(
    (await w.hub.listProjects(ada.auth)).map((p) => [p.project, p.brief, p.role, p.count]),
    [[w.pid, brief.id, 'steward', 1]],
  );
  assert.equal((await w.hub.listProjects(ben.auth))[0].role, 'participant');
  assert.equal((await w.hub.listProjects(scribe.auth))[0].role, 'agent');

  // 7-8. The charter bytes are stored first; each party reads the exact text and digest, then consents.
  await agree(w);
  assert.equal(w.terms.digest, await sha256Hex(CHARTER));
  assert.equal(w.terms.uri, niUri(w.terms.digest));
  assert.equal(w.terms.size, utf8(CHARTER).length);
  const charterBytes = await w.hub.getBlob(ben.auth, w.pid, w.terms.digest);
  assert.equal(fromUtf8(charterBytes), CHARTER);
  assert.equal(await sha256Hex(charterBytes), w.terms.digest);
  const consented = await w.hub.getProject(ben.auth, w.pid);
  assert.deepEqual(consented.state.agreements[0].consents, [ada.id, ben.id]);
  assert.deepEqual(consented.viewer, { id: ben.id, steward: false, party: true });

  // 9-10. Ben delegates to scribe; scribe stores the artifact and submits it.
  await delegate(w);
  await submit(w);
  const submittedState = (await w.hub.getProject(scribe.auth, w.pid)).state;
  assert.equal(submittedState.contributions[0].actor, scribe.id);
  assert.equal(submittedState.contributions[0].principal, ben.id);
  assert.deepEqual((await w.hub.getProject(scribe.auth, w.pid)).viewer, { id: scribe.id, steward: false, party: false });

  // 11-12. Ada reviews the exact artifact bytes, approves, and accepts as steward.
  assert.equal(fromUtf8(await w.hub.getBlob(ada.auth, w.pid, w.artifact.digest)), ARTIFACT);
  await review(w);
  await accept(w);
  assert.equal(w.accepted.count, 8);
  assert.equal(w.accepted.state.contributions[0].status, 'accepted');
  const project = await w.hub.getProject(ada.auth, w.pid);
  assert.deepEqual(project.viewer, { id: ada.id, steward: true, party: true });
  assert.equal(project.head, w.accepted.head);
  assert.deepEqual(project.records.map((r) => [r.kind, r.actor]), [
    ['project.created', ada.id],
    ['agreement.proposed', ada.id],
    ['agreement.consented', ada.id],
    ['agreement.consented', ben.id],
    ['delegation.granted', ben.id],
    ['contribution.submitted', scribe.id],
    ['contribution.reviewed', ada.id],
    ['contribution.accepted', ada.id],
  ]);

  // 13. The exported bundle verifies independently and pins the head; both digests match the stored bytes.
  const bundle = await w.hub.getBundle(ben.auth, w.pid);
  assert.equal(bundle.format, BUNDLE_FORMAT);
  const verified = await verifyBundle(bundle, { expectedHead: w.accepted.head, expectedProject: w.pid });
  assert.deepEqual(verified, project.state);
  assert.equal(verified.agreements[0].digest, await sha256Hex(charterBytes));
  assert.equal(verified.contributions[0].artifact.digest, await sha256Hex(utf8(ARTIFACT)));

  // 14. Credit for Ben's accepted work via scribe, visible within the team.
  const credit = await w.hub.credit(ada.auth, ben.id);
  assert.deepEqual(credit, [
    {
      project: w.pid,
      projectTitle: BRIEF.title,
      contribution: {
        id: w.contribution,
        title: 'Recipe scaling skill v1',
        summary: 'Scales ingredient amounts; 12 tests pass.',
        artifact: { uri: w.artifact.uri, digest: w.artifact.digest },
      },
      status: 'accepted',
      acceptedAt: project.records[7].time,
      via: scribe.id,
    },
  ]);
  assert.deepEqual(await w.hub.credit(ben.auth, ben.id), credit);
  assert.deepEqual(await w.hub.credit(ada.auth, ada.id), []);

  // The hub's data holds no private key and no bearer token.
  const pkcs8 = fromBase64Canonical((await exportPkcs8Pem(ada.identity.privateKey)).split('\n').slice(1, -2).join(''));
  const seed = pkcs8.subarray(pkcs8.length - 32);
  const secrets = [ada.token, ben.token, scribe.token, hex(seed), b64url(seed), base64(seed), base64(pkcs8)];
  for (const file of await filesUnder(w.dir)) {
    const content = await readFile(file, 'latin1');
    assert.ok(!content.includes('PRIVATE KEY'), file);
    for (const secret of secrets) assert.ok(!content.includes(secret), `${file} contains a secret`);
  }
  const { tokens } = await w.store.readCredentials();
  assert.ok(Object.hasOwn(tokens, await sha256Hex(ada.token)));

  // A restarted hub rebuilds the same state from its log, and old tokens still work.
  const again = new Hub({ store: new FileStore(w.dir), clock: w.clock });
  const benAgain = await again.authenticate(ben.token);
  assert.deepEqual(benAgain, ben.auth);
  assert.deepEqual(await again.me(benAgain), await w.hub.me(ben.auth));
  assert.deepEqual(await again.getBrief(ada.auth, brief.id), await w.hub.getBrief(ada.auth, brief.id));
  assert.deepEqual(await again.getProject(ada.auth, w.pid), project);
  assert.deepEqual(await again.credit(ada.auth, ben.id), credit);
});

// --- Registration and sessions --------------------------------------------------------------

test('registration needs a fresh, single-use challenge and proof of key possession', async (t) => {
  const w = await world(t);
  const ada = await generateIdentity();
  const proof = async (nonce, identity = ada, text = personProofText(nonce, identity.id)) => signText(identity.privateKey, text);

  const first = await w.hub.challenge();
  assert.equal(first.expires, w.iso(5 * MIN));
  await refuses(w.hub.registerPerson({ name: 'Ada', key: ada.id, nonce: first.nonce, signature: await proof(first.nonce, await generateIdentity()) }), 'unauthenticated');
  // The nonce was spent by the failed attempt.
  await refuses(w.hub.registerPerson({ name: 'Ada', key: ada.id, nonce: first.nonce, signature: await proof(first.nonce) }), 'invalid');
  await refuses(w.hub.registerPerson({ name: 'Ada', key: ada.id, nonce: 'never-issued', signature: 'x' }), 'invalid');

  // Expired after five minutes.
  const late = await w.hub.challenge();
  w.tick(5 * MIN);
  await refuses(w.hub.registerPerson({ name: 'Ada', key: ada.id, nonce: late.nonce, signature: await proof(late.nonce) }), 'invalid');

  // A proof made for agent registration does not register a person.
  const wrongText = await w.hub.challenge();
  const agentText = agentProofText(wrongText.nonce, ada.id, ada.id);
  await refuses(w.hub.registerPerson({ name: 'Ada', key: ada.id, nonce: wrongText.nonce, signature: await proof(wrongText.nonce, ada, agentText) }), 'unauthenticated');

  // Malformed inputs are refused before the challenge is spent.
  const c = await w.hub.challenge();
  const good = { name: 'Ada', key: ada.id, nonce: c.nonce, signature: await proof(c.nonce) };
  await refuses(w.hub.registerPerson({ ...good, key: 'koinos:ed25519:short' }), 'invalid');
  await refuses(w.hub.registerPerson({ ...good, name: '   ' }), 'invalid');
  await refuses(w.hub.registerPerson({ ...good, name: 'A\nda' }), 'invalid');
  await refuses(w.hub.registerPerson({ ...good, name: 'x'.repeat(257) }), 'invalid');
  await refuses(w.hub.registerPerson({ ...good, admin: true }), 'invalid');
  await refuses(w.hub.registerPerson('not an object'), 'invalid');
  const registered = await w.hub.registerPerson(good);
  assert.equal(registered.person.name, 'Ada');
  await refuses(w.hub.registerPerson(good), 'invalid'); // replay: nonce already used

  // A key registers once, as a person or as an agent.
  const again = await w.hub.challenge();
  await refuses(w.hub.registerPerson({ ...good, nonce: again.nonce, signature: await proof(again.nonce) }), 'conflict');
  const adaAuth = await w.hub.authenticate(registered.token);
  const asAgent = await w.hub.challenge();
  const agentProof = await signText(ada.privateKey, agentProofText(asAgent.nonce, ada.id, ada.id));
  await refuses(w.hub.registerAgent(adaAuth, { name: 'self', key: ada.id, nonce: asAgent.nonce, signature: agentProof }), 'conflict');
});

test('an agent proof is bound to the principal registering it', async (t) => {
  const w = await world(t);
  const ada = await registerPerson(w, 'Ada');
  const ben = await registerPerson(w, 'Ben');
  const scribe = await generateIdentity();
  const c = await w.hub.challenge();
  const forBen = await signText(scribe.privateKey, agentProofText(c.nonce, scribe.id, ben.id));
  await refuses(w.hub.registerAgent(ada.auth, { name: 'scribe', key: scribe.id, nonce: c.nonce, signature: forBen }), 'unauthenticated');
  const c2 = await w.hub.challenge();
  const asPerson = await signText(scribe.privateKey, personProofText(c2.nonce, scribe.id));
  await refuses(w.hub.registerAgent(ben.auth, { name: 'scribe', key: scribe.id, nonce: c2.nonce, signature: asPerson }), 'unauthenticated');
  await refuses(w.hub.registerAgent(null, { name: 'scribe', key: scribe.id, nonce: c2.nonce, signature: asPerson }), 'unauthenticated');
  const registered = await registerAgent(w, ben, 'scribe');
  // An agent cannot register further agents.
  const c3 = await w.hub.challenge();
  const helper = await generateIdentity();
  const helperProof = await signText(helper.privateKey, agentProofText(c3.nonce, helper.id, registered.id));
  await refuses(w.hub.registerAgent(registered.auth, { name: 'helper', key: helper.id, nonce: c3.nonce, signature: helperProof }), 'forbidden');
});

test('authority comes from the token: unknown tokens and forged auth objects are refused', async (t) => {
  const w = await world(t);
  const ben = await registerPerson(w, 'Ben');
  const scribe = await registerAgent(w, ben, 'scribe');
  for (const token of [`exf_${'A'.repeat(43)}`, 'exf_short', '', null, 42, ben.token.slice(0, -1), ` ${ben.token}`]) {
    assert.equal(await w.hub.authenticate(token), null);
  }
  await refuses(w.hub.me(null), 'unauthenticated');
  await refuses(w.hub.me({ id: 'koinos:ed25519:unknown', kind: 'human' }), 'unauthenticated');
  // Claiming another kind does not change what an identity may do.
  await refuses(w.hub.me({ id: scribe.id, kind: 'human' }), 'unauthenticated');
  await refuses(w.hub.publishBrief({ id: scribe.id, kind: 'human', principal: ben.id }, BRIEF), 'unauthenticated');
  assert.deepEqual(await w.hub.me({ id: scribe.id, kind: 'agent', principal: 'forged' }), scribe.agent);
});

test('issuing many challenges never evicts one in use; a nonce verifies only as issued, and once', async (t) => {
  const w = await world(t);
  const ada = await generateIdentity();
  const attempt = async (nonce) =>
    w.hub.registerPerson({ name: 'Ada', key: ada.id, nonce, signature: await signText(ada.privateKey, personProofText(nonce, ada.id)) });
  const mine = (await w.hub.challenge()).nonce;
  // Anyone can ask for challenges; a flood of them must not push out Ada's.
  for (let i = 0; i < 1500; i++) await w.hub.challenge();

  // An altered nonce, another spelling of the same bytes, or a nonce from another hub is refused.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const swap = (text, i, f) => text.slice(0, i) + alphabet[f(alphabet.indexOf(text[i]))] + text.slice(i + 1);
  await refuses(attempt(swap(mine, 10, (n) => (n + 1) % 64)), 'invalid');
  await refuses(attempt(swap(mine, mine.length - 1, (n) => n ^ 1)), 'invalid'); // unused low bits: same bytes, non-canonical text
  const other = await world(t);
  await refuses(attempt((await other.hub.challenge()).nonce), 'invalid');

  assert.equal((await attempt(mine)).person.name, 'Ada');
  await refuses(attempt(mine), 'invalid'); // spent
  // A restarted hub has a new key, so a challenge from before the restart is refused.
  const pending = (await w.hub.challenge()).nonce;
  const restarted = new Hub({ store: new FileStore(w.dir), clock: w.clock });
  const bob = await generateIdentity();
  await assert.rejects(
    restarted.registerPerson({ name: 'Bob', key: bob.id, nonce: pending, signature: await signText(bob.privateKey, personProofText(pending, bob.id)) }),
    (e) => e instanceof HubError && e.code === 'invalid',
  );
});

// --- Hub policy 8: agents cannot act socially ---------------------------------------------------

test('agent credentials can only read their projects, store bytes, and submit contributions', async (t) => {
  const w = await setup(t, 'agreed');
  const { scribe, brief } = w;
  const social = [
    () => w.hub.publishBrief(scribe.auth, BRIEF),
    () => w.hub.listBriefs(scribe.auth),
    () => w.hub.getBrief(scribe.auth, brief.id),
    () => w.hub.updateBrief(scribe.auth, brief.id, { status: 'closed' }),
    () => w.hub.suggestions(scribe.auth),
    () => w.hub.briefSuggestions(scribe.auth, brief.id),
    () => w.hub.expressInterest(scribe.auth, brief.id, { role: 'r1', note: 'agent' }),
    () => w.hub.withdrawInterest(scribe.auth, w.interest.id),
    () => w.hub.decideInterest(scribe.auth, w.interest.id, { decision: 'accept' }),
    () => w.hub.nominateAgent(scribe.auth, brief.id, { agent: scribe.id }),
    () => w.hub.genesisDraft(scribe.auth, brief.id),
    () => w.hub.startProject(scribe.auth, brief.id, {}),
    () => w.hub.updateProfile(scribe.auth, { name: 'scribe' }),
    () => w.hub.getPerson(scribe.auth, w.ben.id),
    () => w.hub.listPeople(scribe.auth),
    () => w.hub.credit(scribe.auth, w.ben.id),
  ];
  for (const call of social) await refuses(call(), 'forbidden');
  // Signing a social record is refused by the hub before Koinos is consulted.
  for (const [kind, body] of [
    ['agreement.consented', { agreement: w.agreement }],
    ['agreement.withdrawn', { agreement: w.agreement, reason: 'no' }],
    ['contribution.reviewed', { contribution: w.agreement, decision: 'approve', note: 'ok' }],
  ]) {
    await refuses(w.hub.appendRecord(scribe.auth, w.pid, await sign(w, scribe, kind, body)), 'forbidden');
  }
  // What an agent may do.
  assert.deepEqual(await w.hub.me(scribe.auth), scribe.agent);
  assert.equal((await w.hub.listProjects(scribe.auth)).length, 1);
  assert.equal((await w.hub.getBundle(scribe.auth, w.pid)).records.length, 4);
  assert.equal(fromUtf8(await w.hub.getBlob(scribe.auth, w.pid, w.terms.digest)), CHARTER);
  assert.equal((await w.hub.putBlob(scribe.auth, w.pid, utf8('draft'))).size, 5);
});

test('an agent keeps reading and storing in its project with no delegation or after revocation, as the browser discloses', async (t) => {
  // web/actions.mjs NOMINATION_NOTE and DELEGATION_NOTE describe this access;
  // if hub policy 8 changes, those texts must change with it.
  const w = await setup(t, 'delegated');
  await append(w, w.ben, 'delegation.revoked', { delegation: w.delegation, reason: 'Synthetic revocation.' });
  const later = await w.hub.putBlob(w.ada.auth, w.pid, utf8('Text stored after the revocation (synthetic).\n'));
  assert.equal((await w.hub.getProject(w.scribe.auth, w.pid)).state.delegations[0].revoked, true);
  assert.equal(fromUtf8(await w.hub.getBlob(w.scribe.auth, w.pid, later.digest)), 'Text stored after the revocation (synthetic).\n');
  assert.equal((await w.hub.putBlob(w.scribe.auth, w.pid, utf8('upload after revocation'))).size, 23);
});

// --- Profiles and briefs (hub policy 9) ----------------------------------------------------

test('profiles validate their fields and are visible to others only when listed', async (t) => {
  const w = await setup(t, 'team', { nominate: false });
  const outsider = await registerPerson(w, 'Outsider');
  await refuses(w.hub.updateProfile(w.ben.auth, { skills: ['Exo-Skills'] }), 'invalid');
  await refuses(w.hub.updateProfile(w.ben.auth, { skills: ['a b'] }), 'invalid');
  await refuses(w.hub.updateProfile(w.ben.auth, { skills: ['x', 'x'] }), 'invalid');
  await refuses(w.hub.updateProfile(w.ben.auth, { skills: Array.from({ length: 31 }, (_, i) => `s${i}`) }), 'invalid');
  await refuses(w.hub.updateProfile(w.ben.auth, { seeking: ['line\nbreak'] }), 'invalid');
  await refuses(w.hub.updateProfile(w.ben.auth, { listed: 'yes' }), 'invalid');
  await refuses(w.hub.updateProfile(w.ben.auth, { headline: 'h'.repeat(257) }), 'invalid');
  await refuses(w.hub.updateProfile(w.ben.auth, { email: 'x' }), 'invalid');
  await refuses(w.hub.updateProfile(w.ben.auth, {}), 'invalid');

  // Listed: anyone signed in sees the public view, without the agent list.
  const publicBen = await w.hub.getPerson(outsider.auth, w.ben.id);
  assert.deepEqual(publicBen, { id: w.ben.id, kind: 'human', ...BEN_PROFILE, name: 'Ben' });
  assert.deepEqual((await w.hub.listPeople(outsider.auth)).map((p) => p.name), ['Ben']);
  assert.deepEqual((await w.hub.getPerson(w.ben.auth, w.ben.id)).agents, [{ id: w.scribe.id, name: 'scribe' }]);

  // Unlisted: hidden from outsiders, still visible to a teammate.
  await w.hub.updateProfile(w.ben.auth, { listed: false });
  await refuses(w.hub.getPerson(outsider.auth, w.ben.id), 'not_found');
  await refuses(w.hub.getPerson(outsider.auth, w.ada.id), 'not_found');
  await refuses(w.hub.credit(outsider.auth, w.ben.id), 'not_found');
  assert.deepEqual(await w.hub.listPeople(outsider.auth), []);
  assert.equal((await w.hub.getPerson(w.ada.auth, w.ben.id)).name, 'Ben');
  assert.equal((await w.hub.getPerson(w.ben.auth, w.ada.id)).name, 'Ada');
  await refuses(w.hub.getPerson(outsider.auth, 'koinos:ed25519:nobody'), 'not_found');
});

test('briefs validate their text against Koinos limits and require a compensation statement', async (t) => {
  const w = await world(t);
  const ada = await registerPerson(w, 'Ada');
  const { compensation, ...noCompensation } = BRIEF;
  const role = BRIEF.roles[0];
  const bad = [
    noCompensation,
    { ...BRIEF, compensation: '  ' },
    { ...BRIEF, title: 't'.repeat(257) },
    { ...BRIEF, title: 'two\nlines' },
    { ...BRIEF, summary: 's'.repeat(8193) },
    { ...BRIEF, summary: 'bell \u0007' },
    { ...BRIEF, roles: [] },
    { ...BRIEF, roles: Array.from({ length: 11 }, () => role) },
    { ...BRIEF, roles: [{ ...role, skills: [] }] },
    { ...BRIEF, roles: [{ ...role, skills: ['Testing'] }] },
    { ...BRIEF, roles: [{ ...role, commitment: '' }] },
    { ...BRIEF, roles: [{ ...role, pay: 100 }] },
    { ...BRIEF, listed: 'true' },
    { ...BRIEF, owner: 'someone else' },
  ];
  for (const input of bad) await refuses(w.hub.publishBrief(ada.auth, input), 'invalid');
  const atLimits = await w.hub.publishBrief(ada.auth, { ...BRIEF, title: 't'.repeat(256), summary: 's\n'.repeat(4096) });
  assert.equal(atLimits.title.length, 256);
  const unlisted = await w.hub.publishBrief(ada.auth, { ...BRIEF, listed: undefined });
  assert.equal(unlisted.listed, false);
  assert.equal(compensation, BRIEF.compensation);
});

test('an unlisted brief is hidden from everyone but its owner, team and candidates', async (t) => {
  const w = await setup(t, 'team', { nominate: false });
  const outsider = await registerPerson(w, 'Outsider');
  await w.hub.updateProfile(outsider.auth, { skills: ['exo-skills'] });
  const hidden = await w.hub.publishBrief(w.ada.auth, { ...BRIEF, title: 'Hidden brief', listed: false });
  for (const viewer of [w.ben, outsider]) {
    assert.ok(!(await w.hub.listBriefs(viewer.auth)).some((b) => b.id === hidden.id));
    assert.ok(!(await w.hub.suggestions(viewer.auth)).some((s) => s.brief.id === hidden.id));
    await refuses(w.hub.getBrief(viewer.auth, hidden.id), 'not_found');
    await refuses(w.hub.expressInterest(viewer.auth, hidden.id, { role: 'r1' }), 'not_found');
  }
  assert.ok((await w.hub.listBriefs(w.ada.auth)).some((b) => b.id === hidden.id));
  assert.equal((await w.hub.getBrief(w.ada.auth, hidden.id)).listed, false);
  // Unlisting a brief hides it from outsiders but not from its team.
  await w.hub.updateBrief(w.ada.auth, w.brief.id, { listed: false });
  await refuses(w.hub.getBrief(outsider.auth, w.brief.id), 'not_found');
  assert.equal((await w.hub.getBrief(w.ben.auth, w.brief.id)).id, w.brief.id);
  // Outsiders see a listed brief without its team, project, or interests.
  await w.hub.updateBrief(w.ada.auth, w.brief.id, { listed: true });
  const outside = await w.hub.getBrief(outsider.auth, w.brief.id);
  assert.equal(outside.team, undefined);
  assert.equal(outside.project, undefined);
  assert.equal(outside.interests, undefined);
});

test('suggestions come from declared skills with reasons, in a neutral order, and never carry scores or rankings', async (t) => {
  const w = await world(t);
  const ada = await registerPerson(w, 'Ada');
  const ben = await registerPerson(w, 'Ben');
  assert.deepEqual(await w.hub.suggestions(ben.auth), []); // no declared skills
  await w.hub.updateProfile(ben.auth, { skills: ['exo-skills', 'testing', 'design'], listed: true });
  const one = await w.hub.publishBrief(ada.auth, { ...BRIEF, title: 'B one skill', roles: [{ title: 'Designer', skills: ['design'], commitment: 'Weekends' }] });
  const two = await w.hub.publishBrief(ada.auth, BRIEF);
  const other = await w.hub.publishBrief(ada.auth, { ...BRIEF, title: 'A one skill', roles: [{ title: 'Tester', skills: ['testing', 'rust'], commitment: 'Evenings' }] });
  await w.hub.publishBrief(ada.auth, { ...BRIEF, title: 'No overlap', roles: [{ title: 'Writer', skills: ['writing'], commitment: 'Evenings' }] });
  const closed = await w.hub.publishBrief(ada.auth, { ...BRIEF, title: 'Closed' });
  await w.hub.updateBrief(ada.auth, closed.id, { status: 'closed' });
  await w.hub.publishBrief(ben.auth, { ...BRIEF, title: 'Ben own brief' });

  // Ordered by brief title, not by how many skills are shared ("Recipe..." shares the most).
  const suggestions = await w.hub.suggestions(ben.auth);
  assert.deepEqual(suggestions.map((s) => [s.brief.id, s.role.title, s.reasons]), [
    [other.id, 'Tester', ['shared skill: testing']],
    [one.id, 'Designer', ['shared skill: design']],
    [two.id, 'Skill builder', ['shared skill: exo-skills', 'shared skill: testing']],
  ]);
  assert.ok(!hasNumber(suggestions), 'suggestions must not contain numbers');

  // A filled role is no longer suggested.
  const interest = await w.hub.expressInterest(ben.auth, other.id, { role: 'r1', note: '' });
  await w.hub.decideInterest(ada.auth, interest.id, { decision: 'accept' });
  assert.ok(!(await w.hub.suggestions(ben.auth)).some((s) => s.brief.id === other.id));

  // Owner-side suggestions: listed profiles only, owner only, by name rather than overlap.
  const aaron = await registerPerson(w, 'Aaron');
  await w.hub.updateProfile(aaron.auth, { skills: ['testing'], listed: true });
  const forOwner = await w.hub.briefSuggestions(ada.auth, two.id);
  assert.deepEqual(forOwner.map((s) => [s.person.id, s.reasons.length]), [[aaron.id, 1], [ben.id, 2]]);
  assert.ok(!hasNumber(forOwner));
  await w.hub.updateProfile(aaron.auth, { listed: false });
  await refuses(w.hub.briefSuggestions(ben.auth, two.id), 'forbidden');
  await w.hub.updateProfile(ben.auth, { listed: false });
  assert.deepEqual(await w.hub.briefSuggestions(ada.auth, two.id), []);
});

// --- Interests and teams ----------------------------------------------------------------------

test('interest is a double opt-in: only the candidate expresses or withdraws, only the owner decides', async (t) => {
  const w = await world(t);
  const ada = await registerPerson(w, 'Ada');
  const ben = await registerPerson(w, 'Ben');
  const outsider = await registerPerson(w, 'Outsider');
  const brief = await w.hub.publishBrief(ada.auth, {
    ...BRIEF,
    roles: [...BRIEF.roles, { title: 'Reviewer', skills: ['testing'], commitment: 'One evening' }],
  });
  await refuses(w.hub.expressInterest(ada.auth, brief.id, { role: 'r1' }), 'forbidden'); // own brief
  await refuses(w.hub.expressInterest(ben.auth, brief.id, { role: 'r9' }), 'invalid');
  await refuses(w.hub.expressInterest(ben.auth, brief.id, { role: 'r1', note: 'x'.repeat(8193) }), 'invalid');
  await refuses(w.hub.expressInterest(ben.auth, 'brf_0000000000000000', { role: 'r1' }), 'not_found');
  const interest = await w.hub.expressInterest(ben.auth, brief.id, { role: 'r1', note: 'Keen.' });
  assert.equal(interest.status, 'pending');
  await refuses(w.hub.expressInterest(ben.auth, brief.id, { role: 'r1', note: 'Again' }), 'conflict'); // duplicate pending

  // Visible only to the candidate and the owner.
  assert.equal((await w.hub.getBrief(outsider.auth, brief.id)).interests, undefined);
  await refuses(w.hub.withdrawInterest(outsider.auth, interest.id), 'not_found');
  await refuses(w.hub.decideInterest(outsider.auth, interest.id, { decision: 'accept' }), 'not_found');

  // The candidate cannot accept their own interest; the owner cannot withdraw it.
  await refuses(w.hub.decideInterest(ben.auth, interest.id, { decision: 'accept' }), 'forbidden');
  await refuses(w.hub.withdrawInterest(ada.auth, interest.id), 'forbidden');
  await refuses(w.hub.decideInterest(ada.auth, interest.id, { decision: 'maybe' }), 'invalid');

  const withdrawn = await w.hub.withdrawInterest(ben.auth, interest.id);
  assert.equal(withdrawn.status, 'withdrawn');
  await refuses(w.hub.withdrawInterest(ben.auth, interest.id), 'conflict');
  await refuses(w.hub.decideInterest(ada.auth, interest.id, { decision: 'accept' }), 'conflict');

  const outsiderInterest = await w.hub.expressInterest(outsider.auth, brief.id, { role: 'r2' });
  const declined = await w.hub.decideInterest(ada.auth, outsiderInterest.id, { decision: 'decline' });
  assert.equal(declined.status, 'declined');
  assert.ok(!(await w.hub.getBrief(ada.auth, brief.id)).team.members.includes(outsider.id));

  const second = await w.hub.expressInterest(ben.auth, brief.id, { role: 'r1', note: 'Back again.' });
  await w.hub.decideInterest(ada.auth, second.id, { decision: 'accept' });
  const view = await w.hub.getBrief(ada.auth, brief.id);
  assert.deepEqual(view.team.members, [ada.id, ben.id]);
  assert.deepEqual(view.interests.map((i) => i.status), ['withdrawn', 'declined', 'accepted']);
  assert.deepEqual((await w.hub.getBrief(ben.auth, brief.id)).interests.map((i) => i.status), ['withdrawn', 'accepted']);
  assert.deepEqual((await w.hub.getBrief(outsider.auth, brief.id)).interests.map((i) => i.status), ['declined']);
  // A filled role and an existing member are refused.
  await refuses(w.hub.expressInterest(outsider.auth, brief.id, { role: 'r1' }), 'conflict');
  await refuses(w.hub.expressInterest(ben.auth, brief.id, { role: 'r2' }), 'conflict');
  // A closed brief takes no new interest.
  await w.hub.updateBrief(ada.auth, brief.id, { status: 'closed' });
  await refuses(w.hub.expressInterest(outsider.auth, brief.id, { role: 'r2' }), 'conflict');
});

test('accepting is refused while the brief is closed, and once the role is filled', async (t) => {
  const w = await world(t);
  const ada = await registerPerson(w, 'Ada');
  const ben = await registerPerson(w, 'Ben');
  const cat = await registerPerson(w, 'Cat');
  const brief = await w.hub.publishBrief(ada.auth, BRIEF);
  const fromBen = await w.hub.expressInterest(ben.auth, brief.id, { role: 'r1', note: 'Keen.' });
  const fromCat = await w.hub.expressInterest(cat.auth, brief.id, { role: 'r1', note: 'Also keen.' });
  const refusedWith = (promise, pattern) => assert.rejects(promise, (e) => e instanceof HubError && e.code === 'conflict' && pattern.test(e.message));

  await w.hub.updateBrief(ada.auth, brief.id, { status: 'closed' });
  await refusedWith(w.hub.decideInterest(ada.auth, fromBen.id, { decision: 'accept' }), /Reopen the brief before accepting anyone/);
  assert.equal((await w.hub.getBrief(ben.auth, brief.id)).interests[0].status, 'pending');

  await w.hub.updateBrief(ada.auth, brief.id, { status: 'open' });
  assert.equal((await w.hub.decideInterest(ada.auth, fromBen.id, { decision: 'accept' })).status, 'accepted');
  await refusedWith(w.hub.decideInterest(ada.auth, fromCat.id, { decision: 'accept' }), /That role is already filled/);
  assert.equal((await w.hub.decideInterest(ada.auth, fromCat.id, { decision: 'decline' })).status, 'declined');
  assert.deepEqual((await w.hub.getBrief(ada.auth, brief.id)).team.members, [ada.id, ben.id]);
});

test('a brief holds at most 50 pending interests', async (t) => {
  const w = await world(t);
  const ada = await registerPerson(w, 'Ada');
  const brief = await w.hub.publishBrief(ada.auth, BRIEF);
  const candidates = [];
  for (let i = 0; i <= HUB_LIMITS.pendingInterests; i++) candidates.push(await registerPerson(w, `Candidate ${i + 1}`));
  const interests = [];
  for (const c of candidates.slice(0, HUB_LIMITS.pendingInterests)) interests.push(await w.hub.expressInterest(c.auth, brief.id, { role: 'r1' }));
  const last = candidates.at(-1);
  await refuses(w.hub.expressInterest(last.auth, brief.id, { role: 'r1' }), 'conflict');
  await w.hub.withdrawInterest(candidates[0].auth, interests[0].id);
  assert.equal((await w.hub.expressInterest(last.auth, brief.id, { role: 'r1' })).status, 'pending');
});

test('only team members nominate, only their own agents, and only before the record starts', async (t) => {
  const w = await setup(t, 'team', { nominate: false });
  const outsider = await registerPerson(w, 'Outsider');
  const aide = await registerAgent(w, w.ada, 'aide');
  const stray = await registerAgent(w, outsider, 'stray');
  await refuses(w.hub.nominateAgent(w.ada.auth, w.brief.id, { agent: w.scribe.id }), 'forbidden'); // Ben's agent
  await refuses(w.hub.nominateAgent(outsider.auth, w.brief.id, { agent: stray.id }), 'forbidden'); // not on the team
  await refuses(w.hub.nominateAgent(w.ben.auth, w.brief.id, { agent: 'koinos:ed25519:none' }), 'forbidden');
  await refuses(w.hub.nominateAgent(w.ben.auth, w.brief.id, { agent: w.scribe.id, extra: 1 }), 'invalid');
  await w.hub.nominateAgent(w.ben.auth, w.brief.id, { agent: w.scribe.id });
  await refuses(w.hub.nominateAgent(w.ben.auth, w.brief.id, { agent: w.scribe.id }), 'conflict');
  await w.hub.nominateAgent(w.ada.auth, w.brief.id, { agent: aide.id });
  await startRecord(w);
  assert.deepEqual(w.draft.body.participants.map((p) => p.name), ['Ada', 'Ben', 'scribe', 'aide']);
  const late = await registerAgent(w, w.ben, 'late');
  await refuses(w.hub.nominateAgent(w.ben.auth, w.brief.id, { agent: late.id }), 'conflict');
  await refuses(w.hub.decideInterest(w.ada.auth, w.interest.id, { decision: 'accept' }), 'conflict');
});

test('everyone who sees a brief sees whether its record started; only its team still lists it then', async (t) => {
  const w = await world(t);
  w.ada = await registerPerson(w, 'Ada');
  w.ben = await registerPerson(w, 'Ben');
  const cara = await registerPerson(w, 'Cara');
  await w.hub.updateProfile(cara.auth, { skills: ['testing'] });
  const roles = [...BRIEF.roles, { title: 'Reviewer', skills: ['testing'], commitment: 'One evening' }];
  w.brief = await w.hub.publishBrief(w.ada.auth, { ...BRIEF, roles });
  const interest = await w.hub.expressInterest(w.ben.auth, w.brief.id, { role: 'r1' });
  await w.hub.decideInterest(w.ada.auth, interest.id, { decision: 'accept' });
  const listed = async (who) => (await w.hub.listBriefs(who.auth)).filter((b) => b.id === w.brief.id);
  assert.equal((await w.hub.getBrief(cara.auth, w.brief.id)).started, false);
  assert.deepEqual((await listed(cara)).map((b) => [b.status, b.started]), [['open', false]]);

  // The brief is still open and listed, with the Reviewer role unfilled, when the record starts.
  await startRecord(w);
  const outside = await w.hub.getBrief(cara.auth, w.brief.id);
  assert.deepEqual([outside.status, outside.started, outside.project, outside.roles[1].open], ['open', true, undefined, true]);
  assert.deepEqual(await listed(cara), [], 'an outsider no longer finds a brief nobody can join');
  assert.ok(!(await w.hub.suggestions(cara.auth)).some((s) => s.brief.id === w.brief.id));
  await refuses(w.hub.expressInterest(cara.auth, w.brief.id, { role: 'r2' }), 'conflict');
  for (const member of [w.ada, w.ben]) {
    assert.deepEqual((await listed(member)).map((b) => [b.started, b.project]), [[true, w.pid]], 'the team still lists its own brief');
  }
});

// --- Starting the record (hub policy 4) -----------------------------------------------------

test('a project needs at least two people on the team', async (t) => {
  const w = await world(t);
  w.ada = await registerPerson(w, 'Ada');
  w.brief = await w.hub.publishBrief(w.ada.auth, BRIEF);
  await assert.rejects(w.hub.genesisDraft(w.ada.auth, w.brief.id), (error) => {
    assert.equal(error.code, 'invalid');
    assert.match(error.message, /at least two people/);
    assert.match(error.message, /reviewer who is neither the submitter nor the delegating principal/);
    return true;
  });
  const solo = await sign(w, w.ada, 'project.created', { title: 'Solo', description: 'Solo', participants: [{ id: w.ada.id, name: 'Ada', kind: 'human' }] }, { records: [] });
  await refuses(w.hub.startProject(w.ada.auth, w.brief.id, solo), 'invalid');
  // An agent does not count as the second person.
  const helper = await registerAgent(w, w.ada, 'helper');
  await w.hub.nominateAgent(w.ada.auth, w.brief.id, { agent: helper.id });
  await refuses(w.hub.genesisDraft(w.ada.auth, w.brief.id), 'invalid');
});

test('genesis must be signed by the owner and list exactly the team with registered names and kinds', async (t) => {
  const w = await setup(t, 'team');
  const outsider = await registerPerson(w, 'Outsider');
  const draft = await w.hub.genesisDraft(w.ada.auth, w.brief.id);
  const [ada, ben, scribe] = draft.body.participants;
  const genesis = (participants, options = {}) =>
    sign(w, options.signer ?? w.ada, 'project.created', { ...draft.body, participants }, { records: [], project: options.project ?? draft.project, time: options.time });
  const mismatches = [
    [ada, ben], // nominated agent missing
    [ada, ben, scribe, { id: outsider.id, name: 'Outsider', kind: 'human' }], // extra person
    [ada, { ...ben, name: 'Benjamin' }, scribe], // name not as registered
    [ada, ben, { ...scribe, kind: 'human' }], // wrong kind
    [ada, { ...ben, id: outsider.id }, scribe], // wrong identity
  ];
  for (const participants of mismatches) await refuses(w.hub.startProject(w.ada.auth, w.brief.id, await genesis(participants)), 'invalid');
  // Signed by someone other than the authenticated owner, or submitted by a non-owner.
  await refuses(w.hub.startProject(w.ada.auth, w.brief.id, await genesis(draft.body.participants, { signer: w.ben })), 'forbidden');
  await refuses(w.hub.startProject(w.ben.auth, w.brief.id, await genesis(draft.body.participants, { signer: w.ben })), 'forbidden');
  await refuses(w.hub.genesisDraft(w.ben.auth, w.brief.id), 'forbidden');
  await refuses(w.hub.startProject(outsider.auth, w.brief.id, await genesis(draft.body.participants)), 'forbidden');
  // Not a genesis record, or not verifiable by Koinos.
  await refuses(w.hub.startProject(w.ada.auth, w.brief.id, 'record'), 'invalid');
  const tampered = { ...(await genesis(draft.body.participants)), time: w.iso(1) };
  await refuses(w.hub.startProject(w.ada.auth, w.brief.id, tampered), 'koinos', { koinosCode: 'id' });
  // Time far from the hub clock.
  await refuses(w.hub.startProject(w.ada.auth, w.brief.id, await genesis(draft.body.participants, { time: w.iso(-11 * MIN) })), 'invalid');

  const started = await w.hub.startProject(w.ada.auth, w.brief.id, await genesis(draft.body.participants));
  assert.equal(started.project, draft.project);
  await refuses(w.hub.startProject(w.ada.auth, w.brief.id, await genesis(draft.body.participants)), 'conflict');
  await refuses(w.hub.genesisDraft(w.ada.auth, w.brief.id), 'conflict');

  // A second brief cannot reuse a project id that is already in use.
  const second = await w.hub.publishBrief(w.ada.auth, { ...BRIEF, title: 'Second' });
  const interest = await w.hub.expressInterest(w.ben.auth, second.id, { role: 'r1' });
  await w.hub.decideInterest(w.ada.auth, interest.id, { decision: 'accept' });
  const secondDraft = await w.hub.genesisDraft(w.ada.auth, second.id);
  const reuse = await sign(w, w.ada, 'project.created', secondDraft.body, { records: [], project: draft.project });
  await refuses(w.hub.startProject(w.ada.auth, second.id, reuse), 'conflict');
});

test('after the record starts only the status and listing of a brief can change, by the owner', async (t) => {
  const w = await setup(t, 'started');
  await refuses(w.hub.updateBrief(w.ada.auth, w.brief.id, { title: 'Renamed' }), 'conflict');
  await refuses(w.hub.updateBrief(w.ada.auth, w.brief.id, { summary: 'New' }), 'conflict');
  await refuses(w.hub.updateBrief(w.ben.auth, w.brief.id, { status: 'closed' }), 'forbidden');
  await refuses(w.hub.updateBrief(w.ada.auth, w.brief.id, { status: 'archived' }), 'invalid');
  await refuses(w.hub.updateBrief(w.ada.auth, w.brief.id, { owner: w.ben.id }), 'invalid');
  await refuses(w.hub.updateBrief(w.ada.auth, w.brief.id, {}), 'invalid');
  const closed = await w.hub.updateBrief(w.ada.auth, w.brief.id, { status: 'closed', listed: false });
  assert.equal(closed.status, 'closed');
  assert.equal(closed.listed, false);
  assert.equal(closed.title, BRIEF.title);
});

// --- Appending records (hub policies 1, 2, 3) ------------------------------------------------

test('a record is accepted only from the identity that signed it', async (t) => {
  const w = await setup(t, 'agreed');
  const adaSigned = await sign(w, w.ada, 'delegation.granted', { agent: w.scribe.id, agreement: w.agreement, scope: ['contribution.submit'], expires: w.iso(DAY) });
  await refuses(w.hub.appendRecord(w.ben.auth, w.pid, adaSigned), 'forbidden');
  // Relabelling the actor breaks the id and signature, which Koinos refuses.
  const relabelled = { ...adaSigned, actor: w.ben.id };
  await refuses(w.hub.appendRecord(w.ben.auth, w.pid, relabelled), 'koinos', { koinosCode: 'id' });
  await refuses(w.hub.appendRecord(w.ben.auth, w.pid, 'not a record'), 'invalid');
  await refuses(w.hub.appendRecord(w.ben.auth, w.pid, { ...(await sign(w, w.ben, 'agreement.withdrawn', { agreement: w.agreement, reason: 'r' })), signature: 'A'.repeat(86) }), 'koinos', { koinosCode: 'signature' });
});

test('a record built on a stale head gets 409 with the current head and sequence', async (t) => {
  const w = await setup(t, 'started');
  const terms = await w.hub.putBlob(w.ada.auth, w.pid, utf8(CHARTER));
  const proposal = (title) => ({ title, uri: terms.uri, digest: terms.digest, parties: [w.ada.id, w.ben.id] });
  w.tick();
  const first = await sign(w, w.ada, 'agreement.proposed', proposal('Charter'));
  const stale = await sign(w, w.ada, 'agreement.proposed', proposal('Charter, second draft'));
  const appended = await w.hub.appendRecord(w.ada.auth, w.pid, first);
  await refuses(w.hub.appendRecord(w.ada.auth, w.pid, stale), 'conflict', { head: appended.head, sequence: 2 });
  await refuses(w.hub.appendRecord(w.ada.auth, w.pid, first), 'conflict', { head: appended.head, sequence: 2 }); // replay

  // Two parties consenting at once: one is sequenced, the other must rebuild.
  w.tick();
  const both = await Promise.allSettled([
    w.hub.appendRecord(w.ada.auth, w.pid, await sign(w, w.ada, 'agreement.consented', { agreement: appended.head })),
    w.hub.appendRecord(w.ben.auth, w.pid, await sign(w, w.ben, 'agreement.consented', { agreement: appended.head })),
  ]);
  assert.deepEqual(both.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  const rejected = both.find((r) => r.status === 'rejected').reason;
  assert.equal(rejected.code, 'conflict');
  assert.equal(rejected.status, 409);
  assert.equal(rejected.sequence, 3);
  assert.deepEqual(rejected.toJSON(), { code: 'conflict', message: rejected.message, head: rejected.head, sequence: 3 });
  assert.equal((await w.hub.getProject(w.ada.auth, w.pid)).count, 3);
});

test('a record time must be within ten minutes before and two minutes after the hub clock', async (t) => {
  const w = await setup(t, 'started');
  const terms = await w.hub.putBlob(w.ada.auth, w.pid, utf8(CHARTER));
  const body = { title: 'Charter', uri: terms.uri, digest: terms.digest, parties: [w.ada.id, w.ben.id] };
  w.tick(30 * MIN);
  const at = async (offset) => w.hub.appendRecord(w.ada.auth, w.pid, await sign(w, w.ada, 'agreement.proposed', body, { time: w.iso(offset) }));
  await refuses(at(-10 * MIN - 1), 'invalid');
  await refuses(at(2 * MIN + 1), 'invalid');
  await refuses(at(DAY), 'invalid');
  assert.equal((await at(-10 * MIN)).count, 2);
  // Koinos still requires times to be nondecreasing.
  const history = (await w.hub.getBundle(w.ada.auth, w.pid)).records;
  const earlier = await sign(w, w.ada, 'agreement.proposed', body, { time: new Date(Date.parse(history.at(-1).time) - 1).toISOString(), records: history });
  await refuses(w.hub.appendRecord(w.ada.auth, w.pid, earlier), 'koinos', { koinosCode: 'time' });
  assert.equal((await at(2 * MIN)).count, 3);
});

// --- Stored bytes (hub policies 5, 6) -------------------------------------------------------

test('agreement terms must be stored for the project and cited by their ni URI', async (t) => {
  const w = await setup(t, 'started');
  const missing = await sha256Hex(CHARTER);
  const propose = (uri, digest) => append(w, w.ada, 'agreement.proposed', { title: 'Charter', uri, digest, parties: [w.ada.id, w.ben.id] });
  await refuses(propose(niUri(missing), missing), 'invalid'); // bytes never stored
  const terms = await w.hub.putBlob(w.ada.auth, w.pid, utf8(CHARTER));
  await refuses(propose('https://example.invalid/charter.txt', terms.digest), 'invalid'); // not the ni URI
  await refuses(propose(terms.uri, await sha256Hex('other text')), 'invalid'); // URI and digest disagree
  // Bytes stored for another project do not count for this one.
  const elsewhere = await importedProject(w);
  const foreign = await w.hub.putBlob(w.ada.auth, elsewhere, utf8('Charter for another project'));
  await refuses(propose(foreign.uri, foreign.digest), 'invalid');
  await refuses(w.hub.getBlob(w.ben.auth, w.pid, foreign.digest), 'not_found');
  assert.equal((await propose(terms.uri, terms.digest)).count, 2);
});

test('a contribution must cite artifact bytes stored for the project', async (t) => {
  const w = await setup(t, 'delegated');
  const digest = await sha256Hex(ARTIFACT);
  const body = (uri, d) => ({ title: 'v1', summary: 'Work.', artifact: { uri, digest: d }, agreement: w.agreement, delegation: w.delegation });
  await refuses(append(w, w.scribe, 'contribution.submitted', body(niUri(digest), digest)), 'invalid');
  const stored = await w.hub.putBlob(w.scribe.auth, w.pid, utf8(ARTIFACT));
  await refuses(append(w, w.scribe, 'contribution.submitted', body(`https://example.invalid/${digest}`, digest)), 'invalid');
  // The rule applies to people submitting directly, too.
  const human = { ...body(niUri(await sha256Hex('unstored')), await sha256Hex('unstored')), delegation: null };
  await refuses(append(w, w.ben, 'contribution.submitted', human), 'invalid');
  assert.equal((await append(w, w.scribe, 'contribution.submitted', body(stored.uri, stored.digest))).count, 6);
});

test('stored bytes are limited to 4 MiB', async (t) => {
  const w = await setup(t, 'started');
  await refuses(w.hub.putBlob(w.ada.auth, w.pid, new Uint8Array(HUB_LIMITS.blobBytes + 1)), 'too_large');
  await refuses(w.hub.putBlob(w.ada.auth, w.pid, 'text'), 'invalid');
  assert.equal((await w.hub.putBlob(w.ada.auth, w.pid, new Uint8Array(HUB_LIMITS.blobBytes))).size, HUB_LIMITS.blobBytes);
});

// --- Delegation (hub policy 7) and Koinos authority rules ---------------------------------------

test('a person can delegate only to an agent registered under their own account', async (t) => {
  const w = await world(t);
  await formTeam(w);
  const aide = await registerAgent(w, w.ada, 'aide');
  await w.hub.nominateAgent(w.ada.auth, w.brief.id, { agent: aide.id });
  await startRecord(w);
  await agree(w);
  const grant = (agent) => ({ agent, agreement: w.agreement, scope: ['contribution.submit'], expires: w.iso(DAY) });
  // Koinos alone would allow Ben to grant Ada's agent; the hub does not.
  const records = (await w.hub.getBundle(w.ada.auth, w.pid)).records;
  w.tick();
  const draft = await draftRecord({ records, actor: w.ben.id, kind: 'delegation.granted', body: grant(aide.id), time: w.iso() });
  await checkDraft(records, draft);
  await refuses(w.hub.appendRecord(w.ben.auth, w.pid, await signDraft(draft, w.ben.identity.privateKey)), 'forbidden');
  await refuses(append(w, w.ada, 'delegation.granted', grant(w.scribe.id)), 'forbidden');
  assert.equal((await append(w, w.ada, 'delegation.granted', grant(aide.id))).count, 5);
  assert.equal((await append(w, w.ben, 'delegation.granted', grant(w.scribe.id))).count, 6);
});

test('Koinos refuses a review by the principal or the submitter', async (t) => {
  const w = await setup(t, 'submitted');
  const reviewBy = (who, contribution = w.contribution) => append(w, who, 'contribution.reviewed', { contribution, decision: 'approve', note: 'Looks good.' });
  await refuses(reviewBy(w.ben), 'koinos', { koinosCode: 'authority' }); // Ben is the principal
  // A human submitter cannot review their own contribution either.
  const own = await w.hub.putBlob(w.ben.auth, w.pid, utf8('Ben direct work'));
  const direct = await append(w, w.ben, 'contribution.submitted', { title: 'Direct', summary: 'By Ben.', artifact: { uri: own.uri, digest: own.digest }, agreement: w.agreement, delegation: null });
  await refuses(reviewBy(w.ben, direct.head), 'koinos', { koinosCode: 'authority' });
  // Acceptance needs an approving review first.
  await refuses(append(w, w.ada, 'contribution.accepted', { contribution: w.contribution, review: w.contribution }), 'koinos', { koinosCode: 'state' });
  assert.equal((await reviewBy(w.ada)).state.contributions[0].status, 'reviewed');
});

test('revoking the delegation before acceptance prevents acceptance', async (t) => {
  const w = await setup(t, 'reviewed');
  await refuses(append(w, w.ada, 'delegation.revoked', { delegation: w.delegation, reason: 'Not Ada’s grant.' }), 'koinos', { koinosCode: 'authority' });
  await append(w, w.ben, 'delegation.revoked', { delegation: w.delegation, reason: 'Scope changed.' });
  await refuses(append(w, w.ada, 'contribution.accepted', { contribution: w.contribution, review: w.review }), 'koinos', { koinosCode: 'authority' });
});

test('an expired delegation prevents acceptance', async (t) => {
  const w = await setup(t, 'reviewed');
  w.tick(15 * DAY);
  await refuses(append(w, w.ada, 'contribution.accepted', { contribution: w.contribution, review: w.review }), 'koinos', { koinosCode: 'authority' });
});

// Hub policy 10: policy 3 accepts a time up to ten minutes before the hub clock,
// and Koinos compares the expiry only with that signed time.
const refusesExpired = (promise) => assert.rejects(promise, (e) => e instanceof HubError && e.code === 'invalid' && e.message === DELEGATION_EXPIRED);

test('once its delegation has expired by the hub clock, a steward cannot accept delegated work with a backdated record', async (t) => {
  const w = await setup(t, 'reviewed');
  const expires = Date.parse(w.expires);
  const accept = await sign(w, w.ada, 'contribution.accepted', { contribution: w.contribution, review: w.review }, { time: new Date(expires - 1).toISOString() });
  w.now = expires + MIN;
  await refusesExpired(w.hub.appendRecord(w.ada.auth, w.pid, accept));
  w.now = expires; // expiry is reached at `expires` itself
  await refusesExpired(w.hub.appendRecord(w.ada.auth, w.pid, accept));
  // The same signed record is accepted while the hub clock is before the expiry.
  w.now = expires - MIN;
  assert.equal((await w.hub.appendRecord(w.ada.auth, w.pid, accept)).state.contributions[0].status, 'accepted');
});

test('once its delegation has expired by the hub clock, an agent cannot submit with a backdated record', async (t) => {
  const w = await setup(t, 'delegated');
  const expires = Date.parse(w.expires);
  const stored = await w.hub.putBlob(w.scribe.auth, w.pid, utf8(ARTIFACT));
  const body = { title: 'Late work', summary: 'Signed just before the expiry.', artifact: { uri: stored.uri, digest: stored.digest }, agreement: w.agreement, delegation: w.delegation };
  const late = await sign(w, w.scribe, 'contribution.submitted', body, { time: new Date(expires - 1).toISOString() });
  w.now = expires + 5 * MIN;
  await refusesExpired(w.hub.appendRecord(w.scribe.auth, w.pid, late));
  w.now = expires - MIN;
  assert.equal((await w.hub.appendRecord(w.scribe.auth, w.pid, late)).state.contributions[0].status, 'submitted');
  // A person's own submission uses no delegation, so the rule does not apply to it.
  w.now = expires + 5 * MIN;
  const own = await w.hub.putBlob(w.ben.auth, w.pid, utf8('Ben direct work (synthetic)'));
  const direct = { ...body, title: 'Direct', artifact: { uri: own.uri, digest: own.digest }, delegation: null };
  assert.equal((await append(w, w.ben, 'contribution.submitted', direct)).state.contributions[1].principal, w.ben.id);
});

test('only the steward accepts', async (t) => {
  const w = await setup(t, 'reviewed');
  await refuses(append(w, w.ben, 'contribution.accepted', { contribution: w.contribution, review: w.review }), 'koinos', { koinosCode: 'authority' });
});

// --- Privacy of projects (hub policy 9) ----------------------------------------------------------

test('project records and bytes are visible only to participants', async (t) => {
  const w = await setup(t, 'accepted');
  const outsider = await registerPerson(w, 'Outsider');
  const scribeless = '00000000-0000-4000-8000-000000000000';
  for (const pid of [w.pid, scribeless, '../hub', 'not-a-uuid', null]) {
    await refuses(w.hub.getProject(outsider.auth, pid), 'not_found');
    await refuses(w.hub.getBundle(outsider.auth, pid), 'not_found');
    await refuses(w.hub.putBlob(outsider.auth, pid, utf8('x')), 'not_found');
    await refuses(w.hub.getBlob(outsider.auth, pid, w.terms.digest), 'not_found');
    await refuses(w.hub.appendRecord(outsider.auth, pid, {}), 'not_found');
  }
  assert.deepEqual(await w.hub.listProjects(outsider.auth), []);
  await refuses(w.hub.getBlob(w.ben.auth, w.pid, '../../hub.json'), 'invalid');
  await refuses(w.hub.getBlob(w.ben.auth, w.pid, '0'.repeat(64)), 'not_found');
  // Credit is visible only within shared projects.
  await w.hub.updateProfile(w.ben.auth, { listed: true });
  assert.deepEqual(await w.hub.credit(outsider.auth, w.ben.id), []);
  assert.equal((await w.hub.credit(w.ada.auth, w.ben.id)).length, 1);
});

// --- Import (acceptance criterion 6) -------------------------------------------------------------

// Imports a separate two-person project into w's hub and returns its id.
async function importedProject(w) {
  const records = [];
  const body = {
    title: 'Another project',
    description: 'Imported for a test.',
    participants: [
      { id: w.ada.id, name: 'Ada', kind: 'human' },
      { id: w.ben.id, name: 'Ben', kind: 'human' },
    ],
  };
  records.push(await createRecord({ records, identity: w.ada.identity, kind: 'project.created', body, time: w.iso() }));
  const result = await w.hub.importBundle({ format: BUNDLE_FORMAT, records });
  return result.project;
}

test('import stores a verified bundle unchanged and refuses rollback or divergence', async (t) => {
  const w = await setup(t, 'accepted');
  const bundle = await w.hub.getBundle(w.ben.auth, w.pid);
  const other = await world(t);
  other.now = w.now;

  await refuses(other.hub.importBundle(bundle, { expectedHead: w.started.head }), 'koinos', { koinosCode: 'pin' });
  await refuses(other.hub.importBundle(bundle, { expectedHead: null }), 'koinos', { koinosCode: 'pin' });
  const forged = structuredClone(bundle);
  forged.records[5].body.summary = 'Claimed by someone else.';
  await refuses(other.hub.importBundle(forged), 'koinos', { koinosCode: 'id' });
  await refuses(other.hub.importBundle({ format: BUNDLE_FORMAT, records: [] }), 'koinos', { koinosCode: 'format' });

  const prefix = { format: BUNDLE_FORMAT, records: bundle.records.slice(0, 5) };
  assert.deepEqual(await other.hub.importBundle(prefix), { project: w.pid, head: bundle.records[4].id, count: 5, imported: true });
  assert.deepEqual(await other.hub.importBundle(bundle, { expectedHead: w.accepted.head }), { project: w.pid, head: w.accepted.head, count: 8, imported: true });
  assert.deepEqual(await other.hub.importBundle(bundle), { project: w.pid, head: w.accepted.head, count: 8, imported: false });
  await refuses(other.hub.importBundle(prefix), 'conflict', { head: w.accepted.head, sequence: 8 });

  // A longer but different history of the same project is refused.
  const fork = bundle.records.slice(0, 6);
  const add = async (kind, body) =>
    fork.push(await signDraft(await draftRecord({ records: fork, actor: w.ada.id, kind, body, time: fork.at(-1).time }), w.ada.identity.privateKey));
  await add('contribution.reviewed', { contribution: w.contribution, decision: 'request_changes', note: 'More tests.' });
  await add('contribution.reviewed', { contribution: w.contribution, decision: 'approve', note: 'Now fine.' });
  await add('contribution.accepted', { contribution: w.contribution, review: fork.at(-1).id });
  assert.equal((await verifyBundle({ format: BUNDLE_FORMAT, records: fork })).count, 9);
  await refuses(other.hub.importBundle({ format: BUNDLE_FORMAT, records: fork }), 'conflict', { head: w.accepted.head, sequence: 8 });

  // The same people, registering their own keys on the other hub, see identical state and attribution.
  const ada = await registerPerson(other, 'Ada', { identity: w.ada.identity });
  const imported = await other.hub.getProject(ada.auth, w.pid);
  const original = await w.hub.getProject(w.ada.auth, w.pid);
  assert.deepEqual(imported.state, original.state);
  assert.deepEqual(imported.records, original.records);
  assert.equal(imported.brief, null);
  assert.deepEqual(await other.hub.listProjects(ada.auth), [{ project: w.pid, title: BRIEF.title, brief: null, head: w.accepted.head, count: 8, role: 'steward' }]);
  // Cited bytes were not imported, so they are not served.
  await refuses(other.hub.getBlob(ada.auth, w.pid, w.terms.digest), 'not_found');
});

// Signs a history outside the hub, as another hub or a single person could.
async function history(w, steps) {
  const records = [];
  for (const [who, kind, body] of steps) {
    const resolved = typeof body === 'function' ? body(records) : body;
    records.push(await createRecord({ records, identity: who.identity ?? who, kind, body: resolved, time: w.iso() }));
  }
  return { format: BUNDLE_FORMAT, records };
}

const human = (who, name) => ({ id: who.id, name, kind: 'human' });

test('credit follows the signed attribution, not a later hub registration of the agent key', async (t) => {
  const w = await world(t);
  const ada = await registerPerson(w, 'Ada');
  const ben = await registerPerson(w, 'Ben');
  const scribe = await generateIdentity();
  const charter = await sha256Hex(CHARTER);
  const artifact = await sha256Hex(ARTIFACT);
  const ids = {};
  const at = (records) => records.at(-1).id;
  // Made elsewhere: Ben delegates to scribe, scribe submits, Ada reviews and accepts.
  const bundle = await history(w, [
    [ada, 'project.created', { title: 'Made elsewhere', description: 'Imported for a test.', participants: [human(ada, 'Ada'), human(ben, 'Ben'), { id: scribe.id, name: 'scribe', kind: 'agent' }] }],
    [ada, 'agreement.proposed', { title: 'Charter', uri: niUri(charter), digest: charter, parties: [ada.id, ben.id] }],
    [ada, 'agreement.consented', (r) => ({ agreement: (ids.agreement = at(r)) })],
    [ben, 'agreement.consented', () => ({ agreement: ids.agreement })],
    [ben, 'delegation.granted', () => ({ agent: scribe.id, agreement: ids.agreement, scope: ['contribution.submit'], expires: w.iso(DAY) })],
    [scribe, 'contribution.submitted', (r) => ({ title: 'W', summary: 'Work.', artifact: { uri: niUri(artifact), digest: artifact }, agreement: ids.agreement, delegation: at(r) })],
    [ada, 'contribution.reviewed', (r) => ({ contribution: (ids.contribution = at(r)), decision: 'approve', note: 'Fine.' })],
    [ada, 'contribution.accepted', (r) => ({ contribution: ids.contribution, review: at(r) })],
  ]);
  const { project } = await w.hub.importBundle(bundle);
  const contribution = (await w.hub.getProject(ada.auth, project)).state.contributions[0];
  assert.deepEqual([contribution.actor, contribution.principal, contribution.status], [scribe.id, ben.id, 'accepted']);
  const credited = async (who) => (await w.hub.credit(who.auth, who.id)).map((c) => [c.project, c.contribution.title, c.via]);
  assert.deepEqual(await credited(ben), [[project, 'W', scribe.id]]);
  assert.deepEqual(await credited(ada), []);

  // The scribe key is then registered under Ada on this hub. The signed history
  // still names Ben as principal, so Ada, who reviewed and accepted, gets no credit.
  const c = await w.hub.challenge();
  const proof = await signText(scribe.privateKey, agentProofText(c.nonce, scribe.id, ada.id));
  await w.hub.registerAgent(ada.auth, { name: 'scribe', key: scribe.id, nonce: c.nonce, signature: proof });
  assert.deepEqual(await credited(ada), []);
  assert.deepEqual(await credited(ben), [[project, 'W', scribe.id]]);
});

test('credit keeps accepted work a party later disputed, marked with who disputed it, why and when', async (t) => {
  const w = await setup(t, 'accepted');
  const credit = (viewer) => w.hub.credit(viewer.auth, w.ben.id);
  const [before] = await credit(w.ada);
  assert.equal(before.status, 'accepted');
  assert.equal(before.dispute, undefined);
  const disputed = await append(w, w.ada, 'contribution.disputed', { contribution: w.contribution, reason: 'The tests do not cover halving (synthetic).' });
  assert.equal(disputed.state.contributions[0].status, 'disputed');
  for (const viewer of [w.ada, w.ben]) {
    const items = await credit(viewer);
    assert.equal(items.length, 1, 'a dispute does not erase the credit');
    const [item] = items;
    assert.equal(item.status, 'disputed');
    assert.equal(item.acceptedAt, before.acceptedAt, 'the acceptance is still in the history');
    assert.equal(item.via, w.scribe.id);
    assert.deepEqual(item.dispute, { by: w.ada.id, byName: 'Ada', reason: 'The tests do not cover halving (synthetic).', at: w.iso() });
  }
  // Work that was never accepted is still not credit.
  assert.deepEqual(await w.hub.credit(w.ada.auth, w.ada.id), []);
});

test('an imported history that only cites a digest cannot read bytes stored for another project', async (t) => {
  const w = await setup(t, 'agreed');
  const mallory = await registerPerson(w, 'Mallory');
  // Signed by Mallory alone, citing the digest of the charter stored for Ada and Ben's project.
  const bundle = await history(w, [
    [mallory, 'project.created', { title: 'Mine', description: 'Cites bytes it never stored.', participants: [human(mallory, 'Mallory')] }],
    [mallory, 'agreement.proposed', { title: 'Copied', uri: w.terms.uri, digest: w.terms.digest, parties: [mallory.id] }],
  ]);
  const { project } = await w.hub.importBundle(bundle);
  assert.equal((await w.hub.getProject(mallory.auth, project)).state.agreements[0].digest, w.terms.digest);
  await refuses(w.hub.getBlob(mallory.auth, project, w.terms.digest), 'not_found');
  await refuses(w.hub.getBlob(mallory.auth, w.pid, w.terms.digest), 'not_found');
  assert.equal(fromUtf8(await w.hub.getBlob(w.ben.auth, w.pid, w.terms.digest)), CHARTER);
  // Bytes linked to the imported project, as `exofab import --blobs` does after checking them, are served.
  await w.store.linkBlob(project, w.terms.digest);
  assert.equal(fromUtf8(await w.hub.getBlob(mallory.auth, project, w.terms.digest)), CHARTER);
});

test('an imported genesis does not reveal the people it names, and import reports them', async (t) => {
  const w = await world(t);
  const ada = await registerPerson(w, 'Ada');
  await w.hub.updateProfile(ada.auth, { headline: 'Unlisted headline', skills: ['hidden-skill'] });
  const mallory = await registerPerson(w, 'Mallory');
  await refuses(w.hub.getPerson(mallory.auth, ada.id), 'not_found');
  // A genesis is signed by its steward alone; Ada never agreed to this project.
  const bundle = await history(w, [
    [mallory, 'project.created', { title: 'Unsolicited project', description: 'Names Ada without asking.', participants: [human(mallory, 'Mallory'), human(ada, 'Ada')] }],
  ]);
  const imported = await w.hub.importBundle(bundle);
  assert.deepEqual(new Set(imported.registered), new Set([mallory.id, ada.id]));
  await refuses(w.hub.getPerson(mallory.auth, ada.id), 'not_found');
  await refuses(w.hub.credit(mallory.auth, ada.id), 'not_found');
  await refuses(w.hub.getPerson(ada.auth, mallory.id), 'not_found');
  // Ada, a participant of the signed history, can still read it (hub policy 9).
  assert.deepEqual((await w.hub.listProjects(ada.auth)).map((p) => [p.title, p.role, p.brief]), [['Unsolicited project', 'participant', null]]);

  // A history started on this hub lists only its team, so re-importing it reports nobody.
  const team = await setup(t, 'accepted');
  const again = await team.hub.importBundle(await team.hub.getBundle(team.ada.auth, team.pid));
  assert.equal(again.imported, false);
  assert.equal(again.registered, undefined);
});

// --- Fail closed ------------------------------------------------------------------------------

test('the hub refuses to load a hub log whose chain does not verify', async (t) => {
  const w = await setup(t, 'team');
  const path = join(w.dir, 'hub.json');
  const doc = JSON.parse(await readFile(path, 'utf8'));
  doc.events[0].body.name = 'Mallory';
  await writeFile(path, JSON.stringify(doc));
  const reloaded = new Hub({ store: new FileStore(w.dir), clock: w.clock });
  await assert.rejects(reloaded.authenticate(w.ada.token), (e) => e instanceof StoreError && e.code === 'hub-chain');
  await assert.rejects(reloaded.me(w.ada.auth), (e) => e instanceof StoreError && e.code === 'hub-chain');
});

test('the hub refuses a hub log whose events are inconsistent even if the chain verifies', async (t) => {
  const w = await setup(t, 'team');
  const store = new FileStore(w.dir);
  // Ben "updates" Ada's brief: correctly chained, but not something the hub would log.
  await store.appendHubEvent({ time: w.iso(), author: w.ben.id, type: 'brief.updated', body: { id: w.brief.id, changes: { status: 'closed' } } });
  const reloaded = new Hub({ store, clock: w.clock });
  await assert.rejects(reloaded.load(), (e) => e instanceof StoreError && e.code === 'corrupt');
  const unknown = await world(t);
  await unknown.store.init();
  await unknown.store.appendHubEvent({ time: unknown.iso(), author: null, type: 'mystery.event', body: {} });
  await assert.rejects(unknown.hub.load(), (e) => e instanceof StoreError && e.code === 'corrupt');
});

test('the hub refuses a rolled-back or altered project history', async (t) => {
  const w = await setup(t, 'agreed');
  const path = join(w.dir, 'projects', `${w.pid}.json`);
  const original = await readFile(path, 'utf8');
  const bundle = JSON.parse(original);

  await writeFile(path, JSON.stringify({ format: BUNDLE_FORMAT, records: bundle.records.slice(0, 2) }));
  await assert.rejects(w.hub.getProject(w.ada.auth, w.pid), (e) => e instanceof StoreError && e.code === 'pin');
  await assert.rejects(w.hub.listProjects(w.ada.auth), (e) => e instanceof StoreError && e.code === 'pin');

  const altered = structuredClone(bundle);
  altered.records[1].body.title = 'Different charter';
  await writeFile(path, JSON.stringify(altered));
  await assert.rejects(w.hub.getProject(w.ada.auth, w.pid), (e) => e instanceof StoreError && e.code === 'corrupt');

  await writeFile(path, original);
  assert.equal((await w.hub.getProject(w.ada.auth, w.pid)).count, 4);
});
