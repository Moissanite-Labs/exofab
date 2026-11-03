// Tests for the browser client's pure modules web/actions.mjs and
// web/proof.mjs: which records the page offers each person at each point of
// the journey, form validation, the charter template, previews, and that the
// registration texts and agent commands match the hub and the command line.
// Synthetic identities only: people Ada and Ben, agent scribe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLE_FORMAT, createRecord, draftRecord, checkDraft, generateIdentity, niUri, sha256Hex, signText, verifyBundle } from '../src/koinos/index.mjs';
import { DELEGATION_EXPIRED, Hub, HubError, agentProofText as hubAgentProof, personProofText as hubPersonProof } from '../src/hub/hub.mjs';
import { FileStore } from '../src/hub/store.mjs';
import { NO_ECONOMIC_RIGHT as DEMO_NO_ECONOMIC_RIGHT } from '../src/demo.mjs';
import { main } from '../src/cli.mjs';
import {
  CLIENT_LIMITS,
  DELEGATION_NOTE,
  EXPIRED_DELEGATION,
  NOMINATION_NOTE,
  NO_ECONOMIC_RIGHT,
  PARTICIPANT_ACCESS_NOTE,
  agentCommands,
  canExpressInterest,
  charterTemplate,
  expiryFrom,
  interestDecision,
  isExpiredDelegationRefusal,
  parseLines,
  parseSkills,
  previewText,
  projectActions,
  readBrief,
  readExpiryDays,
  readProfile,
  readProposal,
  readSubmission,
} from '../web/actions.mjs';
import { agentProofText, personProofText } from '../web/proof.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DAY_MS = 24 * 60 * 60 * 1000;
const ada = await generateIdentity();
const ben = await generateIdentity();
const scribe = await generateIdentity();
const outsider = await generateIdentity();

// The happy path, one record at a time; states[n] is the state after n records.
async function journey() {
  const records = [];
  const states = [];
  const add = async (identity, kind, body) => {
    const record = await createRecord({ records, identity, kind, body });
    records.push(record);
    states.push(await verifyBundle({ format: BUNDLE_FORMAT, records }));
    return record;
  };
  await add(ada, 'project.created', {
    title: 'Recipe scaler (synthetic)',
    description: 'An Exo skill that scales home-baking recipes.',
    participants: [
      { id: ada.id, name: 'Ada', kind: 'human' },
      { id: ben.id, name: 'Ben', kind: 'human' },
      { id: scribe.id, name: 'scribe', kind: 'agent' },
    ],
  });
  const digest = await sha256Hex(`Charter\n${NO_ECONOMIC_RIGHT}\n`);
  const agreement = await add(ada, 'agreement.proposed', { title: 'Charter', uri: niUri(digest), digest, parties: [ada.id, ben.id] });
  await add(ada, 'agreement.consented', { agreement: agreement.id });
  await add(ben, 'agreement.consented', { agreement: agreement.id });
  const expires = new Date(Date.now() + 14 * DAY_MS).toISOString();
  const grant = await add(ben, 'delegation.granted', { agent: scribe.id, agreement: agreement.id, scope: ['contribution.submit'], expires });
  const artifact = await sha256Hex('synthetic artifact\n');
  const contribution = await add(scribe, 'contribution.submitted', {
    title: 'Scaling skill',
    summary: 'Adds the skill and its tests.',
    artifact: { uri: niUri(artifact), digest: artifact },
    agreement: agreement.id,
    delegation: grant.id,
  });
  const review = await add(ada, 'contribution.reviewed', { contribution: contribution.id, decision: 'approve', note: 'Tests pass.' });
  await add(ada, 'contribution.accepted', { contribution: contribution.id, review: review.id });
  return { records, states: [null, ...states], ids: { agreement: agreement.id, grant: grant.id, contribution: contribution.id, review: review.id }, expires };
}

const J = await journey();
const S = J.states;
const { agreement, grant, contribution, review } = J.ids;
const actions = (n, me, options = {}) => projectActions(S[n], { me: me.id, ...options });
const types = (n, me, options) => actions(n, me, options).map((a) => a.type);
const SUBMIT_BLOCKED = 'Every party must consent to this agreement before work can be submitted under it.';
const submitBlocked = { type: 'submit', agreement, blocked: SUBMIT_BLOCKED };

// --- What the page offers -------------------------------------------------------------

