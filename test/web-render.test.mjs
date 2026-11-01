// Tests for the browser client's DOM-free helpers (web/format.mjs and
// web/routes.mjs), plus static checks on web/: markup that works under
// default-src 'self', no external resources, and imports that resolve.
// DOM modules are only syntax-checked here, never imported.
// Synthetic identities only: people Ada and Ben, agent scribe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { generateIdentity, createRecord, verifyBundle, BUNDLE_FORMAT, KINDS, sha256Hex, niUri } from '../src/koinos/index.mjs';
import {
  KIND_LABELS,
  CONTRIBUTION_STATUS,
  DELEGATION_STATUS,
  EXPIRY_WARNING_MS,
  kindGroup,
  revealHidden,
  hasHidden,
  oneLine,
  cleanName,
  shortId,
  nameOf,
  namesFromState,
  formatTime,
  durationWords,
  relativeTime,
  joinList,
  delegationStatus,
  compareDigests,
  termsBindingProblems,
  prettyJson,
  describeRecord,
  stateView,
} from '../web/format.mjs';
import { parseRoute, href, DEFAULT_HASH, ROUTE_NAMES } from '../web/routes.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'web');
const KOINOS = join(ROOT, 'src', 'koinos');

// --- A full synthetic history that uses all ten record kinds ---------------------

const ada = await generateIdentity();
const ben = await generateIdentity();
const scribe = await generateIdentity();
const CHARTER = 'Charter: scope, acceptance criteria, how credit is recorded. Creates no economic right.\n';
const ARTIFACT = 'synthetic artifact bytes with test evidence\n';

async function journey() {
  const records = [];
  const add = async (identity, kind, body) => {
    const record = await createRecord({ records, identity, kind, body });
    records.push(record);
    return record;
  };
  await add(ada, 'project.created', {
    title: 'Recipe scaler',
    description: 'An Exo skill that scales home-baking recipes.',
    participants: [
      { id: ada.id, name: 'Ada', kind: 'human' },
      { id: ben.id, name: 'Ben', kind: 'human' },
      { id: scribe.id, name: 'scribe', kind: 'agent' },
    ],
  });
  const digest = await sha256Hex(CHARTER);
  const agreement = await add(ada, 'agreement.proposed', { title: 'Charter', uri: niUri(digest), digest, parties: [ada.id, ben.id] });
  await add(ada, 'agreement.consented', { agreement: agreement.id });
  await add(ben, 'agreement.consented', { agreement: agreement.id });
  const expires = new Date(Date.now() + 14 * 864e5).toISOString();
  const grant = await add(ben, 'delegation.granted', { agent: scribe.id, agreement: agreement.id, scope: ['contribution.submit'], expires });
  const artifactDigest = await sha256Hex(ARTIFACT);
  const contribution = await add(scribe, 'contribution.submitted', {
    title: 'Scaling skill',
    summary: 'Adds the skill and its tests.',
    artifact: { uri: niUri(artifactDigest), digest: artifactDigest },
    agreement: agreement.id,
    delegation: grant.id,
  });
  const review = await add(ada, 'contribution.reviewed', { contribution: contribution.id, decision: 'approve', note: 'Tests pass.' });
  await add(ada, 'contribution.accepted', { contribution: contribution.id, review: review.id });
  await add(ben, 'contribution.disputed', { contribution: contribution.id, reason: 'The credit line omits scribe.' });
  await add(ben, 'delegation.revoked', { delegation: grant.id, reason: 'Task finished.' });
  await add(ben, 'agreement.withdrawn', { agreement: agreement.id, reason: 'Leaving the project.' });
  const state = await verifyBundle({ format: BUNDLE_FORMAT, records });
  return { records, state, digest, artifactDigest, expires, ids: { agreement: agreement.id, grant: grant.id, contribution: contribution.id, review: review.id } };
}

const J = await journey();
const stateAt = (n) => verifyBundle({ format: BUNDLE_FORMAT, records: J.records.slice(0, n) });

// --- Records as sentences ------------------------------------------------------------

