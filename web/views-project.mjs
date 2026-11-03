// A project: its whole history verified in this browser, the state this
// browser derived from it, the timeline, and the records the current person
// may sign next. Every action drafts a record on the verified head and goes
// through confirmSign; terms and artifacts are fetched as exact bytes and
// their digests recomputed here.
import { sha256Hex, niUri } from '/lib/koinos/crypto.mjs';
import { h, section, emptyState, facts, field, idCode, mono, notice, renderState, renderTimeline, saveFile } from './render.mjs';
import { href } from './routes.mjs';
import { namesFromState, nameOf, revealHidden, shortId, termsFromBytes } from './format.mjs';
import { formDialog, promptText, viewTerms } from './dialog.mjs';
import {
  CLIENT_LIMITS,
  DELEGATION_NOTE,
  DELEGATION_SCOPE,
  EXPIRED_DELEGATION,
  charterTemplate,
  expiryFrom,
  isExpiredDelegationRefusal,
  previewText,
  projectActions,
  readExpiryDays,
  readProposal,
  readSubmission,
} from './actions.mjs';
import { LocalRefusal, bundleFile, signRecord, verifyProject } from './records.mjs';
import { HubHttpError, TEXT_TYPE } from './api.mjs';
import { announce, pageHead, problem, list, str, needIdentity, needRegistration, hubFor, act, actionButton, prose, refreshButton } from './shell.mjs';

const quoted = (text) => `“${str(text, 'untitled', 120)}”`;

function find(state, group, id, noun) {
  const found = list(state[group]).find((x) => x.id === id);
  if (!found) throw new LocalRefusal(`That ${noun} is not in this project’s verified history.`);
  return found;
}

function sign(ctx, options) {
  return signRecord({
    hub: ctx.hub,
    identity: ctx.identity,
    pid: ctx.pid,
    onRetry: () => announce('Another record was added while you were reviewing. The record was rebuilt on the new head: review it again.'),
    ...options,
  });
}

const reasonPrompt = (title) =>
  promptText({ title, label: 'Reason', hint: 'Recorded in the project history; every participant can read it.', maxlength: 2000, submitLabel: 'Review the record' });

function checkbox(name, value, label, checked, id) {
  return h('div', { class: 'check' }, h('input', { type: 'checkbox', id, name, value, checked }), h('label', { for: id }, label));
}

function radio(name, value, label, checked, id) {
  return h('div', { class: 'check' }, h('input', { type: 'radio', id, name, value, checked }), h('label', { for: id }, label));
}

// --- Record actions --------------------------------------------------------------------

async function propose(ctx) {
  const humans = list(ctx.state.participants).filter((p) => p.kind === 'human');
  const value = await formDialog({
    title: 'Propose the charter',
    description: 'The exact text below is stored on the hub by its SHA-256 digest, and the agreement record cites that digest. Each party then reads the same bytes, checks the digest in their own browser, and consents.',
    wide: true,
    submitLabel: 'Store the text and review the record',
    content: [
      field({ label: 'Agreement title', name: 'title', value: 'Charter', maxlength: CLIENT_LIMITS.title, autocomplete: 'off' }),
      h('fieldset', {}, h('legend', {}, 'Parties who must consent'), humans.map((p, i) => checkbox('party', p.id, str(p.name, shortId(p.id), 120), true, `party-${i}`))),
      field({
        label: 'Terms text',
        name: 'terms',
        multiline: true,
        rows: 16,
        value: charterTemplate({ title: ctx.state.project.title, description: ctx.state.project.description, parties: humans.map((p) => p.name) }),
        hint: 'Edit the scope and acceptance criteria. Keep the closing statement: the first slice records no economic terms.',
      }),
    ],
    read: async (form) => {
      const data = new FormData(form);
      const proposal = readProposal({ title: data.get('title'), parties: data.getAll('party'), text: data.get('terms'), humans: humans.map((p) => p.id) });
      const bytes = new TextEncoder().encode(proposal.text);
      const digest = await sha256Hex(bytes);
      const stored = await ctx.hub.putBlob(ctx.pid, bytes, TEXT_TYPE);
      if (stored?.digest !== digest || stored?.uri !== niUri(digest)) {
        throw new Error('The hub reported a different digest for the stored text, so nothing will be signed.');
      }
      return { title: proposal.title, parties: proposal.parties, digest, uri: niUri(digest) };
    },
  });
  if (!value) return;
  const result = await sign(ctx, {
    kind: 'agreement.proposed',
    title: 'Propose the charter',
    body: () => ({ title: value.title, uri: value.uri, digest: value.digest, parties: value.parties }),
    // Shown from the bytes the hub now stores, not from the form.
    terms: async () => termsFromBytes(await ctx.hub.getBlob(ctx.pid, value.digest), value.digest),
  });
  if (result) announce('Charter proposed. Each party can now read it and consent.', 'ok');
}

