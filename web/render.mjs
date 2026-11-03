// DOM-building helpers for the browser client. Text from records, the hub, or
// other people is only ever placed with textContent or setAttribute; nothing
// here parses markup, and URIs from records are shown as text, never linked
// or fetched.
import {
  describeRecord,
  stateView,
  namesFromState,
  kindGroup,
  kindLabel,
  shortId,
  formatTime,
  revealHidden,
  isSha256Hex,
} from './format.mjs';

// Attributes h() may set. Event handler attributes and inline styles are not
// here on purpose: the page runs under a Content Security Policy without
// 'unsafe-inline', and handlers are attached with `on`.
const ATTRIBUTES = new Set([
  'id', 'role', 'title', 'type', 'name', 'value', 'for', 'tabindex', 'hidden', 'disabled', 'checked',
  'selected', 'required', 'readonly', 'placeholder', 'maxlength', 'minlength', 'rows', 'autocomplete',
  'autofocus', 'spellcheck', 'lang', 'dir', 'datetime', 'colspan', 'scope', 'open', 'form', 'inputmode',
  'pattern', 'multiple', 'accept', 'download', 'novalidate', 'method', 'min', 'max', 'step',
]);

// Same-document and same-origin links only.
function safeHref(value) {
  const s = String(value);
  if (s.startsWith('#') || (s.startsWith('/') && !s.startsWith('//'))) return s;
  throw new Error('h(): only same-origin links are allowed');
}

function append(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === '') continue;
    if (Array.isArray(child)) append(parent, child);
    else if (child instanceof Node) parent.append(child);
    else parent.append(document.createTextNode(String(child)));
  }
}

// h('p', {class: 'note'}, 'Hello ', h('strong', {}, name)). Strings become
// text nodes. `on` takes {event: handler}; `text` sets textContent.
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value);
    else if (key === 'text') el.textContent = String(value);
    else if (key === 'on') for (const [type, fn] of Object.entries(value)) el.addEventListener(type, fn);
    else if (key === 'href') el.setAttribute('href', safeHref(value));
    else if (ATTRIBUTES.has(key) || key.startsWith('aria-') || key.startsWith('data-')) el.setAttribute(key, value === true ? '' : String(value));
    else throw new Error(`h(): attribute not allowed: ${key}`);
  }
  append(el, children);
  return el;
}

export function mount(parent, ...children) {
  parent.replaceChildren();
  append(parent, children);
  return parent;
}

// --- Small components ------------------------------------------------------------

export function badge(label, variant = 'neutral', extra) {
  return h('span', { class: ['badge', `badge-${variant}`, extra] }, label);
}

export function kindBadge(kind) {
  return h('span', { class: ['kind', `kind-${kindGroup(kind)}`], title: typeof kind === 'string' ? kind : undefined }, kindLabel(kind));
}

// State badges share one vocabulary: contribution statuses, delegation
// statuses, and consent. The CSS maps each to a colour.
export function stateBadge(state, label) {
  const safe = typeof state === 'string' && /^[a-z_]+$/.test(state) ? state : 'unknown';
  return h('span', { class: ['state', `state-${safe}`] }, label ?? safe.replace(/_/g, ' '));
}

export function idCode(id, label) {
  return h('code', { class: 'id', title: typeof id === 'string' ? id : undefined }, label ?? shortId(id));
}

// Full value in monospace, wrapping anywhere: digests, URIs, key ids.
export function mono(value) {
  return h('code', { class: 'mono' }, revealHidden(String(value ?? '')).text);
}

export function timeEl(iso) {
  return h('time', { datetime: typeof iso === 'string' ? iso : undefined }, formatTime(iso));
}

export function personEl(p) {
  return h('span', { class: 'who', title: p?.id ?? undefined }, p?.name ?? '(unknown)');
}

// <dl> of [label, value] pairs; value may be a string or a node.
export function facts(rows, extra) {
  return h('dl', { class: ['facts', extra] }, rows.filter(Boolean).map(([label, value]) => h('div', { class: 'fact' }, h('dt', {}, label), h('dd', {}, value))));
}

export function emptyState(message, extra) {
  return h('div', { class: 'empty' }, h('p', {}, message), extra);
}

export function notice(message, tone = 'info') {
  return h('div', { class: ['notice', `notice-${tone}`], role: tone === 'danger' ? 'alert' : undefined }, message);
}

export function errorState(error) {
  const message = error instanceof Error ? error.message : String(error);
  return notice(`Something went wrong: ${message}`, 'danger');
}

export function section(title, ...children) {
  return h('section', { class: 'panel' }, h('h2', { class: 'panel-title' }, title), children);
}

let fieldCount = 0;