test('the journey covers every Koinos kind, and every kind has a label', () => {
  assert.deepEqual(new Set(J.records.map((r) => r.kind)), new Set(KINDS));
  assert.deepEqual(Object.keys(KIND_LABELS).sort(), [...KINDS].sort());
  for (const kind of KINDS) assert.notEqual(kindGroup(kind), 'unknown');
});

test('describeRecord turns each kind into a plain-English sentence', () => {
  const names = namesFromState(J.state);
  const texts = J.records.map((r) => describeRecord(r, names).text);
  assert.deepEqual(texts, [
    'Ada started the project “Recipe scaler” with Ada, Ben and scribe (agent).',
    'Ada proposed the agreement “Charter” to Ada and Ben.',
    'Ada consented to “Charter”.',
    'Ben consented to “Charter”.',
    `Ben allowed scribe to submit contributions under “Charter” until ${formatTime(J.expires)}.`,
    'scribe submitted “Scaling skill” under “Charter”, using the delegation from Ben to scribe.',
    'Ada approved “Scaling skill”.',
    `Ada accepted “Scaling skill”, citing review ${J.ids.review.slice(0, 8)}….`,
    'Ben disputed the acceptance of “Scaling skill”.',
    'Ben revoked the delegation from Ben to scribe.',
    'Ben withdrew consent from “Charter”.',
  ]);
});

test('describeRecord reports who, short id, time, kind and details', () => {
  const names = namesFromState(J.state);
  const d = describeRecord(J.records[1], names);
  assert.equal(d.kind, 'agreement.proposed');
  assert.equal(d.group, 'agreement');
  assert.equal(d.label, 'Agreement proposed');
  assert.equal(d.sequence, 1);
  assert.equal(d.id, J.records[1].id);
  assert.equal(d.shortId, `${J.records[1].id.slice(0, 8)}…`);
  assert.equal(d.time, J.records[1].time);
  assert.equal(d.timeText, formatTime(J.records[1].time));
  assert.deepEqual(d.actor, { id: ada.id, name: 'Ada' });
  assert.deepEqual(d.details, [
    { label: 'Terms digest (SHA-256)', value: J.digest, mono: true },
    { label: 'Terms address', value: niUri(J.digest), mono: true },
  ]);
  assert.equal(d.parts.map((p) => p.text).join(''), d.text);
  assert.deepEqual(d.parts.filter((p) => p.role === 'who').map((p) => p.text), ['Ada', 'Ada', 'Ben']);

  const submitted = describeRecord(J.records[5], names);
  assert.deepEqual(submitted.details.map((x) => x.label), ['Summary', 'Artifact digest (SHA-256)', 'Artifact address']);
  assert.equal(submitted.details[1].value, J.artifactDigest);
});

test('describeRecord falls back to short ids when names are unknown, except genesis names', () => {
  const genesis = describeRecord(J.records[0], new Map());
  assert.equal(genesis.text, 'Ada started the project “Recipe scaler” with Ada, Ben and scribe (agent).');
  const consent = describeRecord(J.records[3], undefined);
  assert.equal(consent.text, `${shortId(ben.id)} consented to agreement ${shortId(J.ids.agreement)}.`);
  assert.match(shortId(ben.id), /^[A-Za-z0-9_-]{8}…$/);
});

test('describeRecord covers human submissions, change requests, and odd input without throwing', () => {
  const names = new Map([[ada.id, 'Ada'], [ben.id, 'Ben'], ['c'.repeat(64), 'Scaling skill']]);
  const human = describeRecord({ kind: 'contribution.submitted', actor: ben.id, body: { title: 'Docs', summary: 's', artifact: { uri: 'ni:///x', digest: 'a'.repeat(64) }, agreement: 'b'.repeat(64), delegation: null } }, names);
  assert.equal(human.text, `Ben submitted “Docs” under agreement bbbbbbbb… as a party.`);
  const changes = describeRecord({ kind: 'contribution.reviewed', actor: ada.id, body: { contribution: 'c'.repeat(64), decision: 'request_changes', note: 'Add tests.' } }, names);
  assert.equal(changes.text, 'Ada requested changes to “Scaling skill”.');
  assert.deepEqual(changes.details, [{ label: 'Note', value: 'Add tests.', mono: false }]);

  for (const odd of [null, undefined, 42, 'text', [], {}, { kind: 'contribution.reviewed', body: null }, { kind: 'project.created', body: { participants: 'x' } }]) {
    const d = describeRecord(odd, names);
    assert.equal(typeof d.text, 'string');
    assert.ok(d.text.length > 0);
  }
  const unknown = describeRecord({ kind: 'payment.sent', actor: ada.id, body: {} }, names);
  assert.equal(unknown.group, 'unknown');
  assert.equal(unknown.label, 'Unrecognised record');
  assert.equal(unknown.text, 'Ada signed a record of unrecognised kind “payment.sent”.');
  assert.equal(describeRecord({ kind: '__proto__' }).label, 'Unrecognised record');
});

