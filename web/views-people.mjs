// Profile (this browser's identities, the hub profile, my agents, my credit),
// another person's profile and credit, and the list of my projects.
import { h, section, emptyState, badge, facts, field, idCode, mono, notice, table, timeEl } from './render.mjs';
import { href } from './routes.mjs';
import { formatTime, shortId } from './format.mjs';
import { confirmAction, openDialog } from './dialog.mjs';
import { agentCommands, readProfile } from './actions.mjs';
import * as keys from './keys.mjs';
import { announce, pageHead, problem, list, str, skillTags, needIdentity, needRegistration, hubFor, hooks, actionButton, prose } from './shell.mjs';

// --- Credit -------------------------------------------------------------------------------

// Accepted contributions; `agents` names agent ids for the "via" line.
function creditList(items, agents = new Map()) {
  if (!list(items).length) return emptyState('No accepted contributions in projects you share. Credit is a record of accepted work, not money and not a score.');
  return h(
    'ul',
    { class: 'card-list' },
    list(items).map((c) =>
      h(
        'li',
        { class: 'card' },
        h('h3', { class: 'card-title' }, str(c.contribution?.title, 'Untitled contribution')),
        h('p', {}, 'In ', h('a', { href: href('project', { pid: c.project }) }, str(c.projectTitle, 'a project'))),
        c.contribution?.summary ? h('p', { class: 'prose' }, prose(c.contribution.summary)) : null,
        facts([
          ['Accepted', timeEl(c.acceptedAt)],
          c.via ? ['Submitted by agent', str(agents.get(c.via), shortId(c.via), 120)] : null,
          ['Artifact digest (SHA-256)', mono(str(c.contribution?.artifact?.digest, ''))],
        ]),
      ),
    ),
  );
}

// --- Profile ------------------------------------------------------------------------------

function identityFacts(identity) {
  return facts([
    ['Name in this browser', identity.name],
    ['Key id', mono(identity.id)],
    ['Created', formatTime(identity.createdAt)],
    ['Private key', 'Kept in this browser; it cannot be exported'],
    ['Hub registration', identity.token ? badge('Registered', 'steel') : badge('Not registered')],
  ]);
}

function profileForm(identity, me) {
  const listedId = 'profile-listed';
  const error = h('p', { class: 'field-error', role: 'alert' });
  const form = h(
    'form',
    { class: 'stack', novalidate: true },
    field({ label: 'Display name', name: 'name', value: me.name, maxlength: 256, autocomplete: 'off', hint: 'Shown to others, and written into project records you join.' }),
    field({ label: 'Headline', name: 'headline', value: me.headline ?? '', maxlength: 256, autocomplete: 'off' }),
    field({ label: 'Skills', name: 'skills', value: list(me.skills).join(', '), autocomplete: 'off', hint: 'Lowercase, separated by commas, for example: exo-skills, testing. Suggestions use only these.' }),
    field({ label: 'What you are seeking', name: 'seeking', value: list(me.seeking).join('\n'), multiline: true, rows: 3, hint: 'One per line.' }),
    h('div', { class: 'check' }, h('input', { type: 'checkbox', id: listedId, name: 'listed', checked: me.listed === true }), h('label', { for: listedId }, 'List my profile so other people on this hub can find me')),
    error,
    h('div', { class: 'btn-row' }, h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save profile')),
  );
  const submit = form.querySelector('button[type=submit]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    const data = new FormData(form);
    submit.disabled = true;
    try {
      const profile = readProfile({ name: data.get('name'), headline: data.get('headline'), skills: data.get('skills'), seeking: data.get('seeking'), listed: data.get('listed') === 'on' });
      const saved = await hubFor(identity).updateProfile(profile);
      if (saved.name !== identity.name) await keys.renameIdentity(identity.id, saved.name).catch(() => {});
      announce('Profile saved.', 'ok');
      await hooks.render();
    } catch (e) {
      error.textContent = e.message;
      announce(`Profile not saved: ${e.message}`, 'error');
    } finally {
      submit.disabled = false;
    }
  });
  return form;
}