async function consent(ctx, item) {
  const title = quoted(find(ctx.state, 'agreements', item.agreement, 'agreement').title);
  const result = await sign(ctx, {
    kind: 'agreement.consented',
    title: `Consent to ${title}`,
    body: (state) => ({ agreement: find(state, 'agreements', item.agreement, 'agreement').id }),
    terms: async (state) => {
      const a = find(state, 'agreements', item.agreement, 'agreement');
      return termsFromBytes(await ctx.hub.getBlob(ctx.pid, a.digest), a.digest);
    },
  });
  if (result) announce(`You consented to ${title}.`, 'ok');
}

async function withdraw(ctx, item) {
  const title = quoted(find(ctx.state, 'agreements', item.agreement, 'agreement').title);
  const reason = await reasonPrompt(`Withdraw consent from ${title}`);
  if (reason === null) return;
  const result = await sign(ctx, { kind: 'agreement.withdrawn', title: `Withdraw consent from ${title}`, body: () => ({ agreement: item.agreement, reason }) });
  if (result) announce(`You withdrew consent from ${title}.`, 'ok');
}

async function delegate(ctx, item) {
  const title = quoted(find(ctx.state, 'agreements', item.agreement, 'agreement').title);
  const { minExpiryDays: min, maxExpiryDays: max, defaultExpiryDays } = CLIENT_LIMITS;
  const value = await formDialog({
    title: `Delegate under ${title}`,
    description: DELEGATION_NOTE,
    submitLabel: 'Review the record',
    content: [
      h('div', { class: 'field' }, h('label', { for: 'delegate-agent' }, 'Agent'), h('select', { class: 'input', id: 'delegate-agent', name: 'agent' }, item.agents.map((id) => h('option', { value: id }, nameOf(id, ctx.names))))),
      h(
        'div',
        { class: 'field' },
        h('label', { for: 'delegate-days' }, 'Expires after (days)'),
        h('input', { class: 'input', id: 'delegate-days', name: 'days', type: 'number', min, max, step: 1, value: String(defaultExpiryDays), inputmode: 'numeric', 'aria-describedby': 'delegate-days-hint' }),
        h('p', { class: 'hint', id: 'delegate-days-hint' }, `From ${min} to ${max} days. The delegation must still be active when the work is accepted.`),
      ),
      facts([['Scope', mono(DELEGATION_SCOPE)], ['Agreement', title]]),
    ],
    read: (form) => {
      const data = new FormData(form);
      const agent = String(data.get('agent') ?? '');
      if (!item.agents.includes(agent)) throw new Error('Choose one of your agents listed in this project.');
      return { agent, days: readExpiryDays(data.get('days')) };
    },
  });
  if (!value) return;
  const result = await sign(ctx, {
    kind: 'delegation.granted',
    title: `Delegate to ${nameOf(value.agent, ctx.names)}`,
    body: () => ({ agent: value.agent, agreement: item.agreement, scope: [DELEGATION_SCOPE], expires: expiryFrom(value.days) }),
  });
  if (result) announce(`${nameOf(value.agent, ctx.names)} may now submit contributions under ${title}.`, 'ok');
}

