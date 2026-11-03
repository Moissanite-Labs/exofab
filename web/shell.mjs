// Shared pieces of the page shell used by every view: the status region,
// page headings, error reporting, busy buttons, and small renderers for hub
// data. app.mjs fills in `hooks` so views can redraw the page or start the
// identity flow without importing app.mjs.
import { h, emptyState, notice } from './render.mjs';
import { oneLine, revealHidden } from './format.mjs';
import { HubHttpError, hubClient } from './api.mjs';
import { LocalRefusal } from './records.mjs';

// app.mjs sets status to the page's live status region at start-up.
export const hooks = {
  status: null,
  render: async () => {},
  identitiesChanged: async () => {},
  newIdentity: async () => {},
  registerIdentity: async () => {},
};

export function announce(message, tone = 'info') {
  const el = hooks.status;
  if (!el) return;
  el.dataset.tone = tone;
  // Clearing first makes a repeated message announce again.
  el.textContent = '';
  el.textContent = message;
}

export function pageHead(title, lead, ...actions) {
  const buttons = actions.flat().filter(Boolean);
  return h(
    'div',
    { class: 'page-head' },
    h('div', {}, h('h1', { tabindex: -1 }, title), lead ? h('p', { class: 'page-lead' }, lead) : null),
    buttons.length ? h('div', { class: 'btn-row' }, buttons) : null,
  );
}

export const list = (v) => (Array.isArray(v) ? v : []);
export const str = (v, fallback = '', max = 400) => (typeof v === 'string' && v !== '' ? oneLine(v, max) : fallback);

// Multi-line text for a .prose block: line breaks kept, hidden characters
// revealed, length capped.
export function prose(v, fallback = '', max = 8192) {
  if (typeof v !== 'string' || v.trim() === '') return fallback;
  return revealHidden(v.length > max ? `${v.slice(0, max - 1)}…` : v).text;
}

// Redraws the page with fresh data from the hub, for pages other people change.
export const refreshButton = () => actionButton('Refresh', async () => {}, { small: true });

export const hubFor = (identity) => hubClient(identity?.token ?? null);

// A sentence for any error, in the words a person needs to act on it.
export function describeError(error) {
  if (error instanceof HubHttpError) {
    if (error.status === 401) {
      return 'The hub does not recognise this identity’s session. If the hub’s data was reset, register this identity again from Profile.';
    }
    if (error.code === 'koinos') return `The hub’s Koinos verifier refused the record (${error.koinosCode ?? 'koinos'}): ${error.message}`;
    if (error.status === 404) return `Not found, or not shared with you: ${error.message}`;
    if (error.status === 403) return `Not allowed: ${error.message}`;
    if (error.status === 0) return error.message;
    return `The hub refused (${error.code}): ${error.message}`;
  }
  if (error instanceof LocalRefusal) return error.message;
  if (error?.name === 'KoinosError') return `Koinos rules refuse this (${error.code}): ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

// An inline, announced error notice. A rejected session offers re-registration.
export function problem(error, identity) {
  const box = notice(describeError(error), 'danger');
  if (error instanceof HubHttpError && error.status === 401 && identity) {
    box.append(' ', h('button', { type: 'button', class: 'btn btn-small', on: { click: () => hooks.registerIdentity(identity) } }, 'Register again'));
  }
  return box;
}

// Runs an action from a button: the button is disabled and marked busy while
// it runs, failures are announced, and the page is redrawn afterwards when
// `redraw` is set.
export async function act(button, fn, { redraw = true } = {}) {
  if (button) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  }
  try {
    await fn();
  } catch (error) {
    announce(describeError(error), 'error');
    console.warn(error);
  } finally {
    if (button) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }
  if (redraw) await hooks.render();
}

export function actionButton(label, fn, { variant, small = false, redraw = true, describedBy, disabled = false } = {}) {
  const button = h('button', {
    type: 'button',
    class: ['btn', variant && `btn-${variant}`, small && 'btn-small'],
    'aria-describedby': describedBy,
    disabled,
  }, label);
  button.addEventListener('click', () => act(button, fn, { redraw }));
  return button;
}

export function needIdentity(purpose) {
  return emptyState(
    `Create an identity in this browser to ${purpose}. Its key is generated and kept here; the hub never receives it.`,
    h('button', { type: 'button', class: 'btn btn-primary', on: { click: () => hooks.newIdentity() } }, 'New identity'),
  );
}

export function needRegistration(identity) {
  return emptyState(
    `${identity.name} is not registered with this hub yet. Registering signs the hub’s challenge with this browser’s key; only the public key leaves the browser.`,
    actionButton('Register with the hub', () => hooks.registerIdentity(identity), { variant: 'primary', redraw: false }),
  );
}

// Skill tags; skills in `matched` are highlighted.
export function skillTags(skills, matched = []) {
  const xs = list(skills).filter((s) => typeof s === 'string');
  if (!xs.length) return null;
  const have = new Set(matched);
  return h('ul', { class: 'tags', 'aria-label': 'Skills' }, xs.map((s) => h('li', { class: ['tag', have.has(s) && 'tag-match'] }, oneLine(s, 60))));
}

// Resolves to the value, or to `fallback` if the promise rejects.
export const settle = (promise, fallback = null) => promise.then((v) => v, () => fallback);
