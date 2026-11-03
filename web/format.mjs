// Pure, DOM-free formatting for the browser client. Node tests import this
// module directly, so it must not touch window, document, or /lib/ paths.
// Every string that comes from a record, the hub, or another person is data:
// it is only ever turned into more strings here, never into markup or code.

const KEY_PREFIX = 'koinos:ed25519:';
const HEX64 = /^[0-9a-f]{64}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const NAME_MAX = 256; // Koinos participant names are limited to 256 UTF-16 code units

export const KIND_LABELS = Object.freeze({
  'project.created': 'Project started',
  'agreement.proposed': 'Agreement proposed',
  'agreement.consented': 'Consent given',
  'agreement.withdrawn': 'Consent withdrawn',
  'delegation.granted': 'Delegation granted',
  'delegation.revoked': 'Delegation revoked',
  'contribution.submitted': 'Contribution submitted',
  'contribution.reviewed': 'Contribution reviewed',
  'contribution.accepted': 'Contribution accepted',
  'contribution.disputed': 'Acceptance disputed',
});

export const CONTRIBUTION_STATUS = Object.freeze({
  submitted: 'Awaiting review',
  changes_requested: 'Changes requested',
  reviewed: 'Approved, awaiting acceptance',
  accepted: 'Accepted',
  disputed: 'Disputed',
});

export const DELEGATION_STATUS = Object.freeze({
  active: 'Active',
  expiring: 'Expiring soon',
  expired: 'Expired',
  revoked: 'Revoked',
  unknown: 'Unknown',
});

// A pending review this close to its delegation's expiry gets a warning: an
// expired grant makes the contribution permanently unacceptable.
export const EXPIRY_WARNING_MS = 48 * 60 * 60 * 1000;

const PENDING = new Set(['submitted', 'changes_requested', 'reviewed']);
const GROUPS = new Set(['project', 'agreement', 'delegation', 'contribution']);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const text = (v, fallback = '(missing)') => (typeof v === 'string' && v.trim() !== '' ? v : fallback);

export function kindGroup(kind) {
  const group = typeof kind === 'string' ? kind.split('.')[0] : '';
  return GROUPS.has(group) ? group : 'unknown';
}

export function kindLabel(kind) {
  return Object.hasOwn(KIND_LABELS, kind) ? KIND_LABELS[kind] : 'Unrecognised record';
}

// --- Hidden characters ---------------------------------------------------------

// Characters that change how text looks without being visible: C0 and C1
// controls (except tab and line feed), bidirectional controls, zero-width
// characters, line and paragraph separators, the BOM, Unicode tag characters,
// and unpaired surrogates. A person approving exact text must see them.
const HIDDEN = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\u{E0000}-\u{E007F}]|\p{Cs}/gu;

const codePoint = (ch) => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;

// Replaces each hidden character with a visible marker such as ⟦U+202E⟧.
export function revealHidden(value) {
  if (typeof value !== 'string') return { text: '', count: 0 };
  let count = 0;
  const out = value.replace(HIDDEN, (ch) => {
    count += 1;
    return `⟦${codePoint(ch)}⟧`;
  });
  return { text: out, count };
}

export function hasHidden(value) {
  return typeof value === 'string' && value.search(HIDDEN) !== -1;
}

// A single-line label for display: hidden characters revealed, line breaks
// folded to spaces, and length capped.
export function oneLine(value, max = 120) {
  const shown = revealHidden(String(value)).text.replace(/[\t\n]+/g, ' ').trim();
  return shown.length > max ? `${shown.slice(0, max - 1)}…` : shown;
}

// Validates a local identity name. Returns the trimmed name or throws.
export function cleanName(value) {
  if (typeof value !== 'string') throw new TypeError('A name must be text');
  const name = value.trim();
  if (name === '') throw new Error('A name cannot be empty');
  if (name.length > NAME_MAX) throw new Error(`A name can be at most ${NAME_MAX} characters`);
  if (hasHidden(name) || /[\t\n]/.test(name)) throw new Error('A name cannot contain control or invisible characters');
  return name;
}

// --- Ids, names, times -----------------------------------------------------------