// A party submits their own work: no delegation, so they are its principal.
// The exact file bytes are stored first and the record cites their digest.
async function submit(ctx, item) {
  const title = quoted(find(ctx.state, 'agreements', item.agreement, 'agreement').title);
  const value = await formDialog({
    title: `Submit your own work under ${title}`,
    description:
      'The exact bytes of the file are stored on the hub by their SHA-256 digest, and your record cites that digest. A party who is not you reviews those bytes before the steward can accept the contribution.',
    submitLabel: 'Store the file and review the record',
    content: [
      field({ label: 'Contribution title', name: 'title', maxlength: CLIENT_LIMITS.title, autocomplete: 'off' }),
      field({ label: 'Summary', name: 'summary', multiline: true, rows: 3, hint: 'What the work is and how it meets the agreement. Recorded in the project history; every participant can read it.' }),
      h(
        'div',
        { class: 'field' },
        h('label', { for: 'submit-artifact' }, 'Artifact file'),
        h('input', { class: 'input', id: 'submit-artifact', name: 'artifact', type: 'file', 'aria-describedby': 'submit-artifact-hint' }),
        h('p', { class: 'hint', id: 'submit-artifact-hint' }, 'At most 4 MiB. Its exact bytes are what the reviewer reads and what the record cites.'),
      ),
    ],
    read: async (form) => {
      const data = new FormData(form);
      const chosen = data.get('artifact');
      const file = chosen instanceof File && chosen.name !== '' ? chosen : null;
      const fields = readSubmission({ title: data.get('title'), summary: data.get('summary'), size: file ? file.size : null });
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length > CLIENT_LIMITS.artifactBytes) throw new Error('The artifact file is larger than 4 MiB.');
      const digest = await sha256Hex(bytes);
      const stored = await ctx.hub.putBlob(ctx.pid, bytes, 'application/octet-stream');
      if (stored?.digest !== digest || stored?.uri !== niUri(digest)) {
        throw new Error('The hub reported a different digest for the stored file, so nothing will be signed.');
      }
      return { ...fields, digest, uri: niUri(digest), file: file.name, size: bytes.length };
    },
  });
  if (!value) return;
  const result = await sign(ctx, {
    kind: 'contribution.submitted',
    title: `Submit ${quoted(value.title)}`,
    body: (state) => ({
      title: value.title,
      summary: value.summary,
      artifact: { uri: value.uri, digest: value.digest },
      agreement: find(state, 'agreements', item.agreement, 'agreement').id,
      delegation: null,
    }),
    context: () => [facts([['File', str(value.file, 'chosen file', 200)], ['Size', `${value.size} bytes`], ['Artifact digest, computed by this browser', mono(value.digest)]], 'facts-ok')],
  });
  if (result) announce(`You submitted ${quoted(value.title)}. A party who is not you must review it before the steward can accept it.`, 'ok');
}

async function revoke(ctx, item) {
  const d = find(ctx.state, 'delegations', item.delegation, 'delegation');
  const agent = nameOf(d.agent, ctx.names);
  const reason = await reasonPrompt(`Revoke the delegation to ${agent}`);
  if (reason === null) return;
  const result = await sign(ctx, { kind: 'delegation.revoked', title: `Revoke the delegation to ${agent}`, body: () => ({ delegation: item.delegation, reason }) });
  if (result) announce(`The delegation to ${agent} is revoked.`, 'ok');
}