test('record text stays data: markup is kept literally and hidden characters are revealed', () => {
  const title = '<img src=x onerror=alert(1)> Charter\u202Etxt.exe';
  const d = describeRecord({ kind: 'agreement.proposed', actor: ada.id, body: { title, uri: 'javascript:alert(1)', digest: 'a'.repeat(64), parties: [] } }, new Map([[ada.id, 'Ada']]));
  assert.ok(d.text.includes('<img src=x onerror=alert(1)>'));
  assert.ok(d.text.includes('⟦U+202E⟧'));
  assert.ok(!d.text.includes('\u202E'));
  assert.equal(d.details[1].value, 'javascript:alert(1)'); // shown as text, never linked
  assert.equal(nameOf(ada.id, new Map([[ada.id, 'A\u200Bda\nLovelace']])), 'A⟦U+200B⟧da Lovelace');
});

// --- Derived state as panels ------------------------------------------------------------

test('stateView summarises agreement, consents, delegation, contribution, review, acceptance and dispute', () => {
  const view = stateView(J.state, { now: Date.now() });
  assert.equal(view.project.title, 'Recipe scaler');
  assert.equal(view.project.steward.name, 'Ada');
  assert.equal(view.count, J.records.length);
  assert.equal(view.head, J.records.at(-1).id);
  assert.deepEqual(view.participants.map((p) => [p.name, p.kind]), [['Ada', 'human'], ['Ben', 'human'], ['scribe', 'agent']]);

  const [a] = view.agreements;
  assert.equal(a.title, 'Charter');
  assert.equal(a.digest, J.digest);
  assert.deepEqual(a.parties.map((p) => [p.name, p.consented]), [['Ada', true], ['Ben', false]]);
  assert.equal(a.allConsented, false);

  const [d] = view.delegations;
  assert.equal(d.agent.name, 'scribe');
  assert.equal(d.principal.name, 'Ben');
  assert.equal(d.agreement.title, 'Charter');
  assert.equal(d.status, 'revoked');
  assert.equal(d.statusLabel, 'Revoked');
  assert.equal(d.expiresText, formatTime(J.expires));

  const [c] = view.contributions;
  assert.equal(c.title, 'Scaling skill');
  assert.equal(c.status, 'disputed');
  assert.equal(c.statusLabel, 'Disputed');
  assert.equal(c.submitter.name, 'scribe');
  assert.equal(c.principal.name, 'Ben');
  assert.equal(c.artifact.digest, J.artifactDigest);
  assert.equal(c.delegation.status, 'revoked');
  assert.deepEqual(c.reviews.map((r) => [r.reviewer.name, r.decisionLabel, r.note]), [['Ada', 'Approved', 'Tests pass.']]);
  assert.equal(c.acceptance.by.name, 'Ada');
  assert.equal(c.acceptance.review, J.ids.review);
  assert.equal(c.dispute.by.name, 'Ben');
  assert.equal(c.dispute.reason, 'The credit line omits scribe.');
  assert.deepEqual(c.warnings, []); // no longer pending, so nothing to warn about
});

test('stateView warns while a review is pending near or after delegation expiry', async () => {
  const pending = await stateAt(6); // through contribution.submitted
  const expiresMs = Date.parse(J.expires);

  const early = stateView(pending, { now: expiresMs - 10 * 864e5 }).contributions[0];
  assert.equal(early.statusLabel, 'Awaiting review');
  assert.equal(early.delegation.status, 'active');
  assert.deepEqual(early.warnings, []);

  const close = stateView(pending, { now: expiresMs - 3 * 3600e3 }).contributions[0];
  assert.equal(close.delegation.status, 'expiring');
  assert.equal(close.warnings.length, 1);
  assert.match(close.warnings[0], /expires in 3 hours/);

  const late = stateView(pending, { now: expiresMs }).contributions[0];
  assert.equal(late.delegation.status, 'expired');
  assert.match(late.warnings[0], /expired, so this contribution can no longer be accepted/);
});