// The first characters of a key id (after its prefix), record id, or uuid.
export function shortId(id, length = 8) {
  if (typeof id !== 'string' || id === '') return '(none)';
  const core = id.startsWith(KEY_PREFIX) ? id.slice(KEY_PREFIX.length) : id;
  const shown = oneLine(core, Number.MAX_SAFE_INTEGER);
  return shown.length <= length ? shown : `${shown.slice(0, length)}…`;
}

function lookup(names, id) {
  if (!names || typeof id !== 'string') return undefined;
  const value = names instanceof Map ? names.get(id) : Object.hasOwn(names, id) ? names[id] : undefined;
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

// Display name for a key id or record id: from the map if present, else a short id.
export function nameOf(id, names) {
  const name = lookup(names, id);
  return name === undefined ? shortId(id) : oneLine(name);
}

// Maps participant key ids to names and record ids to titles, so sentences can
// say "Ben consented to “Charter”" instead of quoting hashes.
export function namesFromState(state) {
  const names = new Map();
  if (!isObject(state)) return names;
  for (const p of list(state.participants)) if (isObject(p) && typeof p.id === 'string') names.set(p.id, text(p.name, shortId(p.id)));
  for (const a of list(state.agreements)) if (isObject(a) && typeof a.id === 'string') names.set(a.id, text(a.title, shortId(a.id)));
  for (const c of list(state.contributions)) if (isObject(c) && typeof c.id === 'string') names.set(c.id, text(c.title, shortId(c.id)));
  for (const d of list(state.delegations)) {
    if (!isObject(d) || typeof d.id !== 'string') continue;
    names.set(d.id, `delegation from ${nameOf(d.principal, names)} to ${nameOf(d.agent, names)}`);
  }
  return names;
}

function toMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && ISO_TIME.test(value)) return Date.parse(value);
  return NaN;
}

// "2026-10-31 14:02 UTC". UTC keeps the text the same for everyone who reads
// a shared record.
export function formatTime(iso) {
  const ms = typeof iso === 'string' && ISO_TIME.test(iso) ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return 'unknown time';
  const s = new Date(ms).toISOString();
  return `${s.slice(0, 10)} ${s.slice(11, 16)} UTC`;
}

export function durationWords(ms) {
  const abs = Math.abs(ms);
  for (const [unit, size] of [['day', 864e5], ['hour', 36e5], ['minute', 6e4]]) {
    if (abs >= size) {
      const n = Math.floor(abs / size);
      return `${n} ${unit}${n === 1 ? '' : 's'}`;
    }
  }
  return 'less than a minute';
}

// "in 3 days", "2 hours ago", or "unknown time".
export function relativeTime(iso, now = Date.now()) {
  const delta = toMs(iso) - toMs(now);
  if (!Number.isFinite(delta)) return 'unknown time';
  if (Math.abs(delta) < 6e4) return 'now';
  return delta > 0 ? `in ${durationWords(delta)}` : `${durationWords(delta)} ago`;
}

export function joinList(items) {
  const xs = list(items);
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
}

// --- Delegations and digests -------------------------------------------------------

// Koinos treats a grant as expired at `expires` itself, so equality is expired.
export function delegationStatus(delegation, now = Date.now()) {
  if (!isObject(delegation)) return 'unknown';
  if (delegation.revoked === true) return 'revoked';
  const left = toMs(delegation.expires) - toMs(now);
  if (!Number.isFinite(left)) return 'unknown';
  if (left <= 0) return 'expired';
  return left < EXPIRY_WARNING_MS ? 'expiring' : 'active';
}

export const isSha256Hex = (value) => typeof value === 'string' && HEX64.test(value);

// Compares the digest a record claims with the one the browser computed from
// the stored bytes. Only an exact match allows signing.
export function compareDigests(claimed, computed) {
  if (!isSha256Hex(computed)) {
    return { state: 'unverified', canSign: false, message: 'This browser could not compute a SHA-256 digest of the stored terms, so they cannot be checked. Signing is disabled.' };
  }
  if (!isSha256Hex(claimed)) {
    return { state: 'mismatch', canSign: false, message: 'The record does not carry a valid lowercase SHA-256 digest for its terms. Signing is disabled.' };
  }
  if (claimed !== computed) {
    return { state: 'mismatch', canSign: false, message: 'The stored terms do not match the digest in the record. Do not sign: the text shown is not the text the record names. Signing is disabled.' };
  }
  return { state: 'match', canSign: true, message: 'The SHA-256 digest computed by this browser from the stored terms equals the digest in the record.' };
}

