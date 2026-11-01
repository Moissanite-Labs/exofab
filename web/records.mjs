// Project histories in the browser. Every history the hub sends is verified
// here, by this page's own Koinos verifier, before it is shown or extended:
// the page displays and acts on the state it derived itself, not on the state
// the hub reports. Every record is drafted, checked against the Koinos rules,
// shown in full with confirmSign, and signed here with the person's key.
import { checkDraft, draftRecord, signDraft, verifyBundle, verifyRecords } from '/lib/koinos/protocol.mjs';
import { canonicalize } from '/lib/koinos/canonical.mjs';
import { utf8 } from '/lib/koinos/encoding.mjs';
import { confirmSign } from './dialog.mjs';
import { namesFromState } from './format.mjs';

const PIN_PREFIX = 'exofab.pin.';
const HEX64 = /^[0-9a-f]{64}$/;
export const SIGN_ATTEMPTS = 3;

// A refusal shown in this browser in plain words: either decided here before
// anything was signed or sent, or a known hub refusal restated for the person.
export class LocalRefusal extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'LocalRefusal';
  }
}

// Koinos lets a shorter history verify, so this browser remembers the last
// head it verified for each project and flags a history that does not extend
// it (a rollback). Storage may be unavailable; the check is then skipped.
function readPin(pid) {
  try {
    const pin = JSON.parse(localStorage.getItem(PIN_PREFIX + pid) ?? 'null');
    return pin && HEX64.test(pin.head) && Number.isSafeInteger(pin.count) && pin.count > 0 ? pin : null;
  } catch {
    return null;
  }
}

function writePin(pid, state) {
  try {
    localStorage.setItem(PIN_PREFIX + pid, JSON.stringify({ head: state.head, count: state.count }));
  } catch {
    // Not remembered; the next visit cannot detect a rollback.
  }
}

// Verifies the records of GET /api/projects/{pid} and returns
// {ok, state, problems}. state is null when the history does not verify.
export async function verifyProject(pid, data) {
  let state;
  try {
    if (!Array.isArray(data?.records)) throw new Error('the hub sent no list of records');
    state = await verifyRecords(data.records, { expectedProject: pid });
  } catch (error) {
    return { ok: false, state: null, problems: [`The history does not verify in this browser: ${error.message}`] };
  }
  const problems = [];
  if (data.head !== state.head || data.count !== state.count) {
    problems.push('The head the hub reported differs from the head this browser computed from the records.');
  }
  const pin = readPin(pid);
  if (pin && !(state.count >= pin.count && data.records[pin.count - 1]?.id === pin.head)) {
    problems.push(
      `This history does not extend the one this browser verified earlier (${pin.count} records, head ${pin.head}). ` +
        'The hub may have rolled it back. Do not sign anything on it.',
    );
  }
  if (problems.length === 0) writePin(pid, state);
  return { ok: problems.length === 0, state, problems };
}

// Drafts one record of `kind` on the current head, checks it against every
// Koinos rule, shows it with confirmSign, signs it, and appends it.
//   body(state)    -> the record body, from the freshly verified state
//   terms(state)   -> terms for confirmSign (agreements), optional
//   context(state) -> extra nodes for the dialog, optional
//   beforeSign(state) -> checks again once the person confirms, optional; it
//                     throws a LocalRefusal when time has run out meanwhile
// If another record lands first (409), the history is fetched and verified
// again, the record is rebuilt on the new head, and the person is asked again.
// Resolves with the hub's {head, count, state} plus the record, or null if the
// person did not sign.
export async function signRecord({ hub, identity, pid, kind, body, terms, context, beforeSign, title, onRetry, attempts = SIGN_ATTEMPTS }) {
  for (let attempt = 1; ; attempt++) {
    const data = await hub.getProject(pid);
    const verified = await verifyProject(pid, data);
    if (!verified.ok) throw new LocalRefusal(verified.problems.join(' '));
    const { state } = verified;
    const draft = await draftRecord({ records: data.records, actor: identity.id, kind, body: await body(state) });
    try {
      await checkDraft(data.records, draft);
    } catch (error) {
      throw new LocalRefusal(`Koinos rules refuse this record, so nothing was signed: ${error.message}`, { cause: error });
    }
    const signed = await confirmSign({
      title,
      draft,
      terms: terms ? await terms(state) : undefined,
      namesById: namesFromState(state),
      context: context ? await context(state) : undefined,
    });
    if (!signed) return null;
    await beforeSign?.(state);
    const record = await signDraft(draft, identity.privateKey);
    try {
      return { ...(await hub.appendRecord(pid, record)), record };
    } catch (error) {
      if (error?.status !== 409 || attempt >= attempts) throw error;
      onRetry?.(error);
    }
  }
}

// Starts a project from a brief: the hub drafts the genesis body (the exact
// team), this browser checks it, shows it, and signs project.created.
// context(participants) adds the participant list to the dialog. Resolves
// with {project, head, count} or null.
export async function startRecord({ hub, identity, briefId, context }) {
  const { project, body } = await hub.genesisDraft(briefId);
  const draft = await draftRecord({ records: [], actor: identity.id, kind: 'project.created', body, project });
  try {
    await checkDraft([], draft);
  } catch (error) {
    throw new LocalRefusal(`Koinos rules refuse this genesis record, so nothing was signed: ${error.message}`, { cause: error });
  }
  const names = new Map(draft.body.participants.map((p) => [p.id, p.name]));
  const signed = await confirmSign({ title: 'Start the record', draft, namesById: names, context: context?.(draft.body.participants) });
  if (!signed) return null;
  return hub.startProject(briefId, await signDraft(draft, identity.privateKey));
}

// The project's bundle as a file: verified in this browser first, then
// written as canonical JSON with a final newline (the same bytes as the
// bundle.json of `exofab export`). Resolves {bytes, state}.
export async function bundleFile(hub, pid) {
  const bundle = await hub.getBundle(pid);
  const state = await verifyBundle(bundle, { expectedProject: pid });
  return { bytes: utf8(`${canonicalize(bundle)}\n`), state };
}
