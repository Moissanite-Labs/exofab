// What a person can do next, and the checks on what they type, for the
// browser client. DOM-free and pure: Node tests import this module.
//
// projectActions restates Koinos 0.1 authority rules and Exofab's hub policies
// so the page offers only actions that can succeed, and says why when one
// cannot. It decides what to offer, never what is valid: the browser's Koinos
// verifier checks every draft before signing, and the hub checks it again.
import { joinList } from './format.mjs';

// The first slice records no economic terms; every charter says so.
export const NO_ECONOMIC_RIGHT =
  'This record does not create, transfer, or promise any payment, equity, revenue share, token, or other economic right.';

export const DELEGATION_SCOPE = 'contribution.submit';
export const SKILL = /^[a-z0-9][a-z0-9+#.-]{0,47}$/;

export const CLIENT_LIMITS = Object.freeze({
  roles: 10, // hub: at most 10 roles per brief
  roleSkills: 20,
  profileSkills: 30,
  seeking: 10,
  title: 256,
  text: 8192, // Koinos text limit, in UTF-16 code units
  previewChars: 20000,
  minExpiryDays: 1,
  maxExpiryDays: 90,
  defaultExpiryDays: 14,
  artifactBytes: 4 * 1024 * 1024, // hub: stored bytes are limited to 4 MiB
});

const DAY_MS = 24 * 60 * 60 * 1000;
const REVIEWABLE = new Set(['submitted', 'changes_requested', 'reviewed']);
const LINE_CONTROL = /[\u0000-\u001f\u007f]/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);

// --- Form input ----------------------------------------------------------------------

// "Exo-Skills, testing  node.js" -> {skills: ['exo-skills', 'testing', 'node.js'], invalid: []}.
// Lowercased and de-duplicated; tokens the hub would refuse are listed in `invalid`.
export function parseSkills(value) {
  const tokens = String(value ?? '').toLowerCase().split(/[\s,]+/).filter(Boolean);
  const skills = [...new Set(tokens)];
  return { skills: skills.filter((s) => SKILL.test(s)), invalid: skills.filter((s) => !SKILL.test(s)) };
}

