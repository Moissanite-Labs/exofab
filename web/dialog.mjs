// Modal dialogs built on the native <dialog> element, which makes the rest of
// the page inert, traps focus, and closes on Escape. confirmSign is the
// exact-text approval step: nothing is signed unless the person sees exactly
// what their key will sign and presses the sign button.
import { niUri } from '/lib/koinos/crypto.mjs';
import { h, kindBadge, idCode, mono, notice, facts } from './render.mjs';
import { prettyJson, revealHidden, termsGate, termsBindingProblems, isSha256Hex, describeRecord, formatTime, shortId, nameOf } from './format.mjs';

let uid = 0;
const nextId = (prefix) => `${prefix}-${++uid}`;

function dialogRoot() {
  return document.getElementById('dialog-root') ?? document.body;
}

// Opens a modal and returns {dialog, result, close, button}. `result` resolves
// with the value of the action pressed, or cancelValue on Escape.
export function openDialog({ title, description, content = [], actions = [{ label: 'Close', value: null }], cancelValue = null, wide = false }) {
  const id = nextId('dialog');
  const opener = document.activeElement;
  const buttons = new Map();
  let settle;
  const result = new Promise((resolve) => {
    settle = resolve;
  });
  let done = false;

  const close = (value) => {
    if (done) return;
    done = true;
    if (dialog.open) dialog.close();
    dialog.remove();
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    settle(value);
  };

  const footer = h('div', { class: 'modal-actions' });
  for (const action of actions) {
    const button = h(
      'button',
      {
        type: 'button',
        class: ['btn', action.variant && `btn-${action.variant}`],
        disabled: action.disabled,
        autofocus: action.autofocus,
        on: { click: () => close(action.value) },
      },
      action.label,
    );
    buttons.set(action.value, button);
    footer.append(button);
  }

  const dialog = h(
    'dialog',
    { class: ['modal', wide && 'modal-wide'], 'aria-labelledby': `${id}-title`, 'aria-describedby': description ? `${id}-desc` : undefined },
    h('div', { class: 'modal-header' }, h('h2', { id: `${id}-title`, class: 'modal-title' }, title)),
    h(
      'div',
      { class: 'modal-body', tabindex: 0, role: 'group', 'aria-labelledby': `${id}-title` },
      description ? h('p', { id: `${id}-desc`, class: 'modal-desc' }, description) : null,
      content,
    ),
    actions.length ? footer : null,
  );
  // Escape fires "cancel"; a browser may also close the dialog itself.
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close(cancelValue);
  });
  dialog.addEventListener('close', () => close(cancelValue));

  dialogRoot().append(dialog);
  dialog.showModal();
  return { dialog, result, close, button: (value) => buttons.get(value) };
}

export async function confirmAction({ title, message, confirmLabel = 'Confirm', danger = false }) {
  const { result } = openDialog({
    title,
    description: message,
    actions: [
      { label: 'Cancel', value: false, autofocus: true },
      { label: confirmLabel, value: true, variant: danger ? 'danger' : 'primary' },
    ],
    cancelValue: false,
  });
  return (await result) === true;
}

// Asks for one line of text. Resolves with the trimmed text, or null.
export async function promptText({ title, label, hint, value = '', maxlength = 256, submitLabel = 'Save', validate }) {
  const inputId = nextId('prompt');
  const input = h('input', { class: 'input', id: inputId, type: 'text', value, maxlength, required: true, autocomplete: 'off', 'aria-describedby': `${inputId}-hint` });
  const error = h('p', { class: 'field-error', id: `${inputId}-hint`, 'aria-live': 'polite' }, hint ?? '');
  const form = h(
    'form',
    { class: 'field', novalidate: true },
    h('label', { for: input.id }, label),
    input,
    error,
    h('div', { class: 'modal-actions modal-actions-inline' },
      h('button', { type: 'button', class: 'btn', 'data-cancel': '' }, 'Cancel'),
      h('button', { type: 'submit', class: 'btn btn-primary' }, submitLabel)),
  );
  const handle = openDialog({ title, content: form, actions: [], cancelValue: null });
  form.querySelector('[data-cancel]').addEventListener('click', () => handle.close(null));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    try {
      if (text === '') throw new Error(`${label} cannot be empty.`);
      validate?.(text);
    } catch (e) {
      error.textContent = e.message;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    handle.close(text);
  });
  input.focus();
  return handle.result;
}

function codeBlock(value, label) {
  return h('pre', { class: 'code-block', tabindex: 0, 'aria-label': label }, value);
}

function termsSection(terms, onReadChange) {
  const nodes = [h('h3', { class: 'modal-section' }, 'Terms text')];
  const { check, shown, canSign } = termsGate(terms);
  if (shown === null) {
    nodes.push(notice('The stored terms are not valid UTF-8 text, so they cannot be shown exactly. Signing is disabled.', 'danger'));
  } else {
    if (shown.count) {
      nodes.push(notice(`The terms contain ${shown.count} invisible or control character${shown.count === 1 ? '' : 's'}, shown below as ⟦U+…⟧ markers. Read them before signing.`, 'warn'));
    }
    nodes.push(codeBlock(shown.text, 'Exact terms text'));
  }
  nodes.push(
    facts([
      ['Digest named in the record', mono(terms.digestClaimed ?? '(none)')],
      ['Digest computed by this browser', mono(terms.digestComputed ?? '(not computed)')],
    ], 'facts-digests'),
  );
  nodes.push(notice(check.message, check.state === 'match' ? 'ok' : 'danger'));
  if (canSign) {
    const box = h('input', { type: 'checkbox', id: nextId('terms-read'), on: { change: () => onReadChange(box.checked) } });
    nodes.push(h('div', { class: 'check' }, box, h('label', { for: box.id }, 'I have read the exact terms text above.')));
  }
  return { nodes, canSign };
}