test('stateView warns when not every party consents to a pending contribution', () => {
  const state = structuredClone(J.state);
  state.contributions[0].status = 'reviewed';
  state.delegations[0].revoked = false;
  const c = stateView(state, { now: Date.now() }).contributions[0];
  assert.equal(c.statusLabel, 'Approved, awaiting acceptance');
  assert.deepEqual(c.warnings, ['Not every party to the agreement currently consents, so this contribution cannot be accepted until they do.']);
});

test('stateView tolerates empty and malformed state', () => {
  for (const s of [null, undefined, {}, { participants: 'x', agreements: [null], contributions: [{ status: '__proto__' }] }]) {
    const view = stateView(s);
    assert.ok(Array.isArray(view.participants));
    assert.ok(Array.isArray(view.contributions));
  }
  assert.equal(stateView({ contributions: [{ status: '__proto__' }] }).contributions[0].statusLabel, 'Unknown');
  assert.equal(stateView(null).project, null);
});

test('namesFromState maps keys to names and record ids to titles', () => {
  const names = namesFromState(J.state);
  assert.equal(names.get(ada.id), 'Ada');
  assert.equal(names.get(scribe.id), 'scribe');
  assert.equal(names.get(J.ids.agreement), 'Charter');
  assert.equal(names.get(J.ids.contribution), 'Scaling skill');
  assert.equal(names.get(J.ids.grant), 'delegation from Ben to scribe');
  assert.equal(namesFromState(null).size, 0);
});

// --- Small formatters ----------------------------------------------------------------------

test('shortId shortens key ids, record ids and uuids', () => {
  assert.equal(shortId('koinos:ed25519:ABCDEFGHIJKLMNOP'), 'ABCDEFGH…');
  assert.equal(shortId('0123456789abcdef'), '01234567…');
  assert.equal(shortId('abc'), 'abc');
  assert.equal(shortId('0123456789abcdef', 4), '0123…');
  assert.equal(shortId(null), '(none)');
  assert.equal(shortId(''), '(none)');
});

test('nameOf reads Maps and plain objects and ignores inherited keys', () => {
  assert.equal(nameOf('k1', new Map([['k1', 'Ada']])), 'Ada');
  assert.equal(nameOf('k1', { k1: 'Ben' }), 'Ben');
  assert.equal(nameOf('k1', { k1: '   ' }), 'k1');
  assert.equal(nameOf('toString', {}), 'toString');
  assert.equal(typeof nameOf('__proto__', {}), 'string');
  assert.equal(nameOf('k1', null), 'k1');
});

test('formatTime, relativeTime and durationWords', () => {
  assert.equal(formatTime('2026-10-31T14:02:09.123Z'), '2026-10-31 14:02 UTC');
  assert.equal(formatTime('2026-10-31T16:02:09+02:00'), '2026-10-31 14:02 UTC');
  for (const bad of ['1', 'nonsense', '', null, 0, '2026-13-45T99:99:99.000Z']) assert.equal(formatTime(bad), 'unknown time');
  const now = Date.parse('2026-10-31T12:00:00.000Z');
  assert.equal(relativeTime('2026-11-03T12:00:00.000Z', now), 'in 3 days');
  assert.equal(relativeTime('2026-10-31T10:00:00.000Z', now), '2 hours ago');
  assert.equal(relativeTime('2026-10-31T12:00:30.000Z', now), 'now');
  assert.equal(relativeTime('later', now), 'unknown time');
  assert.equal(durationWords(60_000), '1 minute');
  assert.equal(durationWords(59_000), 'less than a minute');
  assert.equal(durationWords(-2 * 864e5), '2 days');
});

test('joinList', () => {
  assert.equal(joinList([]), '');
  assert.equal(joinList(['Ada']), 'Ada');
  assert.equal(joinList(['Ada', 'Ben']), 'Ada and Ben');
  assert.equal(joinList(['Ada', 'Ben', 'scribe']), 'Ada, Ben and scribe');
  assert.equal(joinList(null), '');
});