// One entry per non-blank line, trimmed.
export function parseLines(value) {
  return String(value ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function requiredLine(value, label, max = CLIENT_LIMITS.title) {
  const s = String(value ?? '').trim();
  if (s === '') throw new Error(`${label} cannot be empty.`);
  if (s.length > max) throw new Error(`${label} can be at most ${max} characters.`);
  if (LINE_CONTROL.test(s)) throw new Error(`${label} cannot contain control characters.`);
  return s;
}

function requiredText(value, label, max = CLIENT_LIMITS.text) {
  const s = String(value ?? '').trim();
  if (s === '') throw new Error(`${label} cannot be empty.`);
  if (s.length > max) throw new Error(`${label} can be at most ${max} characters.`);
  return s;
}

function skillList(value, label, { min = 0, max }) {
  const { skills, invalid } = parseSkills(value);
  if (invalid.length) {
    throw new Error(`${label}: ${invalid.join(', ')} ${invalid.length === 1 ? 'is' : 'are'} not valid. Use lowercase letters, digits and + # . - only.`);
  }
  if (skills.length < min) throw new Error(`${label} needs at least ${min === 1 ? 'one skill' : `${min} skills`}.`);
  if (skills.length > max) throw new Error(`${label} can list at most ${max} skills.`);
  return skills;
}

// Validates the brief form and returns the body for POST /api/briefs. A
// compensation statement is required, so no brief is silent about payment.
export function readBrief({ title, summary, compensation, roles, listed }) {
  const rows = list(roles);
  if (rows.length === 0) throw new Error('A brief needs at least one role.');
  if (rows.length > CLIENT_LIMITS.roles) throw new Error(`A brief can have at most ${CLIENT_LIMITS.roles} roles.`);
  return {
    title: requiredLine(title, 'Title'),
    summary: requiredText(summary, 'Summary'),
    compensation: requiredText(compensation, 'Compensation statement'),
    roles: rows.map((role, i) => ({
      title: requiredLine(role?.title, `Role ${i + 1} title`),
      skills: skillList(role?.skills, `Role ${i + 1} skills`, { min: 1, max: CLIENT_LIMITS.roleSkills }),
      commitment: requiredLine(role?.commitment, `Role ${i + 1} commitment`),
    })),
    listed: listed === true,
  };
}

// Validates the profile form and returns the body for PUT /api/me/profile.
export function readProfile({ name, headline, skills, seeking, listed }) {
  const lines = parseLines(seeking);
  if (lines.length > CLIENT_LIMITS.seeking) throw new Error(`List at most ${CLIENT_LIMITS.seeking} things you are seeking, one per line.`);
  for (const line of lines) if (line.length > CLIENT_LIMITS.title) throw new Error(`Each thing you are seeking can be at most ${CLIENT_LIMITS.title} characters.`);
  const head = String(headline ?? '').trim();
  if (head.length > CLIENT_LIMITS.title) throw new Error(`Headline can be at most ${CLIENT_LIMITS.title} characters.`);
  return {
    name: requiredLine(name, 'Display name'),
    headline: head,
    skills: skillList(skills, 'Skills', { max: CLIENT_LIMITS.profileSkills }),
    seeking: lines,
    listed: listed === true,
  };
}

// --- Charter ------------------------------------------------------------------------

// A starting text for the charter. People edit the scope and criteria; the
// closing statement must stay (see readProposal).
export function charterTemplate({ title, description, parties }) {
  const scope = String(description ?? '').trim() || '(What will be built or done.)';
  return `Charter

Project: ${String(title ?? '').trim() || '(project title)'}
Parties: ${joinList(list(parties).map(String)) || '(parties)'}.

Scope
${scope}

Acceptance criteria
- (How the parties will decide that a contribution is done.)
- A party who is neither the submitter nor the delegating principal reviews the exact artifact bytes before acceptance.

Credit
- An accepted contribution is recorded as credit for the submitter and, for agent work, the responsible principal. Credit is a record of accepted work, visible to the team.

${NO_ECONOMIC_RIGHT}
`;
}

// Validates the charter form. The text is kept exactly as typed: its bytes are
// what the parties read and what the digest covers.
export function readProposal({ title, parties, text, humans }) {
  const chosen = [...new Set(list(parties).map(String))];
  if (chosen.length === 0) throw new Error('Choose at least one party.');
  const allowed = new Set(list(humans));
  if (chosen.some((id) => !allowed.has(id))) throw new Error('Parties must be people listed in this project.');
  const terms = String(text ?? '');
  if (terms.trim() === '') throw new Error('The terms text cannot be empty.');
  if (!terms.includes(NO_ECONOMIC_RIGHT)) {
    throw new Error(`Keep the statement “${NO_ECONOMIC_RIGHT}” The first slice records no economic terms.`);
  }
  return { title: requiredLine(title, 'Agreement title'), parties: chosen, text: terms };
}

// --- Contributions ---------------------------------------------------------------------

// Validates the form for a party's own contribution. `size` is the chosen
// file's size in bytes, or null when no file is chosen.
export function readSubmission({ title, summary, size }) {
  const out = { title: requiredLine(title, 'Title'), summary: requiredText(summary, 'Summary') };
  if (size === null || size === undefined) throw new Error('Choose the artifact file to submit.');
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('The artifact file cannot be read.');
  if (size > CLIENT_LIMITS.artifactBytes) throw new Error(`The artifact file can be at most ${CLIENT_LIMITS.artifactBytes} bytes (4 MiB).`);
  return out;
}

// --- Delegations -----------------------------------------------------------------------

// Shown wherever the page says what an expired delegation means.
export const EXPIRED_DELEGATION = 'Its delegation has expired, so this contribution can no longer be accepted.';

// True for the hub's refusal under its policy 10: the delegation expired by
// the hub clock, whatever time the record states (src/hub/hub.mjs
// DELEGATION_EXPIRED). The page then shows EXPIRED_DELEGATION.
export function isExpiredDelegationRefusal(error) {
  return error?.status === 422 && error?.code === 'invalid' && typeof error.message === 'string' && error.message.startsWith('The delegation has expired by the hub clock');
}

export function readExpiryDays(value) {
  const days = Number(value);
  const { minExpiryDays: min, maxExpiryDays: max } = CLIENT_LIMITS;
  if (!Number.isInteger(days) || days < min || days > max) throw new Error(`Expiry must be a whole number of days from ${min} to ${max}.`);
  return days;
}

// Canonical Koinos time `days` from now.
export function expiryFrom(days, now = Date.now()) {
  return new Date(now + readExpiryDays(days) * DAY_MS).toISOString();
}

// --- Previews ------------------------------------------------------------------------

// Text of stored bytes for display: the strict UTF-8 decoding, capped. text is
// null when the bytes are not UTF-8. The caller shows it as text, never markup.
export function previewText(bytes, maxChars = CLIENT_LIMITS.previewChars) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('previewText takes a Uint8Array');
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return { text: null, truncated: false, chars: 0 };
  }
  if (text.length <= maxChars) return { text, truncated: false, chars: text.length };
  let end = maxChars;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1; // do not split a surrogate pair
  return { text: text.slice(0, end), truncated: true, chars: text.length };
}