async function showToken(identity) {
  const ok = await confirmAction({
    title: 'Show your session token?',
    message: 'Anyone with this token can act as you on this hub. Show it only to paste into your own terminal, for example to register an agent.',
    confirmLabel: 'Show token',
  });
  if (!ok) return;
  const input = h('input', { class: 'input mono', id: 'session-token', type: 'text', value: identity.token, readonly: true, spellcheck: 'false', autocomplete: 'off' });
  openDialog({
    title: 'Your session token',
    content: [
      notice('Keep this private. It is stored in this browser with your key and sent only to this hub.', 'warn'),
      h('div', { class: 'field' }, h('label', { for: 'session-token' }, 'Session token'), input),
    ],
    actions: [{ label: 'Close', value: null, autofocus: true }],
  });
  input.select();
}

function agentsSection(identity, me) {
  const agents = list(me.agents);
  return section(
    'My agents',
    agents.length
      ? table({ caption: 'Agents registered under your account', columns: ['Name', 'Key'], rows: agents.map((a) => [str(a.name, shortId(a.id), 120), mono(a.id)]) })
      : emptyState('No agents are registered under your account yet.'),
    h(
      'p',
      {},
      'An agent’s key belongs to the agent’s own runtime, never to this browser. Register an agent from the machine where it runs: the command creates its key there and signs the hub’s challenge with it, and the hub binds the agent to you as its responsible principal. Then nominate it on a brief before the record starts.',
    ),
    h('pre', { class: 'code-block', tabindex: 0, 'aria-label': 'Commands to register an agent and submit its work' }, agentCommands(location.origin)),
    h('div', { class: 'btn-row' }, actionButton('Show my session token', () => showToken(identity), { small: true, redraw: false })),
  );
}

async function removeLocalIdentity(entry) {
  const ok = await confirmAction({
    title: `Remove ${entry.name} from this browser?`,
    message: 'Its private key will be deleted. The key cannot be exported or recovered, so this identity will never sign again, here or anywhere.',
    confirmLabel: 'Remove identity and key',
    danger: true,
  });
  if (!ok) return;
  await keys.removeIdentity(entry.id);
  announce(`Removed ${entry.name} and its key from this browser.`, 'ok');
  await hooks.identitiesChanged();
}

async function localSection(identity) {
  let local = [];
  try {
    local = await keys.listIdentities();
  } catch (error) {
    return section('Identities in this browser', problem(error));
  }
  return section(
    'Identities in this browser',
    local.length
      ? table({
          caption: 'Identities in this browser',
          columns: ['Name', 'Key', 'Created', 'Hub', 'Actions'],
          rows: local.map((entry) => [
            entry.name,
            idCode(entry.id),
            formatTime(entry.createdAt),
            entry.registered ? badge('Registered', 'steel') : badge('Not registered'),
            h(
              'div',
              { class: 'btn-row' },
              entry.id === identity?.id ? badge('Current', 'accent') : actionButton('Use', () => keys.setCurrent(entry.id), { small: true, redraw: false }),
              actionButton('Remove', () => removeLocalIdentity(entry), { small: true, variant: 'danger', redraw: false }),
            ),
          ]),
        })
      : emptyState('No identities in this browser yet.'),
    notice('The switcher is a single-machine demonstration aid. Real use has one person per browser profile.', 'info'),
  );
}