// A labelled form control with an optional hint wired to aria-describedby.
export function field({ label, name, type = 'text', value, hint, required, multiline, rows = 4, maxlength, autocomplete, placeholder }) {
  const id = `field-${++fieldCount}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const common = { id, name, required, maxlength, autocomplete, placeholder, 'aria-describedby': hintId, class: 'input' };
  const control = multiline ? h('textarea', { ...common, rows }, value ?? '') : h('input', { ...common, type, value });
  return h('div', { class: 'field' }, h('label', { for: id }, label), control, hint ? h('p', { id: hintId, class: 'hint' }, hint) : null);
}

// A table inside a keyboard-scrollable wrapper, so narrow screens scroll the
// table rather than the page.
export function table({ caption, columns, rows }) {
  return h(
    'div',
    { class: 'table-wrap', tabindex: 0, role: 'region', 'aria-label': caption },
    h(
      'table',
      { class: 'table' },
      h('caption', { class: 'visually-hidden' }, caption),
      h('thead', {}, h('tr', {}, columns.map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', {}, rows.map((cells) => h('tr', {}, cells.map((cell) => h('td', {}, cell))))),
    ),
  );
}

// Offers bytes as a download from this page. The object URL is ours, not a
// URI from a record.
export function saveFile(bytes, filename, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// --- Records ------------------------------------------------------------------

const ROLE_TAG = { who: 'strong', ref: 'span', time: 'span', code: 'code', plain: null };

function sentenceNodes(parts) {
  return parts.map((p) => {
    const tag = ROLE_TAG[p.role] ?? null;
    return tag ? h(tag, { class: `part-${p.role}` }, p.text) : p.text;
  });
}

// One timeline entry: kind, plain-English sentence, sequence, time, short id,
// and any free text the record carries.
export function renderRecord(record, namesById) {
  const d = describeRecord(record, namesById);
  return h(
    'li',
    { class: ['timeline-item', `group-${d.group}`], 'data-kind': d.kind || undefined },
    h(
      'div',
      { class: 'timeline-head' },
      kindBadge(d.kind),
      h('span', { class: 'timeline-meta' }, d.sequence === null ? null : `#${d.sequence} · `, timeEl(d.time), ' · ', idCode(d.id)),
    ),
    h('p', { class: 'timeline-text' }, sentenceNodes(d.parts)),
    d.details.length
      ? h('dl', { class: 'details' }, d.details.map((x) => h('div', { class: 'detail' }, h('dt', {}, x.label), h('dd', { class: x.mono ? 'mono' : 'prose' }, x.value))))
      : null,
  );
}

// Oldest first, as the record was written.
export function renderTimeline(records, namesById) {
  const list = Array.isArray(records) ? records : [];
  if (list.length === 0) return emptyState('No records yet.');
  return h('ol', { class: 'timeline', 'aria-label': 'Project record, oldest first' }, list.map((r) => renderRecord(r, namesById)));
}

// --- Derived state -------------------------------------------------------------

function projectPanel(view) {
  const p = view.project;
  if (!p) return section('Project', emptyState('This project has no verified genesis record.'));
  return section(
    'Project',
    h('p', { class: 'project-title' }, p.title),
    p.description ? h('p', { class: 'prose' }, revealHidden(p.description).text) : null,
    facts([
      ['Steward', personEl(p.steward)],
      ['Records', String(view.count)],
      ['Head', view.head ? idCode(view.head) : 'none'],
      ['Project id', p.id ? mono(p.id) : 'unknown'],
    ]),
  );
}

function participantsPanel(view) {
  if (view.participants.length === 0) return section('Participants', emptyState('No participants listed.'));
  return section(
    'Participants',
    table({
      caption: 'Participants listed at genesis',
      columns: ['Name', 'Kind', 'Key'],
      rows: view.participants.map((p) => [personEl(p), badge(p.kind === 'agent' ? 'Agent' : p.kind === 'human' ? 'Person' : 'Unknown', p.kind === 'agent' ? 'steel' : 'neutral'), idCode(p.id)]),
    }),
  );
}

// A small button that hands its target to a callback from the view, with
// itself, so the view can mark it busy. Nothing is fetched here.
function cardButton(label, onClick, target) {
  if (typeof onClick !== 'function') return null;
  const button = h('button', { type: 'button', class: 'btn btn-small' }, label);
  button.addEventListener('click', () => onClick(target, button));
  return button;
}

function cardButtons(...buttons) {
  const shown = buttons.filter(Boolean);
  return shown.length ? h('div', { class: 'btn-row' }, shown) : null;
}