// --- Agents --------------------------------------------------------------------------

// What an agent participant can do, said where a person decides about one.
// The hub gives every participant read access to the project and lets it
// store files there (hub policy 8), whatever its delegations, and nothing in
// this prototype removes a participant or revokes an agent's credential.
export const NOMINATION_NOTE =
  'It will be listed as an agent participant when the record starts, with you as its responsible principal. ' +
  'Only you can delegate work to it, and only under an agreement every party consented to. ' +
  'As a participant, its credential will be able to read every record and stored file of the project and store files in it, with or without a delegation. ' +
  'This prototype has no way to remove it or revoke its credential.';

export const DELEGATION_NOTE =
  'This delegation lets your agent submit contributions under this agreement until the expiry. ' +
  'As a project participant it can already read every record and stored file of this project and store files in it. ' +
  'Revoking or letting the delegation expire does not change that. ' +
  'You remain its responsible principal and can revoke the delegation at any time. ' +
  'A contribution whose delegation expires or is revoked before acceptance can never be accepted.';

export const PARTICIPANT_ACCESS_NOTE = 'Every listed participant, including agents, can read all records and stored files of this project.';

// The commands for setting up an agent: the person registers it from their own
// terminal, and the agent's runtime then submits work with its own token.
// The agent's key is created and kept there, never in the browser. Tokens are
// read at a prompt (bash or zsh), so they stay out of shell history. The
// person's session token is read and exported inside a subshell, so it
// reaches only the register command: it is gone when that command ends and is
// never inherited by the agent's runtime or anything it starts.
export function agentCommands(hubUrl) {
  const hub = String(hubUrl);
  return [
    '# On the machine where the agent runs, in an Exofab checkout: create its key (mode 0600).',
    'node src/cli.mjs keygen scribe.pem',
    '',
    '# Register it under your account. Run this once in your own terminal, not in the agent’s runtime.',
    '# Paste your session token at the prompt; it is not shown, and it is gone when the command ends.',
    `( read -rs EXOFAB_TOKEN && export EXOFAB_TOKEN && node src/cli.mjs agent register --name scribe --key scribe.pem --hub ${hub} )`,
    '',
    '# Later, as the agent, under an active delegation. Paste the agent token that register printed once.',
    'read -rs EXOFAB_AGENT_TOKEN && export EXOFAB_AGENT_TOKEN',
    `node src/cli.mjs agent submit --project PROJECT-ID --key scribe.pem --artifact FILE --title TITLE --summary SUMMARY --hub ${hub}`,
  ].join('\n');
}

// --- Project actions -------------------------------------------------------------------