test('delegationStatus: revoked, expired at expiry, expiring inside the warning window, active', () => {
  const expires = '2026-11-14T12:00:00.000Z';
  const at = Date.parse(expires);
  assert.equal(delegationStatus({ expires, revoked: true }, at - 10 * 864e5), 'revoked');
  assert.equal(delegationStatus({ expires, revoked: false }, at), 'expired');
  assert.equal(delegationStatus({ expires, revoked: false }, at + 1), 'expired');
  assert.equal(delegationStatus({ expires, revoked: false }, at - 1), 'expiring');
  assert.equal(delegationStatus({ expires, revoked: false }, at - EXPIRY_WARNING_MS + 1), 'expiring');
  assert.equal(delegationStatus({ expires, revoked: false }, at - EXPIRY_WARNING_MS), 'active');
  assert.equal(delegationStatus({ expires, revoked: false }, new Date(at - 864e5 * 7)), 'active');
  assert.equal(delegationStatus({ expires: 'soon' }, at), 'unknown');
  assert.equal(delegationStatus(null), 'unknown');
  for (const s of ['active', 'expiring', 'expired', 'revoked', 'unknown']) assert.equal(typeof DELEGATION_STATUS[s], 'string');
});

test('compareDigests allows signing only on an exact lowercase match', () => {
  const x = 'ab'.repeat(32);
  const y = 'cd'.repeat(32);
  assert.deepEqual(
    [compareDigests(x, x), compareDigests(x, y), compareDigests(x, undefined), compareDigests(undefined, x), compareDigests(x.toUpperCase(), x)].map((r) => [r.state, r.canSign]),
    [['match', true], ['mismatch', false], ['unverified', false], ['mismatch', false], ['mismatch', false]],
  );
  assert.match(compareDigests(x, y).message, /Do not sign/);
});

test('termsBindingProblems ties a proposal body to the digest its terms were checked against', () => {
  const x = 'ab'.repeat(32);
  assert.deepEqual(termsBindingProblems('agreement.proposed', { digest: x }, x), []);
  assert.equal(termsBindingProblems('agreement.proposed', { digest: x }, 'cd'.repeat(32)).length, 1);
  assert.equal(termsBindingProblems('agreement.proposed', null, x).length, 1);
  assert.deepEqual(termsBindingProblems('agreement.consented', { agreement: 'r' }, x), []);
});

test('prettyJson indents and orders keys as canonical JSON does', () => {
  assert.equal(
    prettyJson({ b: 1, a: { d: [{ z: 1, y: 'x' }], c: null }, B: true }),
    '{\n  "B": true,\n  "a": {\n    "c": null,\n    "d": [\n      {\n        "y": "x",\n        "z": 1\n      }\n    ]\n  },\n  "b": 1\n}',
  );
  assert.equal(prettyJson(undefined), 'undefined');
  assert.equal(prettyJson('a\u0000b'), '"a\\u0000b"');
});

test('revealHidden marks invisible, bidirectional and control characters but keeps tabs and newlines', () => {
  const input = 'a\u202Eb\u200Bc\r\n\td\uFEFF\u{E0041}\uD800e\u00ADf\u2066g';
  const { text, count } = revealHidden(input);
  assert.equal(count, 8);
  assert.equal(text, 'a⟦U+202E⟧b⟦U+200B⟧c⟦U+000D⟧\n\td⟦U+FEFF⟧⟦U+E0041⟧⟦U+D800⟧e⟦U+00AD⟧f⟦U+2066⟧g');
  assert.deepEqual(revealHidden('Plain text, “quoted”, ünïcødé.\n'), { text: 'Plain text, “quoted”, ünïcødé.\n', count: 0 });
  assert.deepEqual(revealHidden(5), { text: '', count: 0 });
  assert.equal(hasHidden('ok'), false);
  assert.equal(hasHidden('o\u200Fk'), true);
  assert.equal(hasHidden('o\u200Fk'), true); // the global regex keeps no state between calls
  assert.equal(oneLine('a\n\nb\tc', 120), 'a b c');
  assert.equal(oneLine('x'.repeat(10), 5), 'xxxx…');
});

