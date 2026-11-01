// Hub rules for the first slice: accounts, profiles, briefs, interests,
// teams, and sequencing of each project's Koinos records under the hub
// policies of docs/prototype.md. Every policy narrows Koinos 0.1; records are
// always verified by src/koinos, never by hub code.
//
// Authority comes from `auth`, which the caller resolves from a bearer token
// with authenticate(). The hub re-derives the kind and principal from its own
// state, so a forged auth object cannot widen what an identity may do.
//
// Hub state is rebuilt by replaying the hash-chained hub log on load; each
// change is validated first, then appended as an event and applied through the
// same function that replays it. Mutations are serialized by a mutex.
import {
  BUNDLE_FORMAT,
  KoinosError,
  NI_PREFIX,
  b64url,
  canonicalize,
  fromB64urlCanonical,
  hex,
  niUri,
  publicKeyBytesFromId,
  sha256Hex,
  verifyAppend,
  verifyBundle,
  verifyRecords,
  verifyText,
} from '../koinos/index.mjs';
import { isUuid, isHash } from '../koinos/fields.mjs';
import { StoreError } from './store.mjs';
import { Mutex } from './mutex.mjs';
import { HubError, conflict, forbidden, fromKoinos, invalid, notFound, tooLarge, unauthenticated } from './errors.mjs';
import { TEXT_LIMITS, bool, fields, isPlainObject, line, lines, skills, text } from './validate.mjs';

export { HubError };

const minutes = (n) => n * 60 * 1000;

export const HUB_LIMITS = Object.freeze({
  blobBytes: 4 * 1024 * 1024,
  challengeMs: minutes(5),
  pendingInterests: 50,
  roles: 10,
  roleSkills: 20,
  profileSkills: 30,
  seeking: 10,
  pastSkewMs: minutes(10),
  futureSkewMs: minutes(2),
});

// Exact texts signed by the key being registered (proof of possession).
export const personProofText = (nonce, key) => `exofab/0.1\nregister-person\n${nonce}\n${key}`;
export const agentProofText = (nonce, key, principal) => `exofab/0.1\nregister-agent\n${nonce}\n${key}\n${principal}`;

export const TOKEN_PATTERN = /^exf_[A-Za-z0-9_-]{43}$/;
const REGISTRATION = ['name', 'key', 'nonce', 'signature'];
const PROFILE = ['name', 'headline', 'skills', 'seeking', 'listed'];
const BRIEF_EDITS = ['status', 'listed', 'title', 'summary', 'compensation'];
const AGENT_LIMIT = 'Agent credentials can only read their own projects, store bytes, and submit contributions';

// A challenge nonce is base64url of 16 random bytes, the expiry (ms, 64-bit
// big-endian) and an HMAC-SHA-256 of both under a key made at load.
const NONCE_PAYLOAD = 24;
const NONCE_BYTES = NONCE_PAYLOAD + 32;
const HMAC = { name: 'HMAC', hash: 'SHA-256' };

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const defaultRandomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const isParticipant = (project, id) => project.state.participants.some((p) => p.id === id);
const pick = (source, names) => Object.fromEntries(names.filter((n) => source[n] !== undefined).map((n) => [n, source[n]]));