// A form in a modal. `content` is placed inside the form; `read(form)` returns
// the value to resolve with, or throws an Error whose message is shown in the
// dialog. read may be async (an upload, say); the submit button is disabled
// meanwhile. `blocked` disables submitting altogether. Resolves null on cancel.
export function formDialog({ title, description, content = [], submitLabel = 'Continue', read, wide = false, blocked = false }) {
  const error = h('p', { class: 'field-error form-error', role: 'alert' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary', disabled: blocked }, submitLabel);
  const cancel = h('button', { type: 'button', class: 'btn' }, 'Cancel');
  const form = h('form', { class: 'stack', novalidate: true }, content, error, h('div', { class: 'modal-actions modal-actions-inline' }, cancel, submit));
  const handle = openDialog({ title, description, content: form, actions: [], cancelValue: null, wide });
  cancel.addEventListener('click', () => handle.close(null));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (blocked || submit.disabled) return;
    submit.disabled = true;
    form.setAttribute('aria-busy', 'true');
    error.textContent = '';
    try {
      handle.close(await read(form));
    } catch (e) {
      error.textContent = e instanceof Error ? e.message : String(e);
    } finally {
      submit.disabled = false;
      form.removeAttribute('aria-busy');
    }
  });
  form.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, select')?.focus();
  return handle.result;
}

// Shows exactly what will be signed and resolves true only when the person
// presses "Sign". `draft`, when given, is the full unsigned record (from
// draftRecord); its kind and body must equal `kind` and `body` if those are
// also given. `terms` is required for agreements; see termsFromBytes in
// format.mjs.
// `context` (nodes) is shown after the envelope: facts the signer should see
// alongside the record, such as the exact participant list of a genesis.
export async function confirmSign({ title = 'Review and sign', kind, body, terms, draft, namesById, context } = {}) {
  const problems = [];
  const signKind = draft?.kind ?? kind;
  const signBody = draft ? draft.body : body;
  if (draft && kind !== undefined && kind !== draft.kind) problems.push('The record kind differs from the prepared record.');
  if (draft && body !== undefined && prettyJson(body) !== prettyJson(draft.body)) problems.push('The record body differs from the prepared record.');
  if (typeof signKind !== 'string' || signKind === '') problems.push('No record kind was given.');
  if (signBody === undefined) problems.push('No record body was given.');

  const bodyText = revealHidden(prettyJson(signBody));
  const content = [
    h('p', { class: 'modal-desc' }, 'Your browser will sign the record below with your private key. A signed record cannot be taken back; later records can only add to it. Check every value.'),
    h('div', { class: 'sign-kind' }, kindBadge(signKind), ' ', h('code', {}, String(signKind ?? '(none)'))),
  ];

  if (draft) {
    content.push(
      h('p', { class: 'sign-summary' }, describeRecord(draft, namesById).text),
      facts([
        ['Signed as', h('span', {}, nameOf(draft.actor, namesById), ' ', mono(draft.actor))],
        ['Project', mono(draft.project)],
        ['Sequence', String(draft.sequence)],
        ['Follows record', draft.previous ? idCode(draft.previous) : 'none (genesis)'],
        ['Time', `${formatTime(draft.time)} (${draft.time})`],
        ['Record id', h('span', { title: draft.id }, shortId(draft.id, 16))],
      ], 'facts-envelope'),
    );
  }
  if (context) content.push(context);

  let digestsOk = true;
  let read = !terms;
  let signButton = null;
  const update = () => {
    if (signButton) signButton.disabled = !(problems.length === 0 && digestsOk && read);
  };
  if (terms) {
    // A proposal commits to the digest in its own body; check the terms against that.
    if (signKind === 'agreement.proposed' && terms.digestClaimed === undefined) terms = { ...terms, digestClaimed: signBody?.digest };
    problems.push(...termsBindingProblems(signKind, signBody, terms.digestClaimed));
    const section = termsSection(terms, (checked) => {
      read = checked;
      update();
    });
    digestsOk = section.canSign;
    content.push(...section.nodes);
    // Hub policy 5: the terms address is the ni: URI of the digest.
    if (signKind === 'agreement.proposed' && isSha256Hex(signBody?.digest) && signBody?.uri !== niUri(signBody.digest)) {
      content.push(notice('The terms address in the body is not the ni: URI of its digest, so this hub will refuse the record.', 'warn'));
    }
  } else if (signKind === 'agreement.proposed' || signKind === 'agreement.consented') {
    digestsOk = false;
    problems.push('Agreement records need the exact terms text and its digest before they can be signed.');
  }

  content.push(h('h3', { class: 'modal-section' }, 'Record body'));
  if (bodyText.count) {
    content.push(notice(`The body contains ${bodyText.count} invisible or control character${bodyText.count === 1 ? '' : 's'}, shown as ⟦U+…⟧ markers.`, 'warn'));
  }
  content.push(codeBlock(bodyText.text, 'Record body as JSON'));
  if (draft) {
    content.push(h('details', { class: 'envelope' }, h('summary', {}, 'Full unsigned record'), codeBlock(revealHidden(prettyJson(draft)).text, 'Full unsigned record as JSON')));
  }
  for (const p of problems) content.push(notice(p, 'danger'));

  const handle = openDialog({
    title,
    content,
    wide: true,
    cancelValue: false,
    actions: [
      { label: 'Cancel', value: false, autofocus: true },
      { label: 'Sign with my key', value: true, variant: 'primary', disabled: true },
    ],
  });
  signButton = handle.button(true);
  update();
  return (await handle.result) === true;
}