test('only human participants are offered actions', () => {
  for (let n = 1; n <= 8; n++) {
    assert.deepEqual(actions(n, scribe, { myAgents: [] }), [], `agent at ${n} records`);
    assert.deepEqual(actions(n, outsider), [], `non-participant at ${n} records`);
  }
  assert.deepEqual(projectActions(null, { me: ada.id }), []);
  assert.deepEqual(projectActions({ participants: 'nope' }, { me: ada.id }), []);
});

test('after genesis only the steward may propose', () => {
  assert.deepEqual(actions(1, ada), [{ type: 'propose' }]);
  assert.deepEqual(actions(1, ben, { myAgents: [scribe.id] }), []);
});

test('each party is offered consent, then withdrawal', () => {
  assert.deepEqual(actions(2, ada), [{ type: 'propose' }, { type: 'consent', agreement }, submitBlocked]);
  assert.deepEqual(actions(2, ben), [{ type: 'consent', agreement }, submitBlocked]);
  assert.deepEqual(actions(3, ada), [{ type: 'propose' }, { type: 'withdraw', agreement }, submitBlocked]);
  assert.deepEqual(actions(3, ben), [{ type: 'consent', agreement }, submitBlocked]);
});

test('delegation is offered only for my own listed agents, and only once every party consents', () => {
  assert.deepEqual(actions(3, ben, { myAgents: [scribe.id] }), [
    { type: 'consent', agreement },
    { type: 'delegate', agreement, agents: [scribe.id], blocked: 'Every party must consent to this agreement before work can be delegated under it.' },
    submitBlocked,
  ]);
  assert.deepEqual(actions(4, ben, { myAgents: [scribe.id] }), [{ type: 'withdraw', agreement }, { type: 'delegate', agreement, agents: [scribe.id] }, { type: 'submit', agreement }]);
  assert.deepEqual(types(4, ben, { myAgents: [] }), ['withdraw', 'submit'], 'no agents of mine');
  assert.deepEqual(types(4, ben, { myAgents: [outsider.id] }), ['withdraw', 'submit'], 'my agent is not a participant');
  assert.deepEqual(types(4, ada, { myAgents: [] }), ['propose', 'withdraw', 'submit'], 'scribe is not Ada’s agent');
});

test('the grantor may revoke an unrevoked delegation', () => {
  assert.deepEqual(actions(5, ben, { myAgents: [scribe.id] }).filter((a) => a.type === 'revoke'), [{ type: 'revoke', delegation: grant }]);
  assert.deepEqual(actions(5, ada).filter((a) => a.type === 'revoke'), []);
  const revoked = structuredClone(S[5]);
  revoked.delegations[0].revoked = true;
  assert.deepEqual(projectActions(revoked, { me: ben.id, myAgents: [scribe.id] }).filter((a) => a.type === 'revoke'), []);
});

test('review is offered to a party who is neither submitter nor principal; the principal sees why not', () => {
  assert.deepEqual(actions(6, ada).filter((a) => a.type === 'review'), [{ type: 'review', contribution }]);
  assert.deepEqual(actions(6, ben).filter((a) => a.type === 'review'), [
    { type: 'review', contribution, blocked: 'You submitted this contribution or delegated the work, so another party must review it.' },
  ]);
});

test('the steward may accept citing the latest approving review, unless consent or the delegation lapsed', () => {
  assert.deepEqual(actions(7, ada).filter((a) => a.type === 'accept'), [{ type: 'accept', contribution, review }]);
  assert.deepEqual(actions(7, ben).filter((a) => a.type === 'accept'), [], 'Ben is not the steward');
  assert.ok(types(7, ada).includes('review'), 'an approved contribution can still be reviewed again');

  const accept = (state, now) => projectActions(state, { me: ada.id, now }).find((a) => a.type === 'accept');
  const revoked = structuredClone(S[7]);
  revoked.delegations[0].revoked = true;
  assert.match(accept(revoked).blocked, /revoked/);
  assert.match(accept(S[7], Date.parse(J.expires)).blocked, /expired/, 'expiry is reached at `expires` itself');
  const withdrawn = structuredClone(S[7]);
  withdrawn.agreements[0].consents = [ada.id];
  assert.match(accept(withdrawn).blocked, /currently consent/);
  const changes = structuredClone(S[7]);
  changes.contributions[0].reviews.push({ id: 'f'.repeat(64), actor: ada.id, decision: 'request_changes', note: 'x' });
  assert.match(accept(changes).blocked, /latest review does not approve/);
});

