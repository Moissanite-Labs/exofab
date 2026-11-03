// Browser client entry: hash router, identity switcher, and registration.
// Views live in views-*.mjs and talk to the hub through api.mjs. Each person's
// signing key is generated here as a non-extractable WebCrypto key, kept in
// IndexedDB (keys.mjs), and used only to sign what confirmSign has shown.
import { h, mount, errorState, emptyState } from './render.mjs';
import { parseRoute, href } from './routes.mjs';
import { shortId, oneLine, cleanName } from './format.mjs';
import { promptText } from './dialog.mjs';
import { registerPerson } from './api.mjs';
import * as keys from './keys.mjs';
import { announce, describeError, hooks, pageHead } from './shell.mjs';
import { discoverView } from './views-discover.mjs';
import { briefView } from './views-brief.mjs';
import { projectView } from './views-project.mjs';
import { profileView, personView, projectsView } from './views-people.mjs';

const main = document.getElementById('main');
const status = document.getElementById('status');
const select = document.getElementById('identity-select');
const newButton = document.getElementById('identity-new');

async function notFoundView({ params }) {
  return {
    title: 'Not found',
    nodes: [pageHead('Page not found', null), emptyState(`There is no page at “${oneLine(params.path ?? '', 80)}”.`, h('a', { href: href('discover') }, 'Go to Discover'))],
  };
}

// Each view takes {params, identity} and resolves with {title, nodes}.
const VIEWS = {
  discover: discoverView,
  brief: briefView,
  projects: projectsView,
  project: projectView,
  profile: profileView,
  person: personView,
  notfound: notFoundView,
};

// Which primary nav item a route belongs to.
const NAV_FOR = { discover: 'discover', brief: 'discover', projects: 'projects', project: 'projects', profile: 'profile' };

function highlightNav(name) {
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === NAV_FOR[name]) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

// --- Router --------------------------------------------------------------------------

let renderTicket = 0;

async function render({ focus = false } = {}) {
  const route = parseRoute(location.hash);
  if (!route) return; // an in-page anchor, not a route
  if (route.redirect) history.replaceState(null, '', route.redirect);
  const ticket = ++renderTicket;
  highlightNav(route.name);
  main.setAttribute('aria-busy', 'true');
  let result;
  try {
    const identity = await keys.current().catch(() => null);
    result = await VIEWS[route.name]({ params: route.params, identity });
  } catch (error) {
    console.warn(error);
    result = { title: 'Error', nodes: [pageHead('Something went wrong', null), errorState(new Error(describeError(error)))] };
  }
  if (ticket !== renderTicket) return; // a newer navigation won
  mount(main, result.nodes);
  main.removeAttribute('aria-busy');
  main.dataset.view = route.name;
  document.title = `${result.title} · Exofab prototype`;
  if (focus) (main.querySelector('h1') ?? main).focus();
}

// --- Identities ----------------------------------------------------------------------

async function refreshIdentities() {
  let local = [];
  try {
    local = await keys.listIdentities();
  } catch (error) {
    announce(error.message, 'error');
  }
  let selected = keys.currentId();
  if (local.length && !local.some((i) => i.id === selected)) {
    selected = local[0].id;
    await keys.setCurrent(selected);
  }
  mount(
    select,
    local.length
      ? local.map((i) => h('option', { value: i.id, selected: i.id === selected }, `${i.name} · ${shortId(i.id)}`))
      : h('option', { value: '' }, 'No identity yet'),
  );
  select.disabled = local.length === 0;
}

async function switchTo(id) {
  try {
    const identity = await keys.setCurrent(id);
    select.value = id;
    announce(`Acting as ${identity.name}.`);
  } catch (error) {
    announce(error.message, 'error');
  }
}

// Proves possession of the browser-held key to the hub (challenge, signed
// proof text) and stores the session token with the key. Only the public key
// and the proof leave the browser.
async function registerIdentity(identity) {
  try {
    const { person, token } = await registerPerson({ identity, name: identity.name });
    await keys.saveToken(identity.id, token);
    announce(`${person?.name ?? identity.name} is registered with the hub. Only the public key and a signed proof left this browser.`, 'ok');
  } catch (error) {
    announce(`Registration failed: ${describeError(error)}`, 'error');
  }
  await refreshIdentities();
  await render();
}

async function newIdentity() {
  const name = await promptText({
    title: 'New identity',
    label: 'Name',
    hint: 'Use a made-up name such as Ada or Ben: this prototype is for synthetic data only.',
    submitLabel: 'Create key',
    validate: cleanName,
  });
  if (name === null) return;
  let identity;
  try {
    identity = await keys.createIdentity(name);
    await keys.setCurrent(identity.id);
    await refreshIdentities();
  } catch (error) {
    announce(error.message, 'error');
    return;
  }
  announce(`Created ${identity.name}. Its private key was generated in this browser and cannot be exported. Registering with the hub…`);
  await registerIdentity(identity);
}

// --- Start ------------------------------------------------------------------------------

function start() {
  hooks.status = status;
  if (!globalThis.crypto?.subtle) {
    announce('This page needs WebCrypto, which browsers provide only in a secure context such as http://127.0.0.1.', 'error');
  }
  document.querySelector('.skip-link')?.addEventListener('click', (event) => {
    event.preventDefault();
    main.focus();
  });
  // The selection can change from the switcher, the profile page, a removal,
  // or another tab; each time, resync the switcher and redraw the view.
  const sync = () => refreshIdentities().finally(() => render());
  Object.assign(hooks, { status, render, identitiesChanged: sync, newIdentity, registerIdentity });
  select.addEventListener('change', () => {
    if (select.value) switchTo(select.value);
  });
  newButton.addEventListener('click', newIdentity);
  window.addEventListener('hashchange', () => render({ focus: true }));
  window.addEventListener(keys.IDENTITY_EVENT, sync);
  // Another tab's verified-head pins (records.mjs) are not identity changes.
  window.addEventListener('storage', (event) => {
    if (!event.key?.startsWith('exofab.pin.')) sync();
  });
  sync();
}

start();