export async function profileView({ identity }) {
  const title = 'Profile';
  const lead = 'Your identity in this browser, what you list on the hub, your agents, and your credit.';
  const local = await localSection(identity);
  if (!identity) return { title, nodes: [pageHead(title, lead), needIdentity('take part'), local] };
  const current = section('Current identity', identityFacts(identity));
  if (!identity.token) return { title, nodes: [pageHead(title, lead), current, needRegistration(identity), local] };
  const hub = hubFor(identity);
  let me;
  try {
    me = await hub.me();
  } catch (error) {
    return { title, nodes: [pageHead(title, lead), current, problem(error, identity), local] };
  }
  const credit = await hub.credit(me.id).then((items) => creditList(items, new Map(list(me.agents).map((a) => [a.id, a.name]))), (error) => problem(error, identity));
  return {
    title,
    nodes: [
      pageHead(title, lead, h('a', { class: 'btn', href: href('person', { id: me.id }) }, 'View as others see it')),
      current,
      section('Hub profile', profileForm(identity, me)),
      agentsSection(identity, me),
      section('My credit', credit),
      local,
    ],
  };
}

// --- Another person ---------------------------------------------------------------------------

export async function personView({ params, identity }) {
  const title = 'Person';
  const lead = 'Credit is a record of accepted work in projects you share, not money and not a score.';
  if (!identity) return { title, nodes: [pageHead(title, lead), needIdentity('see profiles')] };
  if (!identity.token) return { title, nodes: [pageHead(title, lead), needRegistration(identity)] };
  const hub = hubFor(identity);
  let person;
  try {
    person = await hub.getPerson(params.id);
  } catch (error) {
    const hidden = error?.status === 404;
    return {
      title,
      nodes: [
        pageHead(title, lead),
        hidden ? emptyState('This profile is not visible to you. Profiles are visible when listed, and to people who already work together.') : problem(error, identity),
      ],
    };
  }
  const credit = await hub.credit(person.id).then((items) => creditList(items), (error) => problem(error, identity));
  return {
    title: str(person.name, title, 80),
    nodes: [
      pageHead(str(person.name, 'Unnamed person', 256), lead),
      section(
        'Profile',
        person.headline ? h('p', { class: 'prose' }, str(person.headline)) : null,
        skillTags(person.skills),
        list(person.seeking).length ? h('div', {}, h('h3', { class: 'card-subtitle' }, 'Seeking'), h('ul', {}, list(person.seeking).map((s) => h('li', {}, str(s))))) : null,
        facts([['Key id', mono(person.id)], ['Listed', person.listed ? 'Yes' : 'No']]),
      ),
      section('Accepted contributions', credit),
    ],
  };
}

// --- My projects ------------------------------------------------------------------------------

const ROLE_LABEL = { steward: 'Steward', participant: 'Participant', agent: 'Agent' };

export async function projectsView({ identity }) {
  const title = 'My projects';
  const lead = 'Projects whose Koinos record lists you. Records and stored bytes are visible only to participants.';
  if (!identity) return { title, nodes: [pageHead(title, lead), needIdentity('take part in projects')] };
  if (!identity.token) return { title, nodes: [pageHead(title, lead), needRegistration(identity)] };
  const loaded = await hubFor(identity).listProjects().then((projects) => ({ projects }), (error) => ({ error }));
  const projects = loaded.projects;
  const body =
    loaded.error
      ? problem(loaded.error, identity)
      : list(projects).length
        ? h(
            'ul',
            { class: 'card-list' },
            list(projects).map((p) =>
              h(
                'li',
                { class: 'card' },
                h('div', { class: 'card-head' }, h('h3', { class: 'card-title' }, h('a', { href: href('project', { pid: p.project }) }, str(p.title, 'Untitled project'))), badge(ROLE_LABEL[p.role] ?? 'Participant', p.role === 'steward' ? 'accent' : 'steel')),
                facts([['Records', String(p.count)], ['Head', idCode(p.head)]]),
                p.brief ? h('a', { href: href('brief', { id: p.brief }) }, 'Brief') : null,
              ),
            ),
          )
        : emptyState('You are not a participant in any project yet. A project starts when a brief owner starts the record with their team.');
  return { title, nodes: [pageHead(title, lead), section('Projects', body)] };
}