test('after acceptance any party may dispute, and nothing else is pending', () => {
  assert.deepEqual(actions(8, ada), [{ type: 'propose' }, { type: 'withdraw', agreement }, { type: 'submit', agreement }, { type: 'dispute', contribution }]);
  assert.deepEqual(actions(8, ben, { myAgents: [scribe.id] }), [
    { type: 'withdraw', agreement },
    { type: 'delegate', agreement, agents: [scribe.id] },
    { type: 'submit', agreement },
    { type: 'revoke', delegation: grant },
    { type: 'dispute', contribution },
  ]);
});

test('a party is offered to submit their own work, blocked until every party consents; a non-party is not', async () => {
  const submits = (state, me) => projectActions(state, { me: me.id }).filter((a) => a.type === 'submit');
  for (const n of [2, 3]) {
    assert.deepEqual(submits(S[n], ada), [submitBlocked], `Ada at ${n} records`);
    assert.deepEqual(submits(S[n], ben), [submitBlocked], `Ben at ${n} records`);
  }
  for (const n of [4, 8]) {
    assert.deepEqual(submits(S[n], ada), [{ type: 'submit', agreement }]);
    assert.deepEqual(submits(S[n], ben), [{ type: 'submit', agreement }]);
  }
  // Ben is a participant but not a party to this agreement, so he cannot submit under it.
  const adaOnly = structuredClone(S[4]);
  adaOnly.agreements[0].parties = [ada.id];
  adaOnly.agreements[0].consents = [ada.id];
  assert.deepEqual(submits(adaOnly, ben), []);
  assert.deepEqual(submits(adaOnly, ada), [{ type: 'submit', agreement }]);
  for (const n of [4, 8]) assert.deepEqual(submits(S[n], scribe), [], 'agents submit with `exofab agent submit`, not here');
  assert.deepEqual(submits(S[4], outsider), []);

  // What the page offers is what Koinos allows: a party's submission with a null delegation.
  const artifact = await sha256Hex('Ben’s own work (synthetic)\n');
  const body = { title: 'Own work', summary: 'Submitted by Ben himself.', artifact: { uri: niUri(artifact), digest: artifact }, agreement, delegation: null };
  const draftAt = async (n, who) => draftRecord({ records: J.records.slice(0, n), actor: who.id, kind: 'contribution.submitted', body });
  await checkDraft(J.records.slice(0, 4), await draftAt(4, ben));
  await checkDraft(J.records.slice(0, 8), await draftAt(8, ada));
  await assert.rejects(async () => checkDraft(J.records.slice(0, 3), await draftAt(3, ben)), /currently consent/);
});

test('readSubmission needs a title, a summary and a file of at most 4 MiB', () => {
  assert.deepEqual(readSubmission({ title: ' Own work ', summary: ' What and why. ', size: 12 }), { title: 'Own work', summary: 'What and why.' });
  assert.deepEqual(readSubmission({ title: 'Empty file', summary: 'Zero bytes.', size: 0 }), { title: 'Empty file', summary: 'Zero bytes.' });
  assert.equal(readSubmission({ title: 'Max', summary: 'S.', size: CLIENT_LIMITS.artifactBytes }).title, 'Max');
  assert.throws(() => readSubmission({ title: 'Big', summary: 'S.', size: CLIENT_LIMITS.artifactBytes + 1 }), /at most 4194304 bytes/);
  assert.throws(() => readSubmission({ title: 'No file', summary: 'S.', size: null }), /Choose the artifact file/);
  assert.throws(() => readSubmission({ title: ' ', summary: 'S.', size: 1 }), /Title cannot be empty/);
  assert.throws(() => readSubmission({ title: 'T', summary: '', size: 1 }), /Summary cannot be empty/);
  assert.throws(() => readSubmission({ title: 'T\u0007', summary: 'S.', size: 1 }), /control characters/);
  assert.equal(CLIENT_LIMITS.artifactBytes, 4 * 1024 * 1024, 'the hub’s limit on stored bytes');
});