function previewNodes(preview) {
  if (preview.text === null) {
    return notice('These bytes are not UTF-8 text, so they are not previewed here. Download them to inspect them with a tool you trust.', 'warn');
  }
  const shown = revealHidden(preview.text);
  return [
    h('h3', { class: 'modal-section' }, 'Artifact text'),
    shown.count ? notice(`The text contains ${shown.count} invisible or control character${shown.count === 1 ? '' : 's'}, shown as ⟦U+…⟧ markers.`, 'warn') : null,
    preview.truncated ? notice(`Showing the first ${preview.text.length} of ${preview.chars} characters. Download the bytes to read all of it.`, 'info') : null,
    h('pre', { class: 'code-block preview', tabindex: 0, 'aria-label': 'Artifact text preview' }, shown.text),
  ];
}

async function review(ctx, item) {
  const c = find(ctx.state, 'contributions', item.contribution, 'contribution');
  const bytes = await ctx.hub.getBlob(ctx.pid, c.artifact.digest);
  const computed = await sha256Hex(bytes);
  const match = computed === c.artifact.digest;
  const submitter = nameOf(c.actor, ctx.names) + (c.actor === c.principal ? '' : ` for ${nameOf(c.principal, ctx.names)}`);
  const value = await formDialog({
    title: `Review ${quoted(c.title)}`,
    description: 'Review the exact bytes the contribution cites. This browser fetched them from the hub and computed their SHA-256 digest itself.',
    wide: true,
    blocked: !match,
    submitLabel: 'Review the record',
    content: [
      facts([
        ['Submitted by', submitter],
        ['Summary', h('span', { class: 'prose' }, prose(c.summary))],
        ['Size', `${bytes.length} bytes`],
        ['Digest named in the record', mono(c.artifact.digest)],
        ['Digest computed by this browser', mono(computed)],
      ], 'facts-digests'),
      match
        ? notice('The SHA-256 digest computed by this browser from the stored bytes equals the digest in the record.', 'ok')
        : notice('The stored bytes do not match the digest in the record. Do not review them: they are not what was submitted. Reviewing is disabled.', 'danger'),
      previewNodes(previewText(bytes)),
      h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-small', on: { click: () => saveFile(bytes, computed, 'application/octet-stream') } }, 'Download the exact bytes')),
      match
        ? [
            h(
              'fieldset',
              {},
              h('legend', {}, 'Decision'),
              radio('decision', 'approve', 'Approve', true, 'decision-approve'),
              radio('decision', 'request_changes', 'Request changes', false, 'decision-changes'),
            ),
            field({ label: 'Review note', name: 'note', multiline: true, rows: 3, hint: 'Required. Recorded in the project history; every participant can read it.' }),
          ]
        : null,
    ],
    read: (form) => {
      const data = new FormData(form);
      const decision = data.get('decision');
      if (decision !== 'approve' && decision !== 'request_changes') throw new Error('Choose approve or request changes.');
      const note = String(data.get('note') ?? '').trim();
      if (note === '') throw new Error('Write a review note.');
      return { decision, note };
    },
  });
  if (!value) return;
  const result = await sign(ctx, {
    kind: 'contribution.reviewed',
    title: `Review ${quoted(c.title)}`,
    body: (state) => ({ contribution: find(state, 'contributions', item.contribution, 'contribution').id, decision: value.decision, note: value.note }),
    context: () => [facts([['Artifact digest, recomputed by this browser', mono(computed)]], 'facts-ok')],
  });
  if (result) announce(value.decision === 'approve' ? `You approved ${quoted(c.title)}.` : `You requested changes to ${quoted(c.title)}.`, 'ok');
}

function latestApproval(state, id) {
  const c = find(state, 'contributions', id, 'contribution');
  const latest = list(c.reviews).at(-1);
  if (c.status !== 'reviewed' || latest?.decision !== 'approve') throw new LocalRefusal('This contribution no longer has an approving latest review.');
  return { c, latest };
}

// The delegation must still be active when the steward signs, by this
// browser's clock; the hub checks it again by its own (hub policy 10).
function refuseIfGrantExpired(state, id) {
  const c = find(state, 'contributions', id, 'contribution');
  const d = c.delegation === null ? null : list(state.delegations).find((x) => x.id === c.delegation);
  if (d && !(Date.parse(d.expires) > Date.now())) throw new LocalRefusal(EXPIRED_DELEGATION);
}