// --- Terms shown before signing (acceptance criterion 3) ------------------------

// ignoreBOM keeps a leading U+FEFF, so the text shown is all of the bytes, as
// Koinos fromUtf8 decodes them.
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

// Prepares terms for confirmSign from the exact stored bytes: the digest is
// computed here with WebCrypto, and the text is the strict UTF-8 decoding of
// the same bytes (null when they are not valid UTF-8).
export async function termsFromBytes(bytes, digestClaimed) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('termsFromBytes takes a Uint8Array');
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  const digestComputed = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  let text = null;
  try {
    text = STRICT_UTF8.decode(bytes);
  } catch {
    text = null;
  }
  return { text, digestClaimed, digestComputed };
}

// What the signing dialog shows for terms, and whether it may offer signing:
// only for valid UTF-8 whose computed digest equals the claimed one exactly.
// `shown` is the exact text with hidden characters marked, or null.
export function termsGate(terms) {
  const check = compareDigests(terms?.digestClaimed, terms?.digestComputed);
  const shown = typeof terms?.text === 'string' ? revealHidden(terms.text) : null;
  return { check, shown, canSign: check.canSign && shown !== null };
}

// A proposal names its terms by the digest in its body, so the digest the
// terms were checked against must be that one. Returns problems that block
// signing (none for other kinds, whose terms digest comes from state).
export function termsBindingProblems(kind, body, digestClaimed) {
  if (kind !== 'agreement.proposed') return [];
  const digest = isObject(body) ? body.digest : undefined;
  if (digest !== digestClaimed) return ['The digest in the record body is not the digest the terms were checked against. Signing is disabled.'];
  return [];
}

// --- JSON --------------------------------------------------------------------------

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (isObject(value)) {
    // Default sort compares UTF-16 code units, the order Koinos canonical JSON uses.
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
  }
  return value;
}

// Indented JSON with keys in canonical order, so what a person reads matches
// the order in which the record is hashed.
export function prettyJson(value) {
  const out = JSON.stringify(sortKeys(value), null, 2);
  return out === undefined ? 'undefined' : out;
}

// --- Records as sentences ----------------------------------------------------------

// A sentence is a list of parts; the renderer styles names and references
// differently from plain words. `text` is the plain-language string.
const part = (value, role = 'plain') => ({ text: value, role });
const quote = (value) => `“${oneLine(text(value), 120)}”`;

function sentence(...pieces) {
  const parts = pieces.flat(Infinity).filter((p) => p !== null && p !== '').map((p) => (typeof p === 'string' ? part(p) : p));
  return { parts, text: parts.map((p) => p.text).join('') };
}

function listParts(items) {
  const out = [];
  items.forEach((item, i) => {
    if (i > 0) out.push(i === items.length - 1 ? ' and ' : ', ');
    out.push(item);
  });
  return out;
}