test('the page shows the hub’s expired-delegation refusal as the expired message', () => {
  // What the browser's HubHttpError carries: the status and the hub's JSON error.
  const refusal = { status: 422, ...new HubError('invalid', DELEGATION_EXPIRED).toJSON() };
  assert.equal(isExpiredDelegationRefusal(refusal), true);
  assert.equal(isExpiredDelegationRefusal({ ...refusal, status: 400 }), false);
  assert.equal(isExpiredDelegationRefusal({ ...refusal, code: 'koinos' }), false);
  assert.equal(isExpiredDelegationRefusal({ status: 422, code: 'invalid', message: 'Record time must be within ten minutes' }), false);
  assert.equal(isExpiredDelegationRefusal(null), false);
  // The same words as the blocked accept action.
  const accept = projectActions(S[7], { me: ada.id, now: Date.parse(J.expires) }).find((a) => a.type === 'accept');
  assert.equal(accept.blocked, EXPIRED_DELEGATION);
});

test('what the page says an agent participant can do matches hub policy 8, and no text says “nothing else”', async () => {
  for (const text of [NOMINATION_NOTE, DELEGATION_NOTE]) assert.match(text, /read every record and stored file of (?:the|this) project and store files in it/);
  assert.match(NOMINATION_NOTE, /with or without a delegation/);
  assert.match(NOMINATION_NOTE, /no way to remove it or revoke its credential/);
  assert.match(DELEGATION_NOTE, /Revoking or letting the delegation expire does not change that/);
  assert.match(PARTICIPANT_ACCESS_NOTE, /Every listed participant, including agents, can read all records and stored files/);
  const sources = Object.fromEntries(await Promise.all(['views-project.mjs', 'views-brief.mjs'].map(async (f) => [f, await readFile(join(ROOT, 'web', f), 'utf8')])));
  for (const [file, source] of Object.entries(sources)) assert.doesNotMatch(source, /and nothing else/, file);
  assert.match(sources['views-project.mjs'], /description: DELEGATION_NOTE,/);
  assert.match(sources['views-brief.mjs'], /message: NOMINATION_NOTE,/);
  assert.match(sources['views-brief.mjs'], /You become the steward\. \$\{PARTICIPANT_ACCESS_NOTE\}/);
});


// --- Charter ------------------------------------------------------------------------

test('the charter template carries the same no-economic-rights statement as the demonstration', () => {
  assert.equal(NO_ECONOMIC_RIGHT, DEMO_NO_ECONOMIC_RIGHT);
  const text = charterTemplate({ title: 'Recipe scaler (synthetic)', description: 'Scale recipes.', parties: ['Ada', 'Ben'] });
  assert.ok(text.includes(NO_ECONOMIC_RIGHT));
  assert.match(text, /^Charter\n\nProject: Recipe scaler \(synthetic\)\nParties: Ada and Ben\.\n\nScope\nScale recipes\.\n/);
  assert.ok(text.endsWith(`${NO_ECONOMIC_RIGHT}\n`));
  assert.match(charterTemplate({}), /\(project title\)/);
});

test('readProposal keeps the text exactly and refuses missing parties or the economic statement', () => {
  const humans = [ada.id, ben.id];
  const text = `  Charter\r\n${NO_ECONOMIC_RIGHT}\n\n`;
  assert.deepEqual(readProposal({ title: ' Charter ', parties: [ada.id, ben.id, ada.id], text, humans }), { title: 'Charter', parties: [ada.id, ben.id], text });
  assert.throws(() => readProposal({ title: 'Charter', parties: [], text, humans }), /at least one party/);
  assert.throws(() => readProposal({ title: 'Charter', parties: [scribe.id], text, humans }), /people listed in this project/);
  assert.throws(() => readProposal({ title: 'Charter', parties: [ada.id], text: 'Payment: 5 tokens.', humans }), /Keep the statement/);
  assert.throws(() => readProposal({ title: 'Charter', parties: [ada.id], text: '   ', humans }), /cannot be empty/);
  assert.throws(() => readProposal({ title: '', parties: [ada.id], text, humans }), /Agreement title cannot be empty/);
});

// --- Forms ----------------------------------------------------------------------------

test('parseSkills lowercases, de-duplicates and reports tokens the hub would refuse', () => {
  assert.deepEqual(parseSkills('Exo-Skills, testing  node.js,testing'), { skills: ['exo-skills', 'testing', 'node.js'], invalid: [] });
  assert.deepEqual(parseSkills('c++, -bad, ok'), { skills: ['c++', 'ok'], invalid: ['-bad'] });
  assert.deepEqual(parseSkills(''), { skills: [], invalid: [] });
  assert.deepEqual(parseSkills(undefined), { skills: [], invalid: [] });
  assert.deepEqual(parseLines(' one \r\n\n two\n'), ['one', 'two']);
});