async function accept(ctx, item) {
  const title = quoted(find(ctx.state, 'contributions', item.contribution, 'contribution').title);
  let result;
  try {
    result = await signAcceptance(ctx, item, title);
  } catch (error) {
    if (isExpiredDelegationRefusal(error)) throw new LocalRefusal(EXPIRED_DELEGATION, { cause: error });
    throw error;
  }
  if (result) announce(`You accepted ${title}. It is now recorded as credit.`, 'ok');
}

function signAcceptance(ctx, item, title) {
  return sign(ctx, {
    kind: 'contribution.accepted',
    title: `Accept ${title}`,
    body: (state) => {
      refuseIfGrantExpired(state, item.contribution);
      const { c, latest } = latestApproval(state, item.contribution);
      return { contribution: c.id, review: latest.id };
    },
    beforeSign: (state) => refuseIfGrantExpired(state, item.contribution),
    context: (state) => {
      const { latest } = latestApproval(state, item.contribution);
      return [
        h('h3', { class: 'modal-section' }, 'The review this acceptance cites'),
        facts([
          ['Reviewer', nameOf(latest.actor, namesFromState(state))],
          ['Decision', 'Approved'],
          ['Note', h('span', { class: 'prose' }, prose(latest.note))],
          ['Review record', idCode(latest.id)],
        ]),
      ];
    },
  });
}

async function dispute(ctx, item) {
  const title = quoted(find(ctx.state, 'contributions', item.contribution, 'contribution').title);
  const reason = await reasonPrompt(`Dispute the acceptance of ${title}`);
  if (reason === null) return;
  const result = await sign(ctx, { kind: 'contribution.disputed', title: `Dispute ${title}`, body: () => ({ contribution: item.contribution, reason }) });
  if (result) announce(`You disputed the acceptance of ${title}. It stays in the record and in its principal’s credit, marked as disputed with your reason.`, 'ok');
}

// Stored bytes for a digest this project's records cite, checked here.
async function fetchCited(ctx, digest, what) {
  let bytes;
  try {
    bytes = await ctx.hub.getBlob(ctx.pid, digest);
  } catch (error) {
    if (error instanceof HubHttpError && error.status === 404) {
      throw new LocalRefusal(
        `The hub holds no ${what} bytes with this digest for this project, so they cannot be shown or saved here. ` +
          'A project imported without its cited files (exofab import --blobs) has only its records.',
        { cause: error },
      );
    }
    throw error;
  }
  return { bytes, computed: await sha256Hex(bytes) };
}

// Saves cited bytes under their bare hex digest, the name
// "node src/cli.mjs verify BUNDLE --blobs DIR" looks for, after checking that
// their SHA-256 equals the digest in the record.
async function downloadCited(ctx, { digest, what, title }) {
  const { bytes, computed } = await fetchCited(ctx, digest, what);
  if (computed !== digest) throw new LocalRefusal(`The hub sent ${what} bytes that do not match the digest in the record, so nothing was saved.`);
  saveFile(bytes, digest, 'application/octet-stream');
  announce(`Saved the ${what} of ${quoted(title)} as ${digest}, its SHA-256 digest, checked in this browser. Put it in a folder named blobs next to the bundle to verify both offline.`, 'ok');
}

// Any participant can read an agreement's exact terms, read only.
async function readTerms(ctx, id) {
  const a = find(ctx.state, 'agreements', id, 'agreement');
  const { bytes } = await fetchCited(ctx, a.digest, 'terms');
  const me = ctx.identity.id;
  const yours = !list(a.parties).includes(me) ? 'You are not a party' : list(a.consents).includes(me) ? 'Given' : 'Not given';
  await viewTerms({
    title: `Terms of ${quoted(a.title)}`,
    terms: await termsFromBytes(bytes, a.digest),
    facts: [['Parties', list(a.parties).map((p) => nameOf(p, ctx.names)).join(', ')], ['Your consent', yours]],
  });
}

