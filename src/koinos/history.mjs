// Replays a Koinos 0.1 history one record at a time. Each append checks the
// envelope, chain, id, signature and the authority rules of the record's kind,
// then updates the derived state. Every check runs before any mutation, so a
// rejected record leaves the history unchanged.
import { KoinosError, fail } from './errors.mjs';
import { canonicalize, LIMITS } from './canonical.mjs';
import { sha256Hex, publicKeyBytesFromId, verifyText } from './crypto.mjs';
import { fromB64urlCanonical } from './encoding.mjs';
import { isUuid, isHash, exactFields, checkTime, checkText, checkUri, checkHash } from './fields.mjs';

export const PROTOCOL = 'koinos/0.1';
export const KINDS = Object.freeze([
  'project.created',
  'agreement.proposed',
  'agreement.consented',
  'agreement.withdrawn',
  'delegation.granted',
  'delegation.revoked',
  'contribution.submitted',
  'contribution.reviewed',
  'contribution.accepted',
  'contribution.disputed',
]);
export const UNSIGNED_FIELDS = ['protocol', 'project', 'sequence', 'previous', 'time', 'actor', 'kind', 'body', 'id'];
const RECORD_FIELDS = [...UNSIGNED_FIELDS, 'signature'];
const SCOPE = 'contribution.submit';
const REVIEWABLE = new Set(['submitted', 'changes_requested', 'reviewed']);

export const signingText = (id) => `${PROTOCOL}\n${id}`;

// SHA-256 of the canonical envelope without id and signature (ignored if present).
export async function recordId(envelope) {
  const { id, signature, ...unsigned } = envelope;
  return sha256Hex(canonicalize(unsigned));
}

function lookup(map, ref, label) {
  const found = map.get(ref);
  if (!found) fail('reference', `${label} must reference an earlier ${label} record in this project`);
  return found;
}

export class History {
  #participants = new Map();
  #agreements = new Map();
  #delegations = new Map();
  #contributions = new Map();
  #lastTime = '';
  // Derived state, in exactly the shape and order the Koinos reference returns.
  state = { project: null, participants: [], agreements: [], delegations: [], contributions: [], head: null, count: 0 };

  snapshot() {
    return structuredClone(this.state);
  }

  // signed: false checks an unsigned draft (with id, without signature).
  async append(record, { signed = true } = {}) {
    const index = this.state.count;
    try {
      await this.#append(record, signed);
    } catch (error) {
      if (error instanceof KoinosError && error.index === undefined) {
        error.index = index;
        error.message = `Record ${index}: ${error.message}`;
      }
      throw error;
    }
  }

  async #append(r, signed) {
    exactFields(r, signed ? RECORD_FIELDS : UNSIGNED_FIELDS, 'envelope', 'Record');
    if (r.protocol !== PROTOCOL) fail('envelope', `Unsupported protocol; expected ${PROTOCOL}`);
    if (!isUuid(r.project)) fail('project', 'Project id must be a lowercase UUID');
    if (this.state.project && r.project !== this.state.project.id) fail('project', 'Record belongs to another project');
    if (r.sequence !== this.state.count) fail('chain', `Expected sequence ${this.state.count}`);
    if (r.previous !== this.state.head) fail('chain', 'previous must be the id of the preceding record (null at genesis)');
    checkTime(r.time, 'time');
    if (r.time < this.#lastTime) fail('time', 'Record time is earlier than the preceding record');
    if (!KINDS.includes(r.kind)) fail('kind', 'Unsupported record kind');
    if (this.state.count === 0 && r.kind !== 'project.created') fail('chain', 'Genesis must be project.created');
    if (this.state.count > 0 && r.kind === 'project.created') fail('chain', 'Only genesis may be project.created');
    if (!isHash(r.id) || (await recordId(r)) !== r.id) fail('id', 'Record id does not match its content');
    publicKeyBytesFromId(r.actor);
    if (signed) {
      try {
        fromB64urlCanonical(r.signature, 64);
      } catch {
        fail('signature', 'Signature must be canonical unpadded base64url of 64 bytes');
      }
      if (!(await verifyText(r.actor, signingText(r.id), r.signature))) fail('signature', 'Signature does not verify');
    }
    const commit = this.#rules(r);
    commit();
    this.state.head = r.id;
    this.state.count += 1;
    this.#lastTime = r.time;
  }

