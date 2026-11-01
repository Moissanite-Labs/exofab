// Public Koinos 0.1 API: drafting, signing, creating and verifying records and
// bundles. Everything that hashes or signs is async (WebCrypto).
import { KoinosError, fail } from './errors.mjs';
import { canonicalize, LIMITS } from './canonical.mjs';
import { signText } from './crypto.mjs';
import { exactFields } from './fields.mjs';
import { History, PROTOCOL, KINDS, UNSIGNED_FIELDS, recordId, signingText } from './history.mjs';

export { KoinosError, PROTOCOL, KINDS, recordId, signingText };
export const BUNDLE_FORMAT = 'koinos-bundle/0.1';

// Bundle-level checks run over the whole bundle, as Koinos does, so the
// node, depth and byte limits count the complete history.
function checkBundleShape(bundle) {
  canonicalize(bundle);
  exactFields(bundle, ['format', 'records'], 'format', 'Bundle');
  if (bundle.format !== BUNDLE_FORMAT) fail('format', `Unsupported bundle format; expected ${BUNDLE_FORMAT}`);
  if (!Array.isArray(bundle.records) || bundle.records.length === 0) fail('format', 'Bundle must contain at least one record');
  if (bundle.records.length > LIMITS.records) fail('limits', `More than ${LIMITS.records} records`);
}

async function replay(records) {
  const history = new History();
  for (const record of records) await history.append(record);
  return history;
}

// A pin matches only exactly; a head pin does not accept descendants. Only
// undefined means "no pin", as in Koinos.
function checkPins(state, { expectedHead, expectedProject } = {}) {
  if (expectedHead !== undefined && expectedHead !== state.head) fail('pin', 'History head does not match the expected head');
  if (expectedProject !== undefined && expectedProject !== state.project.id) {
    fail('pin', 'Project does not match the expected project');
  }
}

const detached = (value) => JSON.parse(canonicalize(value));

export async function verifyBundle(bundle, pins = {}) {
  checkBundleShape(bundle);
  const history = await replay(bundle.records);
  checkPins(history.state, pins);
  return history.snapshot();
}

export function verifyRecords(records, pins = {}) {
  return verifyBundle({ format: BUNDLE_FORMAT, records }, pins);
}

// Verifies the history extended by one record. On failure, error.index tells
// whether the stored history (index < records.length) or the new record failed.
export function verifyAppend(records, record, pins = {}) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  return verifyRecords([...records, record], pins);
}

export async function createBundle(records) {
  const bundle = { format: BUNDLE_FORMAT, records };
  await verifyBundle(bundle);
  return detached(bundle);
}

// The envelope fields the next record must carry. minTime is the earliest
// time the next record may have (the last record's time).
export function nextFields(records) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  const last = records.at(-1);
  return {
    project: records[0]?.project ?? null,
    sequence: records.length,
    previous: last?.id ?? null,
    minTime: last?.time ?? null,
  };
}

function defaultTime(minTime) {
  const now = new Date().toISOString();
  return minTime && minTime > now ? minTime : now;
}

// Builds the unsigned record (with its id) that the actor will be asked to
// sign. It does not check authority; use checkDraft for that.
export async function draftRecord({ records, actor, kind, body, time, project }) {
  const next = nextFields(records);
  if (next.project !== null && project !== undefined && project !== next.project) {
    fail('project', 'A record must use the project id of its history');
  }
  const unsigned = {
    protocol: PROTOCOL,
    project: next.project ?? project ?? globalThis.crypto.randomUUID(),
    sequence: next.sequence,
    previous: next.previous,
    time: time ?? defaultTime(next.minTime),
    actor,
    kind,
    body,
  };
  return detached({ ...unsigned, id: await recordId(unsigned) });
}

export async function signDraft(draft, privateKey) {
  exactFields(draft, UNSIGNED_FIELDS, 'envelope', 'Draft');
  if ((await recordId(draft)) !== draft.id) fail('id', 'Draft id does not match its content');
  const signature = await signText(privateKey, signingText(draft.id));
  return detached({ ...draft, signature });
}

// Verifies the history, then every rule for the draft except its signature.
// Lets a client refuse an invalid record before asking anyone to sign it.
export async function checkDraft(records, draft) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  checkBundleShape({ format: BUNDLE_FORMAT, records: [...records, draft] });
  const history = await replay(records);
  await history.append(draft, { signed: false });
  return history.snapshot();
}

export async function createRecord({ records, identity, kind, body, time, project }) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  if (typeof identity?.id !== 'string' || !identity.privateKey) throw new TypeError('identity needs id and privateKey');
  if (records.length) checkBundleShape({ format: BUNDLE_FORMAT, records });
  const history = await replay(records);
  const draft = await draftRecord({ records, actor: identity.id, kind, body, time, project });
  const record = await signDraft(draft, identity.privateKey);
  checkBundleShape({ format: BUNDLE_FORMAT, records: [...records, record] });
  try {
    await history.append(record);
  } catch (error) {
    if (error instanceof KoinosError && error.code === 'signature') {
      error.message += ' (the private key does not belong to identity.id)';
    }
    throw error;
  }
  return record;
}