async function downloadBundle(ctx) {
  const { bytes, state } = await bundleFile(ctx.hub, ctx.pid);
  const name = `exofab-${ctx.pid}.bundle.json`;
  saveFile(bytes, name, 'application/json');
  announce(
    `Saved the bundle (${state.count} records, verified in this browser, head ${state.head}). It holds the signed records only. ` +
      'Save the cited terms and artifacts with their Download buttons, into a folder named blobs next to it; then anyone can verify both offline with ' +
      `"node src/cli.mjs verify ${name} --blobs blobs" from an Exofab checkout. "exofab export" writes both at once on the machine that holds the hub's data.`,
    'ok',
  );
}

// --- Actions panel -----------------------------------------------------------------------

// For each action type: the button label, a sentence saying what it does, and
// the handler. Labels name their target so every button is distinct.
const ACTIONS = {
  propose: (ctx) => ({
    label: 'Propose the charter',
    text: 'As steward, propose the terms the parties agree to. The exact text is stored by digest, and each party reads it before consenting.',
    primary: list(ctx.state.agreements).length === 0,
    run: () => propose(ctx),
  }),
  consent: (ctx, item) => {
    const title = quoted(find(ctx.state, 'agreements', item.agreement, 'agreement').title);
    return {
      label: `Read the terms and consent to ${title}`,
      text: `${title} needs your consent. You will see its exact text and its digest, recomputed in this browser, before you sign.`,
      primary: true,
      run: () => consent(ctx, item),
    };
  },
  withdraw: (ctx, item) => {
    const title = quoted(find(ctx.state, 'agreements', item.agreement, 'agreement').title);
    return { label: `Withdraw consent from ${title}`, text: `You consent to ${title}. Withdrawing stops new delegations, submissions and acceptances under it, including your agent’s, until you consent again.`, run: () => withdraw(ctx, item) };
  },
  delegate: (ctx, item) => {
    const title = quoted(find(ctx.state, 'agreements', item.agreement, 'agreement').title);
    return {
      label: `Delegate to my agent under ${title}`,
      text: `Let your own agent submit contributions under ${title} until an expiry you choose.`,
      primary: !list(ctx.state.delegations).some((d) => d.principal === ctx.identity.id && !d.revoked),
      run: () => delegate(ctx, item),
    };
  },
  submit: (ctx, item) => {
    const title = quoted(find(ctx.state, 'agreements', item.agreement, 'agreement').title);
    return {
      label: `Submit my own work under ${title}`,
      text: `As a party to ${title}, submit a contribution yourself. A party who is not you reviews its exact bytes before the steward can accept it.`,
      run: () => submit(ctx, item),
    };
  },
  revoke: (ctx, item) => {
    const d = find(ctx.state, 'delegations', item.delegation, 'delegation');
    const agent = nameOf(d.agent, ctx.names);
    return { label: `Revoke the delegation to ${agent}`, text: `${agent} may submit contributions until ${d.expires}, while every party consents. Revoking ends that now.`, run: () => revoke(ctx, item) };
  },
  review: (ctx, item) => {
    const title = quoted(find(ctx.state, 'contributions', item.contribution, 'contribution').title);
    return { label: `Review ${title}`, text: `${title} is waiting for review. You will see the exact artifact bytes and their digest, recomputed in this browser.`, primary: true, run: () => review(ctx, item) };
  },
  accept: (ctx, item) => {
    const title = quoted(find(ctx.state, 'contributions', item.contribution, 'contribution').title);
    return { label: `Accept ${title}`, text: `${title} has an approving review. As steward, accept it, citing that review.`, primary: true, run: () => accept(ctx, item) };
  },
  dispute: (ctx, item) => {
    const title = quoted(find(ctx.state, 'contributions', item.contribution, 'contribution').title);
    return {
      label: `Dispute ${title}`,
      text: `${title} is accepted. If you disagree, record a dispute with your reason. The contribution stays in its principal’s credit, marked as disputed by you, with your reason.`,
      run: () => dispute(ctx, item),
    };
  },
};