export function describeRecord(record, names) {
  const r = isObject(record) ? record : {};
  const b = isObject(r.body) ? r.body : {};
  const kind = typeof r.kind === 'string' ? r.kind : '';
  // Genesis lists the names it introduces; use them when the map lacks them.
  const local = new Map();
  if (kind === 'project.created') {
    for (const p of list(b.participants)) if (isObject(p) && typeof p.id === 'string') local.set(p.id, text(p.name, shortId(p.id)));
  }
  const nm = (id) => (lookup(names, id) === undefined && local.has(id) ? oneLine(local.get(id)) : nameOf(id, names));
  const who = (id) => part(nm(id), 'who');
  const recordRef = (id, noun, quoted = true) => {
    const known = lookup(names, id);
    if (known === undefined) return part(`${noun} ${shortId(id)}`, 'ref');
    return part(quoted ? quote(known) : oneLine(known), 'ref');
  };
  const details = [];
  const detail = (label, value, mono = false) => {
    if (value === undefined || value === null) return;
    details.push({ label, value: revealHidden(String(value)).text, mono });
  };

  const actor = who(r.actor);
  let s;
  switch (kind) {
    case 'project.created': {
      const people = list(b.participants).filter(isObject).map((p) => part(p.kind === 'agent' ? `${nm(p.id)} (agent)` : nm(p.id), 'who'));
      s = sentence(actor, ' started the project ', part(quote(b.title), 'ref'), people.length ? [' with ', listParts(people)] : ' with no participants', '.');
      detail('Description', typeof b.description === 'string' ? b.description : undefined);
      break;
    }
    case 'agreement.proposed':
      s = sentence(actor, ' proposed the agreement ', part(quote(b.title), 'ref'), ' to ', listParts(list(b.parties).map(who)), '.');
      detail('Terms digest (SHA-256)', b.digest, true);
      detail('Terms address', b.uri, true);
      break;
    case 'agreement.consented':
      s = sentence(actor, ' consented to ', recordRef(b.agreement, 'agreement'), '.');
      break;
    case 'agreement.withdrawn':
      s = sentence(actor, ' withdrew consent from ', recordRef(b.agreement, 'agreement'), '.');
      detail('Reason', b.reason);
      break;
    case 'delegation.granted': {
      const scope = list(b.scope);
      const what = scope.length === 1 && scope[0] === 'contribution.submit' ? ' to submit contributions under ' : ` to act with scope ${oneLine(scope.join(', '))} under `;
      s = sentence(actor, ' allowed ', who(b.agent), what, recordRef(b.agreement, 'agreement'), ' until ', part(formatTime(b.expires), 'time'), '.');
      detail('Scope', scope.join(', '), true);
      detail('Expires', b.expires, true);
      break;
    }
    case 'delegation.revoked':
      s = sentence(actor, ' revoked the ', recordRef(b.delegation, 'delegation', false), '.');
      detail('Reason', b.reason);
      break;
    case 'contribution.submitted': {
      const how = b.delegation === null ? ' as a party' : [', using the ', recordRef(b.delegation, 'delegation', false)];
      s = sentence(actor, ' submitted ', part(quote(b.title), 'ref'), ' under ', recordRef(b.agreement, 'agreement'), how, '.');
      detail('Summary', b.summary);
      detail('Artifact digest (SHA-256)', isObject(b.artifact) ? b.artifact.digest : undefined, true);
      detail('Artifact address', isObject(b.artifact) ? b.artifact.uri : undefined, true);
      break;
    }
    case 'contribution.reviewed': {
      const target = recordRef(b.contribution, 'contribution');
      if (b.decision === 'approve') s = sentence(actor, ' approved ', target, '.');
      else if (b.decision === 'request_changes') s = sentence(actor, ' requested changes to ', target, '.');
      else s = sentence(actor, ' reviewed ', target, ' with an unrecognised decision.');
      detail('Note', b.note);
      break;
    }
    case 'contribution.accepted':
      s = sentence(actor, ' accepted ', recordRef(b.contribution, 'contribution'), ', citing review ', part(shortId(b.review), 'code'), '.');
      break;
    case 'contribution.disputed':
      s = sentence(actor, ' disputed the acceptance of ', recordRef(b.contribution, 'contribution'), '.');
      detail('Reason', b.reason);
      break;
    default:
      s = sentence(actor, ' signed a record of unrecognised kind ', part(quote(kind || '(none)'), 'code'), '.');
  }

  return {
    id: typeof r.id === 'string' ? r.id : null,
    shortId: shortId(r.id),
    sequence: Number.isSafeInteger(r.sequence) ? r.sequence : null,
    kind,
    group: kindGroup(kind),
    label: kindLabel(kind),
    time: typeof r.time === 'string' ? r.time : null,
    timeText: formatTime(r.time),
    actor: { id: typeof r.actor === 'string' ? r.actor : null, name: actor.text },
    parts: s.parts,
    text: s.text,
    details,
  };
}

// --- Derived state as display models -------------------------------------------------

const person = (id, names) => ({ id: typeof id === 'string' ? id : null, name: nameOf(id, names) });