  // Returns a function that applies the record once every check has passed.
  #rules(r) {
    const b = r.body;
    const signer = this.#participants.get(r.actor);
    const human = () => {
      if (signer?.kind !== 'human') fail('authority', 'Signer must be a human participant');
    };
    const steward = () => {
      human();
      if (r.actor !== this.state.project.steward) fail('authority', 'Only the steward may sign this record');
    };
    const party = (a) => {
      human();
      if (!a.parties.includes(r.actor)) fail('authority', 'Signer must be a party to the agreement');
    };
    const allConsent = (a) => {
      if (!a.parties.every((p) => a.consents.includes(p))) fail('state', 'Every agreement party must currently consent');
    };
    // An agent's grant must be its own, for this agreement, unrevoked and
    // unexpired at this record's time. Expiry is reached at `expires` itself.
    const activeGrant = (d, a, agent) => {
      if (d.agent !== agent) fail('authority', 'Delegation was granted to another agent');
      if (d.agreement !== a.id) fail('authority', 'Delegation is for another agreement');
      if (d.revoked) fail('authority', 'Delegation is revoked');
      if (r.time >= d.expires) fail('authority', 'Delegation has expired');
      if (!a.consents.includes(d.principal)) fail('state', 'Principal no longer consents');
    };
    const agreement = (ref) => lookup(this.#agreements, ref, 'agreement');
    const contribution = (ref) => lookup(this.#contributions, ref, 'contribution');
    const body = (names) => exactFields(b, names, 'body', `${r.kind} body`);

    switch (r.kind) {
      case 'project.created': {
        body(['title', 'description', 'participants']);
        checkText(b.title, 'title', LIMITS.title);
        checkText(b.description, 'description', LIMITS.text);
        if (!Array.isArray(b.participants) || b.participants.length === 0) fail('field', 'participants must be a non-empty array');
        if (b.participants.length > LIMITS.participants) fail('limits', `More than ${LIMITS.participants} participants`);
        const listed = new Map();
        for (const p of b.participants) {
          exactFields(p, ['id', 'name', 'kind'], 'body', 'Participant');
          publicKeyBytesFromId(p.id);
          checkText(p.name, 'participant name', LIMITS.title);
          if (p.kind !== 'human' && p.kind !== 'agent') fail('field', 'Participant kind must be human or agent');
          if (listed.has(p.id)) fail('field', 'Duplicate participant');
          listed.set(p.id, { id: p.id, name: p.name, kind: p.kind });
        }
        if (listed.get(r.actor)?.kind !== 'human') fail('authority', 'Genesis must be signed by a listed human, who becomes steward');
        return () => {
          for (const p of listed.values()) {
            this.#participants.set(p.id, p);
            this.state.participants.push(p);
          }
          this.state.project = { id: r.project, title: b.title, description: b.description, steward: r.actor };
        };
      }

      case 'agreement.proposed': {
        body(['title', 'uri', 'digest', 'parties']);
        steward();
        checkText(b.title, 'title', LIMITS.title);
        checkUri(b.uri, 'uri');
        checkHash(b.digest, 'digest');
        if (!Array.isArray(b.parties) || b.parties.length === 0) fail('field', 'parties must be a non-empty array');
        if (new Set(b.parties).size !== b.parties.length) fail('field', 'Duplicate agreement party');
        for (const p of b.parties) {
          if (this.#participants.get(p)?.kind !== 'human') fail('reference', 'Agreement parties must be human participants');
        }
        return () => {
          const a = { id: r.id, title: b.title, uri: b.uri, digest: b.digest, parties: [...b.parties], consents: [] };
          this.#agreements.set(r.id, a);
          this.state.agreements.push(a);
        };
      }

      case 'agreement.consented': {
        body(['agreement']);
        const a = agreement(b.agreement);
        party(a);
        if (a.consents.includes(r.actor)) fail('state', 'Party already consents');
        return () => a.consents.push(r.actor);
      }

      case 'agreement.withdrawn': {
        body(['agreement', 'reason']);
        const a = agreement(b.agreement);
        party(a);
        checkText(b.reason, 'reason', LIMITS.text);
        if (!a.consents.includes(r.actor)) fail('state', 'Party has no active consent to withdraw');
        return () => {
          a.consents = a.consents.filter((p) => p !== r.actor);
        };
      }

      case 'delegation.granted': {
        body(['agent', 'agreement', 'scope', 'expires']);
        const a = agreement(b.agreement);
        party(a);
        allConsent(a);
        if (this.#participants.get(b.agent)?.kind !== 'agent') fail('reference', 'Delegation must name an agent participant');
        if (!Array.isArray(b.scope) || b.scope.length !== 1 || b.scope[0] !== SCOPE) {
          fail('field', `Delegation scope must be exactly ["${SCOPE}"]`);
        }
        checkTime(b.expires, 'expires');
        if (b.expires <= r.time) fail('time', 'Delegation must expire after it is granted');
        return () => {
          const d = { id: r.id, agent: b.agent, agreement: b.agreement, scope: [SCOPE], expires: b.expires, principal: r.actor, revoked: false };
          this.#delegations.set(r.id, d);
          this.state.delegations.push(d);
        };
      }

      case 'delegation.revoked': {
        body(['delegation', 'reason']);
        checkText(b.reason, 'reason', LIMITS.text);
        const d = lookup(this.#delegations, b.delegation, 'delegation');
        if (d.principal !== r.actor) fail('authority', 'Only the grantor may revoke a delegation');
        if (d.revoked) fail('state', 'Delegation is already revoked');
        return () => {
          d.revoked = true;
        };
      }

      case 'contribution.submitted': {
        body(['title', 'summary', 'artifact', 'agreement', 'delegation']);
        checkText(b.title, 'title', LIMITS.title);
        checkText(b.summary, 'summary', LIMITS.text);
        exactFields(b.artifact, ['uri', 'digest'], 'body', 'artifact');
        checkUri(b.artifact.uri, 'artifact uri');
        checkHash(b.artifact.digest, 'artifact digest');
        const a = agreement(b.agreement);
        allConsent(a);
        let principal = r.actor;
        if (signer?.kind === 'human') {
          party(a);
          if (b.delegation !== null) fail('field', 'A human submission must have a null delegation');
        } else {
          if (!signer) fail('authority', 'Signer is not a project participant');
          const d = lookup(this.#delegations, b.delegation, 'delegation');
          activeGrant(d, a, r.actor);
          principal = d.principal;
        }
        return () => {
          const c = {
            id: r.id,
            title: b.title,
            summary: b.summary,
            artifact: { uri: b.artifact.uri, digest: b.artifact.digest },
            agreement: b.agreement,
            delegation: b.delegation,
            actor: r.actor,
            principal,
            status: 'submitted',
            reviews: [],
            acceptance: null,
            dispute: null,
          };
          this.#contributions.set(r.id, c);
          this.state.contributions.push(c);
        };
      }

      case 'contribution.reviewed': {
        body(['contribution', 'decision', 'note']);
        const c = contribution(b.contribution);
        party(this.#agreements.get(c.agreement));
        checkText(b.note, 'note', LIMITS.text);
        if (!REVIEWABLE.has(c.status)) fail('state', 'Only a pending contribution can be reviewed');
        if (r.actor === c.actor || r.actor === c.principal) fail('authority', 'Reviewer must be neither the submitter nor the principal');
        if (b.decision !== 'approve' && b.decision !== 'request_changes') fail('field', 'decision must be approve or request_changes');
        return () => {
          c.reviews.push({ id: r.id, actor: r.actor, decision: b.decision, note: b.note });
          c.status = b.decision === 'approve' ? 'reviewed' : 'changes_requested';
        };
      }

      case 'contribution.accepted': {
        body(['contribution', 'review']);
        steward();
        const c = contribution(b.contribution);
        const a = this.#agreements.get(c.agreement);
        allConsent(a);
        const latest = c.reviews.at(-1);
        if (c.status !== 'reviewed' || latest?.id !== b.review || latest.decision !== 'approve') {
          fail('state', 'Acceptance must cite the latest review of a pending contribution, and it must approve');
        }
        if (c.delegation !== null) activeGrant(this.#delegations.get(c.delegation), a, c.actor);
        return () => {
          c.status = 'accepted';
          c.acceptance = { id: r.id, actor: r.actor, review: b.review };
        };
      }

      case 'contribution.disputed': {
        body(['contribution', 'reason']);
        checkText(b.reason, 'reason', LIMITS.text);
        const c = contribution(b.contribution);
        party(this.#agreements.get(c.agreement));
        if (c.status !== 'accepted') fail('state', 'Only an accepted contribution can be disputed');
        return () => {
          c.status = 'disputed';
          c.dispute = { id: r.id, actor: r.actor, reason: b.reason };
        };
      }
    }
    throw new Error(`Unreachable: kind ${r.kind}`);
  }
}