// Lists what `me` may do in a project with this derived state, in page order.
// Each entry is {type, ...ids} and, when the action is shown but cannot be
// taken yet, `blocked` with the reason. myAgents: ids of agents registered
// under me (from GET /api/me). now: milliseconds.
//   propose  {}                       steward
//   consent  {agreement}              party without consent
//   withdraw {agreement}              party with consent
//   delegate {agreement, agents}      party, own agent listed; all parties consent
//   submit   {agreement}              party (own work, no delegation); all parties consent
//   revoke   {delegation}             grantor of an unrevoked delegation
//   review   {contribution}           party, neither submitter nor principal
//   accept   {contribution, review}   steward; latest review approves
//   dispute  {contribution}           party, contribution accepted
export function projectActions(state, { me, myAgents = [], now = Date.now() } = {}) {
  const s = isObject(state) ? state : {};
  const participants = list(s.participants).filter(isObject);
  const self = participants.find((p) => p.id === me);
  if (!self || self.kind !== 'human') return [];
  const out = [];
  const steward = isObject(s.project) && s.project.steward === me;
  const mine = new Set(list(myAgents));
  const agentIds = participants.filter((p) => p.kind === 'agent' && mine.has(p.id)).map((p) => p.id);
  const agreements = list(s.agreements).filter(isObject);
  const agreementById = new Map(agreements.map((a) => [a.id, a]));
  const delegationById = new Map(list(s.delegations).filter(isObject).map((d) => [d.id, d]));
  const isParty = (a) => !!a && list(a.parties).includes(me);
  const allConsent = (a) => !!a && list(a.parties).every((p) => list(a.consents).includes(p));

  if (steward) out.push({ type: 'propose' });

  for (const a of agreements) {
    if (!isParty(a)) continue;
    out.push({ type: list(a.consents).includes(me) ? 'withdraw' : 'consent', agreement: a.id });
    if (agentIds.length) {
      const entry = { type: 'delegate', agreement: a.id, agents: agentIds };
      if (!allConsent(a)) entry.blocked = 'Every party must consent to this agreement before work can be delegated under it.';
      out.push(entry);
    }
    const submit = { type: 'submit', agreement: a.id };
    if (!allConsent(a)) submit.blocked = 'Every party must consent to this agreement before work can be submitted under it.';
    out.push(submit);
  }

  for (const d of delegationById.values()) {
    if (d.principal === me && d.revoked !== true) out.push({ type: 'revoke', delegation: d.id });
  }

  for (const c of list(s.contributions).filter(isObject)) {
    const a = agreementById.get(c.agreement);
    if (isParty(a) && REVIEWABLE.has(c.status)) {
      const entry = { type: 'review', contribution: c.id };
      if (c.actor === me || c.principal === me) {
        entry.blocked = 'You submitted this contribution or delegated the work, so another party must review it.';
      }
      out.push(entry);
    }
    if (steward && c.status === 'reviewed') {
      const latest = list(c.reviews).at(-1);
      const entry = { type: 'accept', contribution: c.id, review: latest?.id ?? null };
      const d = c.delegation === null ? null : delegationById.get(c.delegation);
      if (latest?.decision !== 'approve') entry.blocked = 'The latest review does not approve this contribution.';
      else if (!allConsent(a)) entry.blocked = 'Every party to the agreement must currently consent before acceptance.';
      else if (c.delegation !== null && !d) entry.blocked = 'Its delegation is not in this history.';
      else if (d?.revoked === true) entry.blocked = 'Its delegation was revoked, so this contribution can no longer be accepted.';
      else if (d && !(Date.parse(d.expires) > now)) entry.blocked = EXPIRED_DELEGATION;
      out.push(entry);
    }
    if (isParty(a) && c.status === 'accepted') out.push({ type: 'dispute', contribution: c.id });
  }
  return out;
}

// --- Briefs ------------------------------------------------------------------------------

const briefStarted = (brief) => brief?.started === true || (typeof brief?.project === 'string' && brief.project !== '');

// Whether the viewer may express interest in a brief's open roles. `started`
// is shown to every viewer; the project id only to the team.
export function canExpressInterest(brief, { isOwner = false, isMember = false } = {}) {
  return !isOwner && !isMember && isObject(brief) && brief.status === 'open' && !briefStarted(brief);
}

// What the owner may do with a pending interest: {accept: true}, or
// {accept: false, reason}. Declining is always possible while it is pending.
export function interestDecision(interest, brief) {
  const role = list(brief?.roles).find((r) => isObject(r) && r.id === interest?.role);
  if (briefStarted(brief)) return { accept: false, reason: 'The record has started, so its participants are fixed.' };
  if (!role?.open) return { accept: false, reason: 'This role is already filled.' };
  if (brief.status !== 'open') return { accept: false, reason: 'Reopen the brief to accept anyone.' };
  return { accept: true };
}