test('readBrief requires a compensation statement and valid roles', () => {
  const role = { title: ' Skill builder ', skills: 'exo-skills, testing', commitment: 'A few evenings' };
  const good = { title: ' Recipe scaler ', summary: 'Scale recipes.', compensation: 'None offered.', roles: [role], listed: true };
  assert.deepEqual(readBrief(good), {
    title: 'Recipe scaler',
    summary: 'Scale recipes.',
    compensation: 'None offered.',
    roles: [{ title: 'Skill builder', skills: ['exo-skills', 'testing'], commitment: 'A few evenings' }],
    listed: true,
  });
  assert.equal(readBrief({ ...good, listed: 'on' }).listed, false, 'only true lists a brief');
  assert.throws(() => readBrief({ ...good, compensation: '  ' }), /Compensation statement cannot be empty/);
  assert.throws(() => readBrief({ ...good, roles: [] }), /at least one role/);
  assert.throws(() => readBrief({ ...good, roles: Array(CLIENT_LIMITS.roles + 1).fill(role) }), /at most 10 roles/);
  assert.throws(() => readBrief({ ...good, roles: [{ ...role, skills: '' }] }), /Role 1 skills needs at least one skill/);
  assert.throws(() => readBrief({ ...good, roles: [role, { ...role, skills: 'ok, Bad!' }] }), /Role 2 skills: bad! is not valid/);
  assert.throws(() => readBrief({ ...good, title: 'x'.repeat(257) }), /at most 256/);
});

test('readProfile builds the profile update', () => {
  assert.deepEqual(readProfile({ name: ' Ben ', headline: ' Builds skills ', skills: 'exo-skills testing', seeking: 'Small projects\n\n', listed: true }), {
    name: 'Ben',
    headline: 'Builds skills',
    skills: ['exo-skills', 'testing'],
    seeking: ['Small projects'],
    listed: true,
  });
  assert.deepEqual(readProfile({ name: 'Ada', headline: '', skills: '', seeking: '', listed: false }).skills, []);
  assert.throws(() => readProfile({ name: ' ', headline: '', skills: '', seeking: '' }), /Display name cannot be empty/);
  assert.throws(() => readProfile({ name: 'Ada', headline: '', skills: '', seeking: 'a\n'.repeat(11) }), /at most 10/);
});

test('expiry is a whole number of days within the allowed range, as canonical Koinos time', () => {
  const now = Date.parse('2026-10-31T12:00:00.000Z');
  assert.equal(expiryFrom(14, now), '2026-11-14T12:00:00.000Z');
  assert.equal(expiryFrom('1', now), '2026-11-01T12:00:00.000Z');
  for (const bad of [0, 91, 1.5, '', 'ten', null]) assert.throws(() => readExpiryDays(bad), /whole number of days from 1 to 90/);
});

// --- Previews -------------------------------------------------------------------------

test('previewText decodes strict UTF-8, caps the length without splitting a pair, and refuses other bytes', () => {
  const enc = new TextEncoder();
  assert.deepEqual(previewText(enc.encode('<b>plain</b>\n')), { text: '<b>plain</b>\n', truncated: false, chars: 13 });
  assert.deepEqual(previewText(enc.encode('abcdef'), 4), { text: 'abcd', truncated: true, chars: 6 });
  assert.deepEqual(previewText(enc.encode('abc😀d'), 4), { text: 'abc', truncated: true, chars: 6 });
  assert.deepEqual(previewText(new Uint8Array([0xff, 0xfe, 0x00])), { text: null, truncated: false, chars: 0 });
  assert.equal(previewText(enc.encode('﻿BOM')).text, '﻿BOM', 'a leading BOM is kept, not hidden');
  assert.throws(() => previewText('text'), TypeError);
});

// --- Agreement with the hub and the command line -----------------------------------------

test('registration proof texts equal the hub’s', () => {
  const nonce = 'bm9uY2U';
  assert.equal(personProofText(nonce, ada.id), hubPersonProof(nonce, ada.id));
  assert.equal(agentProofText(nonce, scribe.id, ben.id), hubAgentProof(nonce, scribe.id, ben.id));
});