// Turns Koinos derived state into the facts each panel shows, including the
// warnings a reviewer or steward needs before acting.
export function stateView(state, { now = Date.now(), names } = {}) {
  const s = isObject(state) ? state : {};
  const nm = names ?? namesFromState(s);
  const project = isObject(s.project)
    ? { id: s.project.id ?? null, title: text(s.project.title), description: text(s.project.description, ''), steward: person(s.project.steward, nm) }
    : null;

  const participants = list(s.participants).filter(isObject).map((p) => ({
    ...person(p.id, nm),
    kind: p.kind === 'agent' ? 'agent' : p.kind === 'human' ? 'human' : 'unknown',
  }));

  const agreements = list(s.agreements).filter(isObject).map((a) => {
    const consents = list(a.consents);
    const parties = list(a.parties).map((id) => ({ ...person(id, nm), consented: consents.includes(id) }));
    return {
      id: a.id ?? null,
      title: oneLine(text(a.title)),
      uri: typeof a.uri === 'string' ? a.uri : '',
      digest: typeof a.digest === 'string' ? a.digest : '',
      parties,
      allConsented: parties.length > 0 && parties.every((p) => p.consented),
    };
  });

  const delegations = list(s.delegations).filter(isObject).map((d) => {
    const status = delegationStatus(d, now);
    return {
      id: d.id ?? null,
      agent: person(d.agent, nm),
      principal: person(d.principal, nm),
      agreement: { id: d.agreement ?? null, title: nameOf(d.agreement, nm) },
      scope: list(d.scope),
      expires: typeof d.expires === 'string' ? d.expires : null,
      expiresText: formatTime(d.expires),
      expiresRelative: relativeTime(d.expires, now),
      status,
      statusLabel: DELEGATION_STATUS[status],
    };
  });

  const contributions = list(s.contributions).filter(isObject).map((c) => {
    const agreement = agreements.find((a) => a.id === c.agreement) ?? null;
    const delegation = c.delegation === null ? null : delegations.find((d) => d.id === c.delegation) ?? null;
    const pending = PENDING.has(c.status);
    const warnings = [];
    if (pending && agreement && !agreement.allConsented) {
      warnings.push('Not every party to the agreement currently consents, so this contribution cannot be accepted until they do.');
    }
    if (pending && delegation && (delegation.status === 'revoked' || delegation.status === 'expired')) {
      warnings.push(`Its delegation is ${delegation.status}, so this contribution can no longer be accepted.`);
    }
    if (pending && delegation?.status === 'expiring') {
      warnings.push(`Its delegation expires ${delegation.expiresRelative} (${delegation.expiresText}). After that it can never be accepted.`);
    }
    const artifact = isObject(c.artifact) ? c.artifact : {};
    return {
      id: c.id ?? null,
      title: oneLine(text(c.title)),
      summary: text(c.summary, ''),
      artifact: { uri: typeof artifact.uri === 'string' ? artifact.uri : '', digest: typeof artifact.digest === 'string' ? artifact.digest : '' },
      status: typeof c.status === 'string' ? c.status : 'unknown',
      statusLabel: Object.hasOwn(CONTRIBUTION_STATUS, c.status) ? CONTRIBUTION_STATUS[c.status] : 'Unknown',
      submitter: person(c.actor, nm),
      principal: person(c.principal, nm),
      agreement: { id: c.agreement ?? null, title: nameOf(c.agreement, nm) },
      delegation,
      reviews: list(c.reviews).filter(isObject).map((r) => ({
        id: r.id ?? null,
        reviewer: person(r.actor, nm),
        decision: r.decision,
        decisionLabel: r.decision === 'approve' ? 'Approved' : r.decision === 'request_changes' ? 'Changes requested' : 'Unrecognised',
        note: text(r.note, ''),
      })),
      acceptance: isObject(c.acceptance) ? { id: c.acceptance.id ?? null, by: person(c.acceptance.actor, nm), review: c.acceptance.review ?? null } : null,
      dispute: isObject(c.dispute) ? { id: c.dispute.id ?? null, by: person(c.dispute.actor, nm), reason: text(c.dispute.reason, '') } : null,
      warnings,
    };
  });

  return {
    project,
    participants,
    agreements,
    delegations,
    contributions,
    head: typeof s.head === 'string' ? s.head : null,
    count: Number.isSafeInteger(s.count) ? s.count : 0,
  };
}