function actionsPanel(ctx) {
  const items = projectActions(ctx.state, { me: ctx.identity.id, myAgents: ctx.myAgents, now: Date.now() });
  const rows = items.map((item, i) => {
    const spec = ACTIONS[item.type](ctx, item);
    const textId = `action-${i}`;
    return h(
      'li',
      { class: 'action' },
      h('div', { class: 'action-text' }, h('p', { id: textId }, spec.text), item.blocked ? h('p', { class: 'action-blocked' }, item.blocked) : null),
      actionButton(spec.label, spec.run, { variant: spec.primary && !item.blocked ? 'primary' : undefined, describedBy: textId, disabled: !!item.blocked }),
    );
  });
  return section('What you can do', rows.length ? h('ul', { class: 'action-list' }, rows) : emptyState('Nothing here needs your signature right now.'));
}

function verifiedIndicator(state) {
  return h(
    'div',
    { class: 'verified' },
    h('p', { class: 'verified-title' }, h('span', { class: 'verified-mark', 'aria-hidden': 'true' }), 'Verified in this browser'),
    h(
      'p',
      { class: 'verified-detail' },
      `${state.count} record${state.count === 1 ? '' : 's'}. This page’s own Koinos verifier checked every record id, signature, link and authority rule before showing anything. Head: `,
      mono(state.head),
    ),
  );
}

// --- View --------------------------------------------------------------------------------

export async function projectView({ params, identity }) {
  const title = 'Project';
  if (!identity) return { title, nodes: [pageHead(title, null), needIdentity('take part in projects')] };
  if (!identity.token) return { title, nodes: [pageHead(title, null), needRegistration(identity)] };
  const hub = hubFor(identity);
  let data;
  let me;
  try {
    [data, me] = await Promise.all([hub.getProject(params.pid), hub.me()]);
  } catch (error) {
    return { title, nodes: [pageHead(title, null), problem(error, identity)] };
  }
  const verified = await verifyProject(params.pid, data);
  if (!verified.ok) {
    return {
      title,
      nodes: [
        pageHead(title, null),
        h('div', { class: 'verified verified-failed', role: 'alert' }, h('p', { class: 'verified-title' }, 'Not verified in this browser'), verified.problems.map((p) => h('p', {}, p))),
        section('Records as sent by the hub (not verified)', renderTimeline(data?.records)),
      ],
    };
  }
  const { state } = verified;
  const ctx = { identity, hub, pid: params.pid, state, names: namesFromState(state), myAgents: list(me.agents).map((a) => a.id) };
  const download = actionButton('Download bundle', () => downloadBundle(ctx), { redraw: false });
  const brief = typeof data.brief === 'string' ? h('a', { class: 'btn', href: href('brief', { id: data.brief }) }, 'Brief') : null;
  return {
    title: str(state.project.title, title, 80),
    nodes: [
      pageHead(str(state.project.title, 'Untitled project', 256), 'Koinos record of this project. Its records and stored bytes are visible only to its participants.', refreshButton(), brief, download),
      verifiedIndicator(state),
      actionsPanel(ctx),
      h(
        'div',
        { class: 'split' },
        h(
          'div',
          {},
          renderState(state, {
            namesById: ctx.names,
            onReadTerms: (id, button) => act(button, () => readTerms(ctx, id), { redraw: false }),
            onDownload: (cited, button) => act(button, () => downloadCited(ctx, cited), { redraw: false }),
          }),
        ),
        section('Record', renderTimeline(data.records, ctx.names)),
      ),
    ],
  };
}