function sink() {
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

test('the agent commands shown on the profile page run from a checkout, read tokens at a prompt, and parse', async () => {
  const hub = 'http://127.0.0.1:4317';
  const text = agentCommands(hub);
  const lines = text.split('\n').filter((line) => line !== '' && !line.startsWith('#'));
  // Commands name the entry point in the checkout, not an `exofab` that nothing puts on PATH.
  const commands = lines.map((line) => /node src\/cli\.mjs [^)]*?(?= \)$|$)/.exec(line)?.[0]).filter(Boolean);
  assert.ok(existsSync(join(ROOT, 'src', 'cli.mjs')));
  assert.equal(commands.length, 3);
  assert.ok(commands.includes(`node src/cli.mjs agent register --name scribe --key scribe.pem --hub ${hub}`));
  // The person's token is read and exported only inside a subshell that runs
  // the register command, so it never stays in the shell the agent runs from.
  const register = lines.filter((line) => line.includes('EXOFAB_TOKEN'));
  assert.deepEqual(register, [`( read -rs EXOFAB_TOKEN && export EXOFAB_TOKEN && node src/cli.mjs agent register --name scribe --key scribe.pem --hub ${hub} )`]);
  for (const line of lines.filter((l) => !l.startsWith('( '))) assert.doesNotMatch(line, /\bEXOFAB_TOKEN\b/, `top-level line touches the person's token: ${line}`);
  // Tokens are read at a silent prompt, never typed inline where shell history keeps them.
  for (const line of lines.filter((l) => !l.startsWith('node src/cli.mjs ') && !l.startsWith('( '))) assert.match(line, /^read -rs EXOFAB_AGENT_TOKEN && export EXOFAB_AGENT_TOKEN$/);
  assert.doesNotMatch(text, /EXOFAB_(AGENT_)?TOKEN=/);
  for (const command of commands.filter((c) => c.includes(' agent '))) {
    // Without the token variable, a command whose options all parse stops at the token check.
    const args = command.split(' ').slice(2);
    const stderr = sink();
    const status = await main(args, { stdout: sink(), stderr, env: {} });
    assert.equal(status, 2, command);
    assert.match(stderr.text(), /Set EXOFAB_(AGENT_)?TOKEN in the environment/, command);
  }
});

test('run in bash, the agent commands give the person’s token to the register command only', (t) => {
  // `node` is replaced by a shell function that reports which tokens it sees;
  // a later child process stands in for anything the agent's runtime starts.
  const script = [
    'node() { printf "%s|%s|%s\\n" "$2 $3" "${EXOFAB_TOKEN-unset}" "${EXOFAB_AGENT_TOKEN-unset}"; }',
    agentCommands('http://127.0.0.1:4317'),
    'bash -c \'printf "child|%s\\n" "${EXOFAB_TOKEN-unset}"\'',
  ].join('\n');
  const run = spawnSync('bash', ['-c', script], { input: 'exf_person_synthetic\nexf_agent_synthetic\n', encoding: 'utf8', env: { PATH: process.env.PATH } });
  if (run.error?.code === 'ENOENT') {
    t.skip('bash is not available, so the token-scoping check did not run; the static checks above did');
    return;
  }
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(run.stdout.trim().split('\n'), [
    'keygen scribe.pem|unset|unset',
    'agent register|exf_person_synthetic|unset',
    'agent submit|unset|exf_agent_synthetic',
    'child|unset',
  ]);
});