// onReadTerms(agreementId, button) and onDownload({digest, what, title}, button)
// come from the project view; without them the cards have no buttons.
function agreementCard(a, { onReadTerms, onDownload } = {}) {
  const title = `“${a.title}”`;
  return h(
    'article',
    { class: 'card' },
    h(
      'header',
      { class: 'card-head' },
      h('h3', { class: 'card-title' }, a.title),
      a.allConsented ? stateBadge('consented', 'All parties consent') : stateBadge('pending', 'Waiting for consent'),
    ),
    h(
      'ul',
      { class: 'consents', 'aria-label': 'Consent by party' },
      a.parties.map((p) => h('li', {}, personEl(p), ' ', p.consented ? stateBadge('consented', 'Consents') : stateBadge('pending', 'Does not consent'))),
    ),
    facts([
      ['Terms digest (SHA-256)', mono(a.digest)],
      ['Terms address', mono(a.uri)],
      ['Record', idCode(a.id)],
    ]),
    cardButtons(
      a.id ? cardButton(`Read the terms of ${title}`, onReadTerms, a.id) : null,
      isSha256Hex(a.digest) ? cardButton(`Download the terms of ${title}`, onDownload, { digest: a.digest, what: 'terms', title: a.title }) : null,
    ),
  );
}

function agreementsPanel(view, actions) {
  if (view.agreements.length === 0) return section('Agreements', emptyState('No agreement has been proposed yet.'));
  return section('Agreements', view.agreements.map((a) => agreementCard(a, actions)));
}

function delegationsPanel(view) {
  if (view.delegations.length === 0) return section('Delegations', emptyState('No delegations granted.'));
  return section(
    'Delegations',
    table({
      caption: 'Delegations to agents',
      columns: ['Agent', 'Granted by', 'Agreement', 'Expires', 'Status'],
      rows: view.delegations.map((d) => [
        personEl(d.agent),
        personEl(d.principal),
        d.agreement.title,
        h('span', {}, timeEl(d.expires), h('span', { class: 'subtle' }, ` (${d.expiresRelative})`)),
        stateBadge(d.status, d.statusLabel),
      ]),
    }),
  );
}

function contributionCard(c, { onDownload } = {}) {
  return h(
    'article',
    { class: 'card' },
    h('header', { class: 'card-head' }, h('h3', { class: 'card-title' }, c.title), stateBadge(c.status, c.statusLabel)),
    c.warnings.map((w) => notice(w, 'warn')),
    c.summary ? h('p', { class: 'prose' }, revealHidden(c.summary).text) : null,
    facts([
      ['Submitted by', personEl(c.submitter)],
      c.principal.id !== c.submitter.id ? ['On behalf of', personEl(c.principal)] : null,
      ['Agreement', c.agreement.title],
      c.delegation ? ['Delegation', h('span', {}, stateBadge(c.delegation.status, c.delegation.statusLabel), ' until ', timeEl(c.delegation.expires))] : null,
      ['Artifact digest (SHA-256)', mono(c.artifact.digest)],
      ['Artifact address', mono(c.artifact.uri)],
    ]),
    isSha256Hex(c.artifact.digest) ? cardButtons(cardButton(`Download the artifact of “${c.title}”`, onDownload, { digest: c.artifact.digest, what: 'artifact', title: c.title })) : null,
    h('h4', { class: 'card-subtitle' }, 'Reviews'),
    c.reviews.length
      ? h(
          'ol',
          { class: 'reviews' },
          c.reviews.map((r) =>
            h(
              'li',
              {},
              personEl(r.reviewer),
              ' ',
              stateBadge(r.decision === 'approve' ? 'reviewed' : 'changes_requested', r.decisionLabel),
              r.note ? h('p', { class: 'prose' }, revealHidden(r.note).text) : null,
            ),
          ),
        )
      : h('p', { class: 'subtle' }, 'No reviews yet.'),
    c.acceptance ? facts([['Accepted by', personEl(c.acceptance.by)], ['Citing review', idCode(c.acceptance.review)]], 'facts-ok') : null,
    c.dispute
      ? h('div', { class: 'dispute' }, facts([['Disputed by', personEl(c.dispute.by)]]), h('p', { class: 'prose' }, revealHidden(c.dispute.reason).text))
      : null,
  );
}

function contributionsPanel(view, actions) {
  if (view.contributions.length === 0) return section('Contributions', emptyState('No contributions submitted yet.'));
  return section('Contributions', view.contributions.map((c) => contributionCard(c, actions)));
}

// Panels for a project's verified derived state: the project, participants,
// agreements with consents, delegations, and contributions. onReadTerms and
// onDownload, when given, add buttons to read an agreement's terms and to
// save the cited terms and artifact bytes; every participant gets them.
export function renderState(state, { now = Date.now(), namesById, onReadTerms, onDownload } = {}) {
  const names = namesById ?? namesFromState(state);
  const view = stateView(state, { now, names });
  return h(
    'div',
    { class: 'state-panels' },
    projectPanel(view),
    participantsPanel(view),
    agreementsPanel(view, { onReadTerms, onDownload }),
    delegationsPanel(view),
    contributionsPanel(view, { onDownload }),
  );
}