test('cleanName accepts a plain name and refuses empty, long, or hidden-character names', () => {
  assert.equal(cleanName('  Ada  '), 'Ada');
  assert.equal(cleanName('Ben Example-Builder'), 'Ben Example-Builder');
  for (const bad of ['', '   ', 'x'.repeat(257), 'Ada\u202E', 'A\nda', 'A\tda', 'A\u0000']) assert.throws(() => cleanName(bad));
  assert.throws(() => cleanName(42), TypeError);
});

// --- Routes ------------------------------------------------------------------------------------

test('parseRoute matches each route and decodes parameters', () => {
  assert.deepEqual(parseRoute('#/discover'), { name: 'discover', params: {} });
  assert.deepEqual(parseRoute('#/projects'), { name: 'projects', params: {} });
  assert.deepEqual(parseRoute('#/profile/'), { name: 'profile', params: {} });
  assert.deepEqual(parseRoute('#/brief/b-1'), { name: 'brief', params: { id: 'b-1' } });
  assert.deepEqual(parseRoute('#/project/3f2c?tab=record'), { name: 'project', params: { pid: '3f2c' } });
  assert.deepEqual(parseRoute(`#/people/${encodeURIComponent(ada.id)}`), { name: 'person', params: { id: ada.id } });
  assert.deepEqual(parseRoute('#/brief/a%2Fb'), { name: 'brief', params: { id: 'a/b' } });
});

test('parseRoute redirects the empty hash, ignores in-page anchors, and reports unknown paths', () => {
  for (const empty of ['', '#', '#/']) assert.deepEqual(parseRoute(empty), { name: 'discover', params: {}, redirect: DEFAULT_HASH });
  assert.equal(parseRoute('#main'), null);
  assert.equal(parseRoute(undefined), null);
  assert.deepEqual(parseRoute('#/nope'), { name: 'notfound', params: { path: 'nope' } });
  assert.equal(parseRoute('#/brief').name, 'notfound');
  assert.equal(parseRoute('#/brief/x/y').name, 'notfound');
  assert.equal(parseRoute('#/brief/%E0%A4%A').name, 'notfound'); // malformed escape
  assert.equal(parseRoute('#/brief/a%00b').name, 'notfound'); // control character
  assert.equal(parseRoute(`#/brief/${'x'.repeat(513)}`).name, 'notfound');
  assert.equal(parseRoute(`#/${'x/'.repeat(2000)}`).name, 'notfound');
});

test('href builds addresses that parseRoute reads back', () => {
  const cases = [
    ['discover', {}],
    ['projects', {}],
    ['profile', {}],
    ['brief', { id: 'brief with spaces/and slash' }],
    ['project', { pid: '0b6f1c1e-2c7a-4b1e-9a51-6f1c1e2c7a4b' }],
    ['person', { id: scribe.id }],
  ];
  assert.deepEqual(cases.map(([name]) => name).sort(), [...ROUTE_NAMES].sort());
  for (const [name, params] of cases) assert.deepEqual(parseRoute(href(name, params)), { name, params });
  assert.equal(href('person', { id: 'koinos:ed25519:abc' }), '#/people/koinos%3Aed25519%3Aabc');
  assert.throws(() => href('nowhere'));
  assert.throws(() => href('brief', {}));
});

// --- Static checks on web/ -------------------------------------------------------------------

const webFiles = (await readdir(WEB)).sort();
const read = (name) => readFile(join(WEB, name), 'utf8');
const modules = webFiles.filter((f) => f.endsWith('.mjs'));

test('web/ holds the expected client files', () => {
  for (const f of ['index.html', 'styles.css', 'app.mjs', 'keys.mjs', 'render.mjs', 'dialog.mjs', 'format.mjs', 'routes.mjs']) {
    assert.ok(webFiles.includes(f), `missing web/${f}`);
  }
});