function uuidV4(bytes) {
  const b = new Uint8Array(bytes);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function checkKey(key) {
  try {
    publicKeyBytesFromId(key);
  } catch (error) {
    if (error instanceof KoinosError) throw invalid(`Key must be a Koinos Ed25519 key id: ${error.message}`);
    throw error;
  }
}

function roles(value) {
  if (!Array.isArray(value) || value.length === 0) throw invalid('A brief needs at least one role');
  if (value.length > HUB_LIMITS.roles) throw invalid(`A brief may have at most ${HUB_LIMITS.roles} roles`);
  return value.map((role, i) => {
    const label = `Role ${i + 1}`;
    fields(role, label, { allowed: ['title', 'skills', 'commitment'], required: ['title', 'skills', 'commitment'] });
    return {
      id: `r${i + 1}`,
      title: line(role.title, `${label} title`, { max: TEXT_LIMITS.title }),
      skills: skills(role.skills, `${label} skills`, { max: HUB_LIMITS.roleSkills, min: 1 }),
      commitment: line(role.commitment, `${label} commitment`),
    };
  });
}

// Koinos guarantees no duplicate participants, so equal length plus a match
// for each listed participant means the lists are set-equal.
function sameParticipants(listed, expected) {
  if (!Array.isArray(listed) || listed.length !== expected.length) return false;
  const want = new Map(expected.map((p) => [p.id, p]));
  return listed.every((p) => {
    const e = want.get(p?.id);
    return e !== undefined && p.name === e.name && p.kind === e.kind;
  });
}

const sharedSkills = (wanted, have) => wanted.filter((s) => have.has(s)).sort(byText);
const reasons = (shared) => shared.map((s) => `shared skill: ${s}`);

export class Hub {
  #store;
  #clock;
  #random;
  #mutex = new Mutex();
  #loading = null;
  #people = new Map(); // id -> {id, name, headline, skills, seeking, listed, registered}
  #agents = new Map(); // id -> {id, name, principal, registered}
  #briefs = new Map();
  #interests = new Map();
  #projectBriefs = new Map(); // project id -> brief id
  #tokens = new Map(); // SHA-256 of token -> {id, kind}
  #challengeKey = null; // HMAC key: outstanding challenges are not stored
  #spent = new Map(); // spent nonce -> expiry (ms), kept until it expires
  #projects = new Map(); // verified histories: pid -> {key, bundle, state}

  constructor({ store, clock = () => new Date(), randomBytes = defaultRandomBytes } = {}) {
    if (!store) throw new TypeError('Hub needs a store');
    this.#store = store;
    this.#clock = clock;
    this.#random = randomBytes;
  }

  // Loads once; every public method awaits it. A log that does not verify
  // leaves the hub unusable (fail closed).
  load() {
    this.#loading ??= this.#load();
    return this.#loading;
  }

  async #load() {
    this.#challengeKey = await globalThis.crypto.subtle.importKey('raw', this.#bytes(32), HMAC, false, ['sign', 'verify']);
    await this.#store.init();
    for (const event of await this.#store.readHubEvents()) this.#apply(event);
    const { tokens } = await this.#store.readCredentials();
    for (const [hash, entry] of Object.entries(tokens)) this.#tokens.set(hash, entry);
  }

  #bytes(n) {
    const out = this.#random(n);
    if (!(out instanceof Uint8Array) || out.length !== n) throw new TypeError('randomBytes must return a Uint8Array of the requested length');
    return out;
  }

  #now() {
    const ms = this.#clock().getTime();
    if (!Number.isFinite(ms)) throw new TypeError('clock must return a valid Date');
    return ms;
  }

  // --- Hub log ---------------------------------------------------------------------

  async #commit(author, type, body) {
    const event = await this.#store.appendHubEvent({ time: new Date(this.#now()).toISOString(), author, type, body });
    this.#apply(event);
    return event;
  }

  // Applies one verified event. Live changes are validated before they are
  // logged; on replay these checks only catch an inconsistent log.
  #apply(event) {
    const { type, author, time, body: b } = event;
    const need = (ok) => {
      if (!ok) throw new StoreError('corrupt', `Hub event ${event.seq} (${type}) is inconsistent with the events before it`);
    };
    switch (type) {
      case 'person.registered':
        need(b.id === author && !this.#keyUsed(b.id));
        this.#people.set(b.id, { id: b.id, name: b.name, headline: '', skills: [], seeking: [], listed: false, registered: time });
        return;
      case 'agent.registered':
        need(this.#people.has(author) && b.principal === author && !this.#keyUsed(b.id));
        this.#agents.set(b.id, { id: b.id, name: b.name, principal: author, registered: time });
        return;
      case 'profile.updated':
        need(this.#people.has(author));
        Object.assign(this.#people.get(author), pick(b, PROFILE));
        return;
      case 'brief.published':
        need(this.#people.has(author) && !this.#briefs.has(b.id));
        this.#briefs.set(b.id, {
          id: b.id,
          owner: author,
          title: b.title,
          summary: b.summary,
          compensation: b.compensation,
          roles: b.roles.map((r) => ({ ...r, open: true })),
          listed: b.listed,
          status: 'open',
          created: time,
          updated: time,
          team: { members: [author], agents: [] },
          project: null,
        });
        return;
      case 'brief.updated': {
        const brief = this.#briefs.get(b.id);
        need(brief?.owner === author);
        Object.assign(brief, pick(b.changes, BRIEF_EDITS), { updated: time });
        return;
      }
      case 'interest.expressed': {
        const brief = this.#briefs.get(b.brief);
        need(brief && this.#people.has(author) && brief.roles.some((r) => r.id === b.role) && !this.#interests.has(b.id));
        this.#interests.set(b.id, { id: b.id, brief: b.brief, role: b.role, candidate: author, note: b.note, status: 'pending', created: time, decided: null });
        return;
      }
      case 'interest.withdrawn': {
        const interest = this.#interests.get(b.id);
        need(interest?.candidate === author && interest.status === 'pending');
        Object.assign(interest, { status: 'withdrawn', decided: time });
        return;
      }
      case 'interest.decided': {
        const interest = this.#interests.get(b.id);
        const brief = interest && this.#briefs.get(interest.brief);
        need(brief?.owner === author && interest.status === 'pending' && ['accept', 'decline'].includes(b.decision));
        Object.assign(interest, { status: b.decision === 'accept' ? 'accepted' : 'declined', decided: time });
        if (b.decision === 'accept') {
          if (!brief.team.members.includes(interest.candidate)) brief.team.members.push(interest.candidate);
          brief.roles.find((r) => r.id === interest.role).open = false;
        }
        return;
      }
      case 'agent.nominated': {
        const brief = this.#briefs.get(b.brief);
        need(brief?.team.members.includes(author) && this.#agents.get(b.agent)?.principal === author && !brief.team.agents.includes(b.agent));
        brief.team.agents.push(b.agent);
        return;
      }
      case 'project.started': {
        const brief = this.#briefs.get(b.brief);
        need(brief?.owner === author && brief.project === null && !this.#projectBriefs.has(b.project));
        brief.project = b.project;
        this.#projectBriefs.set(b.project, b.brief);
        return;
      }
      default:
        need(false);
    }
  }

  // --- Identities and sessions -------------------------------------------------------

  #keyUsed(id) {
    return this.#people.has(id) || this.#agents.has(id);
  }

  #who(auth) {
    const id = auth?.id;
    if (typeof id === 'string') {
      if (auth.kind === 'human' && this.#people.has(id)) return { id, kind: 'human' };
      const agent = this.#agents.get(id);
      if (auth.kind === 'agent' && agent) return { id, kind: 'agent', principal: agent.principal };
    }
    throw unauthenticated();
  }

  // Social actions are for people only (hub policy 8).
  #person(auth) {
    const who = this.#who(auth);
    if (who.kind !== 'human') throw forbidden(AGENT_LIMIT);
    return this.#people.get(who.id);
  }

  async authenticate(token) {
    await this.load();
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
    const entry = this.#tokens.get(await sha256Hex(token));
    if (entry?.kind === 'human' && this.#people.has(entry.id)) return { id: entry.id, kind: 'human' };
    const agent = entry?.kind === 'agent' ? this.#agents.get(entry.id) : undefined;
    return agent ? { id: agent.id, kind: 'agent', principal: agent.principal } : null;
  }

  // Stateless, so issuing challenges never evicts one in use. Challenges made
  // before a restart no longer verify.
  async challenge() {
    await this.load();
    const expires = this.#now() + HUB_LIMITS.challengeMs;
    const payload = new Uint8Array(NONCE_PAYLOAD);
    payload.set(this.#bytes(16));
    new DataView(payload.buffer).setBigUint64(16, BigInt(expires));
    const mac = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', this.#challengeKey, payload));
    const nonce = new Uint8Array(NONCE_BYTES);
    nonce.set(payload);
    nonce.set(mac, NONCE_PAYLOAD);
    return { nonce: b64url(nonce), expires: new Date(expires).toISOString() };
  }

  // Single use: the nonce is spent even if the proof then fails. A spent
  // nonce is remembered until it expires; after that its expiry refuses it.
  async #spendChallenge(nonce) {
    let bytes = null;
    try {
      bytes = fromB64urlCanonical(nonce, NONCE_BYTES);
    } catch {
      bytes = null;
    }
    const payload = bytes?.subarray(0, NONCE_PAYLOAD);
    const issued = bytes !== null && (await globalThis.crypto.subtle.verify('HMAC', this.#challengeKey, bytes.subarray(NONCE_PAYLOAD), payload));
    const now = this.#now();
    // Spent nonces are in spending order; each expires within challengeMs of being spent.
    for (const [spent, expires] of this.#spent) {
      if (expires > now) break;
      this.#spent.delete(spent);
    }
    if (!issued || this.#spent.has(nonce)) throw invalid('Challenge is unknown or already used; request a new one');
    const expires = Number(new DataView(payload.buffer, payload.byteOffset).getBigUint64(16));
    if (now >= expires) throw invalid('Challenge has expired; request a new one');
    this.#spent.set(nonce, expires);
  }

  // The token is returned once; only its SHA-256 is stored.
  async #issueToken(id, kind) {
    const token = `exf_${b64url(this.#bytes(32))}`;
    const hash = await sha256Hex(token);
    await this.#store.putCredential(hash, { id, kind });
    this.#tokens.set(hash, { id, kind });
    return token;
  }

  async #register(input, proofText) {
    const { name, key, nonce, signature } = fields(input, 'Registration', { allowed: REGISTRATION, required: REGISTRATION });
    line(name, 'Name', { max: TEXT_LIMITS.name });
    checkKey(key);
    await this.#spendChallenge(nonce);
    if (!(await verifyText(key, proofText(nonce, key), signature))) throw unauthenticated('Proof of key possession does not verify');
    return { name, key };
  }

  async registerPerson(input) {
    await this.load();
    const { name, key } = await this.#register(input, personProofText);
    return this.#mutex.run(async () => {
      if (this.#keyUsed(key)) throw conflict('This key is already registered');
      const token = await this.#issueToken(key, 'human');
      await this.#commit(key, 'person.registered', { id: key, name });
      return { person: this.#selfView(key), token };
    });
  }

  async registerAgent(auth, input) {
    await this.load();
    const principal = this.#person(auth);
    const { name, key } = await this.#register(input, (nonce, k) => agentProofText(nonce, k, principal.id));
    return this.#mutex.run(async () => {
      if (this.#keyUsed(key)) throw conflict('This key is already registered');
      const token = await this.#issueToken(key, 'agent');
      await this.#commit(principal.id, 'agent.registered', { id: key, name, principal: principal.id });
      return { agent: this.#agentView(this.#agents.get(key)), token };
    });
  }

  // --- Profiles ---------------------------------------------------------------------

  #publicPerson(p) {
    return { id: p.id, kind: 'human', name: p.name, headline: p.headline, skills: [...p.skills], seeking: [...p.seeking], listed: p.listed };
  }

  #selfView(id) {
    const agents = [...this.#agents.values()].filter((a) => a.principal === id).map((a) => ({ id: a.id, name: a.name }));
    return { ...this.#publicPerson(this.#people.get(id)), agents };
  }

  #agentView(agent) {
    return { id: agent.id, kind: 'agent', name: agent.name, principal: agent.principal };
  }

  async me(auth) {
    await this.load();
    const who = this.#who(auth);
    return who.kind === 'human' ? this.#selfView(who.id) : this.#agentView(this.#agents.get(who.id));
  }

  async updateProfile(auth, input) {
    await this.load();
    const me = this.#person(auth);
    fields(input, 'Profile', { allowed: PROFILE });
    const changes = {};
    if (input.name !== undefined) changes.name = line(input.name, 'Name', { max: TEXT_LIMITS.name });
    if (input.headline !== undefined) changes.headline = line(input.headline, 'Headline', { optional: true });
    if (input.skills !== undefined) changes.skills = skills(input.skills, 'Skills', { max: HUB_LIMITS.profileSkills });
    if (input.seeking !== undefined) changes.seeking = lines(input.seeking, 'Seeking', { max: HUB_LIMITS.seeking });
    if (input.listed !== undefined) changes.listed = bool(input.listed, 'Listed');
    if (Object.keys(changes).length === 0) throw invalid('A profile update needs at least one field');
    return this.#mutex.run(async () => {
      const profile = { ...pick(this.#people.get(me.id), PROFILE), ...changes };
      await this.#commit(me.id, 'profile.updated', profile);
      return this.#selfView(me.id);
    });
  }

  // Visible to oneself, to everyone when listed, and to people who already
  // deal with each other on this hub: brief owner and candidate, teammates.
  // Co-participants of an imported history do not count: its genesis is
  // signed by one person and needs no consent from the others it names.
  #canSeePerson(viewer, id) {
    const person = this.#people.get(id);
    if (!person) return false;
    if (viewer === id || person.listed) return true;
    for (const brief of this.#briefs.values()) {
      if (brief.team.members.includes(viewer) && brief.team.members.includes(id)) return true;
    }
    for (const i of this.#interests.values()) {
      const owner = this.#briefs.get(i.brief).owner;
      if ((owner === viewer && i.candidate === id) || (owner === id && i.candidate === viewer)) return true;
    }
    return false;
  }

  async getPerson(auth, id) {
    await this.load();
    const me = this.#person(auth);
    if (typeof id !== 'string' || !this.#canSeePerson(me.id, id)) throw notFound('Person not found');
    return id === me.id ? this.#selfView(id) : this.#publicPerson(this.#people.get(id));
  }

  async listPeople(auth) {
    await this.load();
    this.#person(auth);
    return [...this.#people.values()]
      .filter((p) => p.listed)
      .sort((a, b) => byText(a.name, b.name) || byText(a.id, b.id))
      .map((p) => this.#publicPerson(p));
  }

  // --- Briefs -----------------------------------------------------------------------

  #isMember(brief, id) {
    return brief.team.members.includes(id);
  }

  #interestsOn(briefId) {
    return [...this.#interests.values()].filter((i) => i.brief === briefId);
  }

  #canSeeBrief(brief, id) {
    return brief.listed || this.#isMember(brief, id) || this.#interestsOn(brief.id).some((i) => i.candidate === id);
  }

  // Hidden briefs answer "not found" so their existence is not revealed.
  #visibleBrief(me, id) {
    const brief = typeof id === 'string' ? this.#briefs.get(id) : undefined;
    if (!brief || !this.#canSeeBrief(brief, me.id)) throw notFound('Brief not found');
    return brief;
  }

  #ownedBrief(me, id) {
    const brief = this.#visibleBrief(me, id);
    if (brief.owner !== me.id) throw forbidden('Only the brief owner can do this');
    return brief;
  }

  #interestView(i) {
    return { ...i, candidateName: this.#people.get(i.candidate).name };
  }

  // Everyone who can see a brief sees its text and roles. The team and project
  // are shown to team members; interests to the owner (all) and each
  // candidate (their own).
  #briefView(brief, viewer) {
    const view = {
      id: brief.id,
      owner: brief.owner,
      title: brief.title,
      summary: brief.summary,
      compensation: brief.compensation,
      roles: brief.roles.map((r) => ({ ...r, skills: [...r.skills] })),
      listed: brief.listed,
      status: brief.status,
      created: brief.created,
      updated: brief.updated,
    };
    if (this.#isMember(brief, viewer)) {
      view.team = { members: [...brief.team.members], agents: [...brief.team.agents] };
      view.project = brief.project;
    }
    const interests = this.#interestsOn(brief.id).filter((i) => brief.owner === viewer || i.candidate === viewer);
    if (brief.owner === viewer || interests.length) view.interests = interests.map((i) => this.#interestView(i));
    return view;
  }

  async publishBrief(auth, input) {
    await this.load();
    const me = this.#person(auth);
    fields(input, 'Brief', { allowed: ['title', 'summary', 'compensation', 'roles', 'listed'], required: ['title', 'summary', 'roles'] });
    // Required so that no brief is ambiguous about payment (spec-work risk).
    if (input.compensation === undefined) throw invalid('A brief must state whether any compensation is offered, even if none is');
    const body = {
      id: `brf_${hex(this.#bytes(8))}`,
      title: line(input.title, 'Title', { max: TEXT_LIMITS.title }),
      summary: text(input.summary, 'Summary'),
      compensation: text(input.compensation, 'Compensation statement'),
      roles: roles(input.roles),
      listed: input.listed === undefined ? false : bool(input.listed, 'Listed'),
    };
    return this.#mutex.run(async () => {
      if (this.#briefs.has(body.id)) throw conflict('Brief id collision; try again');
      await this.#commit(me.id, 'brief.published', body);
      return this.#briefView(this.#briefs.get(body.id), me.id);
    });
  }

  async updateBrief(auth, id, input) {
    await this.load();
    const me = this.#person(auth);
    fields(input, 'Brief update', { allowed: BRIEF_EDITS });
    const changes = {};
    if (input.status !== undefined) {
      if (input.status !== 'open' && input.status !== 'closed') throw invalid('Status must be open or closed');
      changes.status = input.status;
    }
    if (input.listed !== undefined) changes.listed = bool(input.listed, 'Listed');
    if (input.title !== undefined) changes.title = line(input.title, 'Title', { max: TEXT_LIMITS.title });
    if (input.summary !== undefined) changes.summary = text(input.summary, 'Summary');
    if (input.compensation !== undefined) changes.compensation = text(input.compensation, 'Compensation statement');
    if (Object.keys(changes).length === 0) throw invalid('A brief update needs at least one field');
    return this.#mutex.run(async () => {
      const brief = this.#ownedBrief(me, id);
      if (brief.project && ['title', 'summary', 'compensation'].some((k) => k in changes)) {
        throw conflict('The record has started; only the status and listing of this brief can change');
      }
      await this.#commit(me.id, 'brief.updated', { id: brief.id, changes });
      return this.#briefView(brief, me.id);
    });
  }

  async listBriefs(auth) {
    await this.load();
    const me = this.#person(auth);
    return [...this.#briefs.values()]
      .filter((b) => this.#isMember(b, me.id) || (b.listed && b.status === 'open'))
      .sort((a, b) => byText(b.created, a.created) || byText(a.id, b.id))
      .map((b) => this.#briefView(b, me.id));
  }

  async getBrief(auth, id) {
    await this.load();
    const me = this.#person(auth);
    return this.#briefView(this.#visibleBrief(me, id), me.id);
  }

  // --- Suggestions: declared skills only, a reason for each, never a score ------------

  async suggestions(auth) {
    await this.load();
    const me = this.#person(auth);
    const have = new Set(me.skills);
    const out = [];
    for (const brief of this.#briefs.values()) {
      if (!brief.listed || brief.status !== 'open' || brief.project || this.#isMember(brief, me.id)) continue;
      for (const role of brief.roles) {
        const shared = role.open ? sharedSkills(role.skills, have) : [];
        if (shared.length === 0) continue;
        out.push({
          brief: { id: brief.id, title: brief.title, summary: brief.summary, owner: brief.owner },
          role: { id: role.id, title: role.title },
          reasons: reasons(shared),
        });
      }
    }
    // Neutral order (no ranking): by title, not by how many skills are shared.
    return out.sort(
      (a, b) =>
        byText(a.brief.title, b.brief.title) ||
        byText(a.role.title, b.role.title) ||
        byText(a.brief.id, b.brief.id) ||
        byText(a.role.id, b.role.id),
    );
  }

  async briefSuggestions(auth, briefId) {
    await this.load();
    const me = this.#person(auth);
    const brief = this.#ownedBrief(me, briefId);
    const out = [];
    for (const person of this.#people.values()) {
      if (!person.listed || this.#isMember(brief, person.id)) continue;
      const have = new Set(person.skills);
      for (const role of brief.roles) {
        const shared = role.open ? sharedSkills(role.skills, have) : [];
        if (shared.length === 0) continue;
        out.push({
          person: { id: person.id, name: person.name, headline: person.headline },
          role: { id: role.id, title: role.title },
          reasons: reasons(shared),
        });
      }
    }
    // Neutral order (no ranking): by name, not by how many skills are shared.
    return out.sort(
      (a, b) =>
        byText(a.person.name, b.person.name) ||
        byText(a.role.title, b.role.title) ||
        byText(a.person.id, b.person.id) ||
        byText(a.role.id, b.role.id),
    );
  }

  // --- Interests and teams: a double opt-in ----------------------------------------------

  async expressInterest(auth, briefId, input) {
    await this.load();
    const me = this.#person(auth);
    fields(input, 'Interest', { allowed: ['role', 'note'], required: ['role'] });
    const note = input.note === undefined ? '' : text(input.note, 'Note', { optional: true });
    return this.#mutex.run(async () => {
      const brief = this.#visibleBrief(me, briefId);
      if (brief.owner === me.id) throw forbidden('You cannot express interest in your own brief');
      if (brief.project) throw conflict('This brief has already started its record');
      if (brief.status !== 'open') throw conflict('This brief is closed');
      if (this.#isMember(brief, me.id)) throw conflict('You are already on this team');
      const role = brief.roles.find((r) => r.id === input.role);
      if (!role) throw invalid('That role is not part of this brief');
      if (!role.open) throw conflict('That role is already filled');
      const pending = this.#interestsOn(brief.id).filter((i) => i.status === 'pending');
      if (pending.some((i) => i.candidate === me.id && i.role === role.id)) throw conflict('You already have a pending interest in this role');
      if (pending.length >= HUB_LIMITS.pendingInterests) {
        throw conflict(`This brief already has ${HUB_LIMITS.pendingInterests} pending interests; try again later`);
      }
      const body = { id: `int_${hex(this.#bytes(8))}`, brief: brief.id, role: role.id, note };
      if (this.#interests.has(body.id)) throw conflict('Interest id collision; try again');
      await this.#commit(me.id, 'interest.expressed', body);
      return this.#interestView(this.#interests.get(body.id));
    });
  }

  // Interests are visible only to their candidate and the brief owner.
  #visibleInterest(me, id) {
    const interest = typeof id === 'string' ? this.#interests.get(id) : undefined;
    const brief = interest && this.#briefs.get(interest.brief);
    if (!interest || (interest.candidate !== me.id && brief.owner !== me.id)) throw notFound('Interest not found');
    return { interest, brief };
  }

  async withdrawInterest(auth, interestId) {
    await this.load();
    const me = this.#person(auth);
    return this.#mutex.run(async () => {
      const { interest } = this.#visibleInterest(me, interestId);
      if (interest.candidate !== me.id) throw forbidden('Only the candidate can withdraw an interest');
      if (interest.status !== 'pending') throw conflict(`This interest is already ${interest.status}`);
      await this.#commit(me.id, 'interest.withdrawn', { id: interest.id });
      return this.#interestView(interest);
    });
  }

  async decideInterest(auth, interestId, input) {
    await this.load();
    const me = this.#person(auth);
    fields(input, 'Decision', { allowed: ['decision'], required: ['decision'] });
    if (input.decision !== 'accept' && input.decision !== 'decline') throw invalid('Decision must be accept or decline');
    return this.#mutex.run(async () => {
      const { interest, brief } = this.#visibleInterest(me, interestId);
      if (brief.owner !== me.id) throw forbidden('Only the brief owner can accept or decline an interest');
      if (interest.status !== 'pending') throw conflict(`This interest is already ${interest.status}`);
      if (input.decision === 'accept') {
        if (brief.project) throw conflict('The record has started; its participants are fixed');
        if (brief.status !== 'open') throw conflict('Reopen the brief before accepting anyone');
        if (!brief.roles.find((r) => r.id === interest.role).open) throw conflict('That role is already filled');
      }
      await this.#commit(me.id, 'interest.decided', { id: interest.id, decision: input.decision });
      return this.#interestView(interest);
    });
  }

  async nominateAgent(auth, briefId, input) {
    await this.load();
    const me = this.#person(auth);
    fields(input, 'Nomination', { allowed: ['agent'], required: ['agent'] });
    return this.#mutex.run(async () => {
      const brief = this.#visibleBrief(me, briefId);
      if (!this.#isMember(brief, me.id)) throw forbidden('Only team members can nominate an agent');
      const agent = typeof input.agent === 'string' ? this.#agents.get(input.agent) : undefined;
      if (agent?.principal !== me.id) throw forbidden('You can nominate only an agent registered under your own account');
      if (brief.project) throw conflict('The record has started; its participants are fixed');
      if (brief.team.agents.includes(agent.id)) throw conflict('This agent is already nominated');
      await this.#commit(me.id, 'agent.nominated', { brief: brief.id, agent: agent.id });
      return this.#briefView(brief, me.id);
    });
  }

  // --- Starting the record (hub policy 4) -----------------------------------------------

  // People first (owner, then accepted candidates), then nominated agents,
  // each with the name it was registered under.
  #team(brief) {
    if (brief.team.members.length < 2) {
      throw invalid(
        'A project needs at least two people on the team, because Koinos acceptance needs a reviewer who is neither ' +
          'the submitter nor the delegating principal. Accept someone’s interest first.',
      );
    }
    return [
      ...brief.team.members.map((id) => ({ id, name: this.#people.get(id).name, kind: 'human' })),
      ...brief.team.agents.map((id) => ({ id, name: this.#agents.get(id).name, kind: 'agent' })),
    ];
  }

  async genesisDraft(auth, briefId) {
    await this.load();
    const me = this.#person(auth);
    const brief = this.#ownedBrief(me, briefId);
    if (brief.project) throw conflict('This brief has already started its record');
    const participants = this.#team(brief);
    return { project: uuidV4(this.#bytes(16)), body: { title: brief.title, description: brief.summary, participants } };
  }

  async startProject(auth, briefId, record) {
    await this.load();
    const me = this.#person(auth);
    return this.#mutex.run(async () => {
      const brief = this.#ownedBrief(me, briefId);
      if (brief.project) throw conflict('This brief has already started its record');
      const team = this.#team(brief);
      if (!isPlainObject(record)) throw invalid('The genesis record must be a JSON object');
      if (record.actor !== me.id) throw forbidden('The genesis record must be signed by you, the brief owner');
      let state;
      try {
        state = await verifyRecords([record]);
      } catch (error) {
        throw fromKoinos(error);
      }
      this.#checkTime(record.time);
      if (!sameParticipants(record.body.participants, team)) {
        throw invalid('The genesis participants must be exactly the team (people and nominated agents) with their registered names and kinds');
      }
      const pid = state.project.id;
      const pins = await this.#store.readPins();
      if (this.#projectBriefs.has(pid) || pins[pid] !== undefined || (await this.#store.readBundle(pid)) !== null) {
        throw conflict('That project id is already in use; request a new genesis draft');
      }
      await this.#store.writeBundle(pid, { format: BUNDLE_FORMAT, records: [record] });
      await this.#store.writePin(pid, state.head);
      await this.#commit(me.id, 'project.started', { brief: brief.id, project: pid, head: state.head });
      return { project: pid, head: state.head, count: state.count };
    });
  }

  // --- Project records -------------------------------------------------------------------

  // A record's time must be close to the hub clock (hub policy 3); Koinos
  // separately requires it to be no earlier than the previous record.
  #checkTime(time) {
    const t = Date.parse(time);
    const now = this.#now();
    if (!(t >= now - HUB_LIMITS.pastSkewMs && t <= now + HUB_LIMITS.futureSkewMs)) {
      throw invalid(`Record time must be within ten minutes before and two minutes after the hub clock (${new Date(now).toISOString()})`);
    }
  }

  // The verified history of a project, or null. Results are cached by the
  // exact stored content, so a changed file is always verified again.
  async #project(pid) {
    if (!isUuid(pid)) return null;
    const bundle = await this.#store.readBundle(pid);
    if (!bundle) return null;
    try {
      const key = canonicalize(bundle);
      const cached = this.#projects.get(pid);
      if (cached?.key === key) return cached;
      const entry = { key, bundle, state: await verifyBundle(bundle, { expectedProject: pid }) };
      this.#projects.set(pid, entry);
      return entry;
    } catch (error) {
      if (!(error instanceof KoinosError)) throw error;
      throw new StoreError('corrupt', `Stored history of project ${pid} does not verify: ${error.message}`, { cause: error });
    }
  }

  async #allProjects() {
    const out = [];
    for (const pid of await this.#store.listProjects()) {
      const entry = await this.#project(pid);
      if (entry) out.push({ pid, ...entry });
    }
    return out;
  }

  // Non-participants get "not found" (hub policy 9).
  async #participantProject(who, pid) {
    const entry = await this.#project(pid);
    if (!entry || !isParticipant(entry, who.id)) throw notFound('Project not found');
    return entry;
  }

  async #requireStoredBlob(pid, uri, digest, label) {
    if (uri !== niUri(digest)) throw invalid(`${label} must be cited by the URI ${NI_PREFIX}<base64url digest> of its digest`);
    const stored = (await this.#store.readProjectBlobs(pid)).includes(digest) && (await this.#store.getBlob(digest)) !== null;
    if (!stored) throw invalid(`${label} bytes must be stored in this project before a record cites them`);
  }

  async appendRecord(auth, pid, record) {
    await this.load();
    const who = this.#who(auth);
    return this.#mutex.run(async () => {
      const { bundle, state: current } = await this.#participantProject(who, pid);
      if (!isPlainObject(record)) throw invalid('A record must be a JSON object');
      if (who.kind === 'agent' && record.kind !== 'contribution.submitted') throw forbidden(AGENT_LIMIT); // policy 8
      if (record.actor !== who.id) throw forbidden('The record actor must be the signed-in identity'); // policy 1
      if ((typeof record.previous === 'string' || record.previous === null) && record.previous !== current.head) {
        throw conflict('The project head has moved; rebuild the record on the current head and sign again', {
          head: current.head,
          sequence: current.count,
        }); // policy 2
      }
      let state;
      try {
        state = await verifyAppend(bundle.records, record, { expectedProject: pid });
      } catch (error) {
        if (error instanceof KoinosError && error.index < bundle.records.length) {
          throw new StoreError('corrupt', `Stored history of project ${pid} does not verify: ${error.message}`, { cause: error });
        }
        throw fromKoinos(error);
      }
      this.#checkTime(record.time); // policy 3
      const b = record.body;
      if (record.kind === 'agreement.proposed') await this.#requireStoredBlob(pid, b.uri, b.digest, 'Agreement terms'); // policy 5
      if (record.kind === 'contribution.submitted') {
        await this.#requireStoredBlob(pid, b.artifact.uri, b.artifact.digest, 'Contribution artifact'); // policy 6
      }
      if (record.kind === 'delegation.granted' && this.#agents.get(b.agent)?.principal !== who.id) {
        throw forbidden('You can delegate only to an agent registered under your own account'); // policy 7
      }
      await this.#store.writeBundle(pid, { format: BUNDLE_FORMAT, records: [...bundle.records, record] });
      await this.#store.writePin(pid, state.head);
      return { head: state.head, count: state.count, state };
    });
  }

  async listProjects(auth) {
    await this.load();
    const who = this.#who(auth);
    const out = [];
    for (const { pid, state } of await this.#allProjects()) {
      const me = state.participants.find((p) => p.id === who.id);
      if (!me) continue;
      const role = state.project.steward === who.id ? 'steward' : me.kind === 'agent' ? 'agent' : 'participant';
      out.push({ project: pid, title: state.project.title, brief: this.#projectBriefs.get(pid) ?? null, head: state.head, count: state.count, role });
    }
    return out.sort((a, b) => byText(a.title, b.title) || byText(a.project, b.project));
  }

  async getProject(auth, pid) {
    await this.load();
    const who = this.#who(auth);
    const { key, state } = await this.#participantProject(who, pid);
    return {
      project: pid,
      brief: this.#projectBriefs.get(pid) ?? null,
      head: state.head,
      count: state.count,
      state: structuredClone(state),
      records: JSON.parse(key).records,
      viewer: {
        id: who.id,
        steward: state.project.steward === who.id,
        party: state.agreements.some((a) => a.parties.includes(who.id)),
      },
    };
  }

  async getBundle(auth, pid) {
    await this.load();
    const { key } = await this.#participantProject(this.#who(auth), pid);
    return JSON.parse(key);
  }

  // --- Stored bytes (hub policies 5, 6 and 9) -----------------------------------------------

  async putBlob(auth, pid, bytes) {
    await this.load();
    await this.#participantProject(this.#who(auth), pid);
    if (!(bytes instanceof Uint8Array)) throw invalid('Stored bytes must be a byte array');
    if (bytes.length > HUB_LIMITS.blobBytes) throw tooLarge(`Stored bytes are limited to ${HUB_LIMITS.blobBytes} bytes`);
    const { digest, size } = await this.#store.putBlob(bytes);
    await this.#store.linkBlob(pid, digest);
    return { digest, uri: niUri(digest), size };
  }

  // Readable by participants only when the bytes were stored for this
  // project. Citing a digest is not enough: an imported history can cite any
  // digest, including one stored for another project.
  async getBlob(auth, pid, digest) {
    await this.load();
    await this.#participantProject(this.#who(auth), pid);
    if (!isHash(digest)) throw invalid('Digest must be 64 lowercase hexadecimal characters');
    const allowed = (await this.#store.readProjectBlobs(pid)).includes(digest);
    const bytes = allowed ? await this.#store.getBlob(digest) : null;
    if (!bytes) throw notFound('Stored bytes not found');
    return bytes;
  }

  // --- Credit: accepted work, visible within shared projects only ---------------------------

  async credit(auth, personId) {
    await this.load();
    const me = this.#person(auth);
    if (typeof personId !== 'string' || !this.#canSeePerson(me.id, personId)) throw notFound('Person not found');
    const out = [];
    for (const { pid, bundle, state } of await this.#allProjects()) {
      if (!isParticipant({ state }, me.id)) continue;
      for (const c of state.contributions) {
        // Koinos attribution only: the principal derived from the signed records
        // (the submitter, or the person who delegated to the submitting agent).
        if (c.status !== 'accepted' || c.principal !== personId) continue;
        out.push({
          project: pid,
          projectTitle: state.project.title,
          contribution: { id: c.id, title: c.title, summary: c.summary, artifact: { ...c.artifact } },
          acceptedAt: bundle.records.find((r) => r.id === c.acceptance.id).time,
          via: c.actor === c.principal ? null : c.actor,
        });
      }
    }
    return out.sort((a, b) => byText(a.acceptedAt, b.acceptedAt) || byText(a.contribution.id, b.contribution.id));
  }

  // --- Import (command line; not exposed over HTTP) ---------------------------------------

  // Stores a bundle that Koinos verifies, unchanged, so attribution is kept.
  // Refuses a history that does not extend what the hub already holds.
  // `registered` lists identities registered here that a history not started
  // on this hub names as participants: the project appears in their lists
  // although they never agreed to it on this hub.
  async importBundle(bundle, { expectedHead } = {}) {
    await this.load();
    let state;
    try {
      state = await verifyBundle(bundle, expectedHead === undefined ? {} : { expectedHead });
    } catch (error) {
      throw fromKoinos(error);
    }
    const copy = JSON.parse(canonicalize(bundle));
    const pid = state.project.id;
    const result = { project: pid, head: state.head, count: state.count };
    const registered = this.#projectBriefs.has(pid) ? [] : state.participants.filter((p) => this.#keyUsed(p.id)).map((p) => p.id);
    if (registered.length) result.registered = registered;
    return this.#mutex.run(async () => {
      const stored = await this.#store.readBundle(pid);
      if (stored) {
        const n = stored.records.length;
        const extendsStored =
          n <= copy.records.length && stored.records.every((r, i) => canonicalize(r) === canonicalize(copy.records[i]));
        if (!extendsStored) {
          throw conflict('This hub holds a history of the project that the bundle does not extend', {
            head: stored.records.at(-1).id,
            sequence: n,
          });
        }
        if (n === copy.records.length) return { ...result, imported: false };
      }
      await this.#store.writeBundle(pid, copy);
      await this.#store.writePin(pid, state.head);
      return { ...result, imported: true };
    });
  }
}
