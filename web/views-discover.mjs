// Discover: listed briefs, "Suggested for you" with the reason for each
// suggestion, and the form that publishes a brief.
import { h, section, emptyState, badge, field } from './render.mjs';
import { href } from './routes.mjs';
import { formDialog } from './dialog.mjs';
import { CLIENT_LIMITS, readBrief } from './actions.mjs';
import { announce, pageHead, problem, list, str, prose, skillTags, needIdentity, needRegistration, hubFor } from './shell.mjs';

const briefLink = (brief) => h('a', { href: href('brief', { id: brief.id }) }, str(brief.title, 'Untitled brief', 200));

function suggestionCard(s) {
  return h(
    'li',
    { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', { class: 'card-title' }, briefLink(s.brief)), badge('Suggested for you', 'steel')),
    h('p', {}, 'Role: ', h('strong', {}, str(s.role?.title, 'unnamed role'))),
    s.brief?.summary ? h('p', { class: 'prose' }, str(s.brief.summary)) : null,
    h(
      'div',
      { class: 'reasons' },
      h('p', { class: 'reasons-label' }, 'Why you see this'),
      h('ul', { class: 'reasons-list' }, list(s.reasons).map((r) => h('li', {}, str(r)))),
    ),
  );
}

export function briefCard(brief, { me, skills = [] } = {}) {
  const roles = list(brief.roles);
  return h(
    'li',
    { class: 'card' },
    h(
      'div',
      { class: 'card-head' },
      h('h3', { class: 'card-title' }, briefLink(brief)),
      h(
        'span',
        { class: 'badges' },
        brief.owner === me ? badge('Your brief', 'accent') : brief.team ? badge('Your team', 'steel') : null,
        badge(brief.status === 'open' ? 'Open' : 'Closed'),
        brief.project ? badge('Record started', 'steel') : null,
      ),
    ),
    brief.summary ? h('p', { class: 'prose' }, str(brief.summary)) : null,
    h('p', { class: 'subtle prose' }, 'Compensation: ', prose(brief.compensation, 'not stated', 600)),
    roles.map((role) =>
      h('div', { class: 'role-line' }, h('p', {}, h('strong', {}, str(role.title, 'Unnamed role')), role.open ? null : ' (filled)'), skillTags(role.skills, skills)),
    ),
  );
}

function roleFields(rolesBox) {
  const fieldset = h(
    'fieldset',
    { class: 'role-fields' },
    h('legend', {}, 'Role'),
    field({ label: 'Role title', name: 'role-title', maxlength: CLIENT_LIMITS.title, autocomplete: 'off', placeholder: 'For example: Skill builder' }),
    field({
      label: 'Skills',
      name: 'role-skills',
      autocomplete: 'off',
      placeholder: 'exo-skills, testing',
      hint: 'Lowercase, separated by commas. People who list one of these skills see this brief as a suggestion, with that reason.',
    }),
    field({ label: 'Commitment', name: 'role-commitment', maxlength: CLIENT_LIMITS.title, autocomplete: 'off', placeholder: 'For example: a few evenings' }),
  );
  const remove = h('button', { type: 'button', class: 'btn btn-small btn-quiet' }, 'Remove this role');
  remove.addEventListener('click', () => {
    if (rolesBox.children.length > 1) fieldset.remove();
    numberRoles(rolesBox);
  });
  fieldset.append(remove);
  return fieldset;
}

function numberRoles(rolesBox) {
  [...rolesBox.children].forEach((fieldset, i) => {
    fieldset.querySelector('legend').textContent = `Role ${i + 1}`;
    fieldset.querySelector('button').hidden = rolesBox.children.length === 1;
  });
}

// Opens the publish form and, on success, goes to the new brief.
export async function publishBrief(identity) {
  const rolesBox = h('div', { class: 'stack' });
  rolesBox.append(roleFields(rolesBox));
  numberRoles(rolesBox);
  const addRole = h('button', { type: 'button', class: 'btn btn-small' }, 'Add another role');
  addRole.addEventListener('click', () => {
    if (rolesBox.children.length >= CLIENT_LIMITS.roles) {
      announce(`A brief can have at most ${CLIENT_LIMITS.roles} roles.`);
      return;
    }
    rolesBox.append(roleFields(rolesBox));
    numberRoles(rolesBox);
    rolesBox.lastElementChild.querySelector('input')?.focus();
  });
  const listedId = 'brief-listed';
  const brief = await formDialog({
    title: 'Publish a brief',
    description: 'Describe the project and the roles you need. Use synthetic data only: this is a local prototype.',
    wide: true,
    submitLabel: 'Publish brief',
    content: [
      field({ label: 'Title', name: 'title', maxlength: CLIENT_LIMITS.title, autocomplete: 'off' }),
      field({ label: 'Summary', name: 'summary', multiline: true, rows: 4, hint: 'What the project is and who it is for.' }),
      field({
        label: 'Compensation statement',
        name: 'compensation',
        multiline: true,
        rows: 2,
        placeholder: 'For example: None offered. Credit is recorded for accepted work only.',
        hint: 'Required. Say plainly whether any compensation is offered, even if none is. Exofab records no payments.',
      }),
      rolesBox,
      h('div', { class: 'btn-row' }, addRole),
      h(
        'div',
        { class: 'check' },
        h('input', { type: 'checkbox', id: listedId, name: 'listed', checked: true }),
        h('label', { for: listedId }, 'List this brief so other people on this hub can find it'),
      ),
    ],
    read: async (form) => {
      const data = new FormData(form);
      const titles = data.getAll('role-title');
      const skills = data.getAll('role-skills');
      const commitments = data.getAll('role-commitment');
      const body = readBrief({
        title: data.get('title'),
        summary: data.get('summary'),
        compensation: data.get('compensation'),
        roles: titles.map((title, i) => ({ title, skills: skills[i], commitment: commitments[i] })),
        listed: data.get('listed') === 'on',
      });
      return hubFor(identity).publishBrief(body);
    },
  });
  if (!brief) return;
  announce(`Published “${str(brief.title, 'brief', 120)}”.`, 'ok');
  location.hash = href('brief', { id: brief.id });
}

export async function discoverView({ identity }) {
  const lead = 'Briefs people have listed, and briefs whose open roles share skills you listed, each with the reason it was suggested. Suggestions are visible only to you.';
  const title = 'Discover';
  if (!identity) return { title, nodes: [pageHead(title, lead), needIdentity('discover briefs and publish your own')] };
  if (!identity.token) return { title, nodes: [pageHead(title, lead), needRegistration(identity)] };
  const hub = hubFor(identity);
  const publish = h('button', { type: 'button', class: 'btn btn-primary', on: { click: () => publishBrief(identity) } }, 'Publish a brief');
  const [me, suggestions, briefs] = await Promise.allSettled([hub.me(), hub.suggestions(), hub.listBriefs()]);
  if (me.status === 'rejected') return { title, nodes: [pageHead(title, lead, publish), problem(me.reason, identity)] };
  const skills = list(me.value.skills);

  const suggested =
    suggestions.status === 'rejected'
      ? problem(suggestions.reason, identity)
      : list(suggestions.value).length
        ? h('ul', { class: 'card-list' }, list(suggestions.value).map(suggestionCard))
        : emptyState(
            skills.length
              ? 'No listed, open brief has a role that shares the skills on your profile right now.'
              : 'No suggestions yet. Suggestions come only from skills you list on your profile.',
            skills.length ? null : h('a', { href: href('profile') }, 'Add skills to your profile'),
          );

  const listed =
    briefs.status === 'rejected'
      ? problem(briefs.reason, identity)
      : list(briefs.value).length
        ? h('ul', { class: 'card-list' }, list(briefs.value).map((b) => briefCard(b, { me: me.value.id, skills })))
        : emptyState('No listed briefs yet. Publish one to start.');

  return {
    title,
    nodes: [
      pageHead(title, lead, publish),
      section('Suggested for you', h('p', { class: 'subtle section-lead' }, 'Matched only on skills you declared. There are no scores or rankings.'), suggested),
      section('Listed briefs', listed),
    ],
  };
}