test('every browser module parses', () => {
  for (const f of modules) {
    const result = spawnSync(process.execPath, ['--check', join(WEB, f)], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${f}: ${result.stderr}`);
  }
});

test('index.html works under default-src self: no inline script, style, or handlers', async () => {
  const html = await read('index.html');
  assert.match(html, /<html lang="en">/);
  assert.match(html, /Content-Security-Policy" content="default-src 'self'/);
  assert.ok(html.includes('Local prototype. Synthetic data only. Keys stay in this browser.'));
  for (const label of ['Discover', 'My projects', 'Profile']) assert.ok(html.includes(`>${label}</a>`), label);
  assert.doesNotMatch(html, /<style/i);
  assert.doesNotMatch(html, /\sstyle\s*=/i);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(html, /javascript:/i);
  for (const [, attrs] of html.matchAll(/<script\b([^>]*)>/gi)) assert.match(attrs, /\ssrc="\/app\/[a-z]+\.mjs"/, 'every script is an external module');
  for (const [, url] of html.matchAll(/\s(?:src|href)="([^"#]+)"/g)) assert.match(url, /^\/app\//, `same-origin resource: ${url}`);
});

test('the elements app.mjs looks up exist in index.html', async () => {
  const [html, app] = await Promise.all([read('index.html'), read('app.mjs')]);
  const ids = [...app.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(ids.length >= 4);
  for (const id of [...ids, 'dialog-root']) assert.ok(html.includes(`id="${id}"`), `index.html lacks #${id}`);
});

test('modules never parse markup, evaluate strings, or set inline styles', async () => {
  for (const f of modules) {
    const src = await read(f);
    for (const banned of [/\.innerHTML\b/, /\.outerHTML\b/, /insertAdjacentHTML/, /document\.write/, /\beval\s*\(/, /new Function\b/, /\.style\./, /setAttribute\(\s*['"](?:style|on)/, /DOMParser/, /createContextualFragment/]) {
      assert.doesNotMatch(src, banned, `${f} uses ${banned}`);
    }
  }
});

test('styles load nothing external and define every state the client renders', async () => {
  const css = await read('styles.css');
  assert.doesNotMatch(css, /@import|@font-face|url\(/i);
  assert.match(css, /@media \(prefers-color-scheme: light\)/);
  for (const state of [...Object.keys(CONTRIBUTION_STATUS), ...Object.keys(DELEGATION_STATUS), 'consented', 'pending']) {
    assert.ok(css.includes(`.state-${state}`), `styles.css lacks .state-${state}`);
  }
  for (const group of ['project', 'agreement', 'delegation', 'contribution', 'unknown']) {
    assert.ok(css.includes(`.kind-${group}`), `styles.css lacks .kind-${group}`);
  }
  // A closed <dialog> must stay hidden, so display is set only when open.
  assert.match(css, /\.modal\[open\]\s*\{\s*display: flex;/);
  assert.doesNotMatch(css, /\.modal\s*\{[^}]*display:/);
});

test('imports resolve: relative ones within web/, /lib/koinos/ ones to src/koinos exports', async () => {
  const importRe = /^import\s+(?:\{([^}]*)\}|\*\s+as\s+\w+)\s+from\s+'([^']+)';$/gm;
  for (const f of modules) {
    const src = await read(f);
    assert.doesNotMatch(src, /\bimport\s*\(/, `${f} uses a dynamic import`);
    for (const [, names, specifier] of src.matchAll(importRe)) {
      if (specifier.startsWith('./')) {
        assert.ok(existsSync(join(WEB, specifier)), `${f}: ${specifier} does not exist`);
        continue;
      }
      const lib = /^\/lib\/koinos\/([a-z-]+\.mjs)$/.exec(specifier);
      assert.ok(lib, `${f}: unexpected import ${specifier}`);
      const target = join(KOINOS, lib[1]);
      assert.ok(existsSync(target), `${f}: ${specifier} has no src/koinos/${lib[1]}`);
      const exported = await import(target);
      for (const name of (names ?? '').split(',').map((n) => n.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
        assert.equal(typeof exported[name], 'function', `${f}: src/koinos/${lib[1]} does not export ${name}`);
      }
    }
  }
});

test('pure modules do not import DOM or browser-only modules', async () => {
  for (const f of ['format.mjs', 'routes.mjs']) {
    const src = await read(f);
    assert.doesNotMatch(src, /^import /m, `${f} must stay dependency-free so Node can test it`);
  }
});