test('the withdraw-consent text names every effect Koinos gives withdrawal', async () => {
  // Koinos 0.1: while any party has withdrawn, no one can delegate, submit or accept under the agreement.
  const { records } = await journey();
  const upToGrant = records.slice(0, 5); // genesis, proposal, two consents, delegation to scribe
  const agreement = upToGrant[1].id;
  const withdrawn = [...upToGrant, await createRecord({ records: upToGrant, identity: ben, kind: 'agreement.withdrawn', body: { agreement, reason: 'Pausing.' } })];
  const refused = async (identity, kind, body) =>
    assert.rejects(async () => checkDraft(withdrawn, await draftRecord({ records: withdrawn, actor: identity.id, kind, body })), /currently consent/);
  const artifact = { uri: niUri('a'.repeat(64)), digest: 'a'.repeat(64) };
  await refused(scribe, 'contribution.submitted', { title: 'Work', summary: 'S.', artifact, agreement, delegation: upToGrant[4].id });
  await refused(ada, 'contribution.submitted', { title: 'Work', summary: 'S.', artifact, agreement, delegation: null });
  await refused(ben, 'delegation.granted', { agent: scribe.id, agreement, scope: ['contribution.submit'], expires: new Date(Date.now() + DAY_MS).toISOString() });

  const source = await readFile(join(ROOT, 'web', 'views-project.mjs'), 'utf8');
  const copy = /withdraw: \(ctx, item\) => \{[\s\S]*?text: `([^`]*)`/.exec(source)?.[1];
  assert.ok(copy, 'withdraw action text not found');
  for (const effect of ['delegations', 'submissions', 'acceptances', 'your agent']) assert.ok(copy.includes(effect), `withdraw text omits ${effect}: ${copy}`);
});

// --- Briefs: the page offers only what the hub allows ----------------------------------------

test('the brief page offers Accept and Express interest only when the hub allows them, and says why not', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'exofab-web-actions-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const hub = new Hub({ store: new FileStore(dir) });
  const person = async (name) => {
    const identity = await generateIdentity();
    const { nonce } = await hub.challenge();
    const { token } = await hub.registerPerson({ name, key: identity.id, nonce, signature: await signText(identity.privateKey, hubPersonProof(nonce, identity.id)) });
    return { identity, id: identity.id, auth: await hub.authenticate(token) };
  };
  const [owner, ben, cara, dan] = [await person('Ada'), await person('Ben'), await person('Cara'), await person('Dan')];
  const roles = [
    { title: 'Skill builder', skills: ['exo-skills'], commitment: 'A few evenings' },
    { title: 'Reviewer', skills: ['testing'], commitment: 'One evening' },
  ];
  const { id } = await hub.publishBrief(owner.auth, { title: 'Recipe scaler (synthetic)', summary: 'Synthetic.', compensation: 'None offered.', roles, listed: true });
  const view = (who) => hub.getBrief(who.auth, id);
  const offers = async (who, interest) => interestDecision(interest, await view(owner));
  // Each refused case: the page does not offer Accept, and the hub refuses it.
  const refusedLike = async (interest, reason) => {
    assert.deepEqual(await offers(owner, interest), { accept: false, reason });
    await assert.rejects(hub.decideInterest(owner.auth, interest.id, { decision: 'accept' }), (e) => e.code === 'conflict');
  };

  const fromBen = await hub.expressInterest(ben.auth, id, { role: 'r1' });
  const fromCara = await hub.expressInterest(cara.auth, id, { role: 'r1' });
  const forReview = await hub.expressInterest(dan.auth, id, { role: 'r2' });
  assert.deepEqual(await offers(owner, fromBen), { accept: true });
  await hub.decideInterest(owner.auth, fromBen.id, { decision: 'accept' });
  await refusedLike(fromCara, 'This role is already filled.');
  await hub.updateBrief(owner.auth, id, { status: 'closed' });
  await refusedLike(forReview, 'Reopen the brief to accept anyone.');
  await hub.updateBrief(owner.auth, id, { status: 'open' });

  // An outsider may express interest in the open Reviewer role until the record starts.
  const eve = await person('Eve');
  assert.equal(canExpressInterest(await view(eve)), true);
  assert.equal(canExpressInterest(await view(owner), { isOwner: true }), false);
  assert.equal(canExpressInterest(await view(ben), { isMember: true }), false);
  const { project, body } = await hub.genesisDraft(owner.auth, id);
  const genesis = await createRecord({ records: [], identity: owner.identity, kind: 'project.created', body, project });
  await hub.startProject(owner.auth, id, genesis);
  const outside = await view(eve);
  assert.equal(outside.project, undefined, 'the project id is for the team only');
  assert.equal(outside.roles[1].open, true);
  assert.equal(canExpressInterest(outside), false, 'the page no longer offers Express interest');
  await assert.rejects(hub.expressInterest(eve.auth, id, { role: 'r2' }), (e) => e.code === 'conflict');
  await refusedLike(forReview, 'The record has started, so its participants are fixed.');
  // Declining stays possible, so the owner can clear interests that can no longer be met.
  assert.equal((await hub.decideInterest(owner.auth, forReview.id, { decision: 'decline' })).status, 'declined');
  assert.equal((await hub.decideInterest(owner.auth, fromCara.id, { decision: 'decline' })).status, 'declined');
});
