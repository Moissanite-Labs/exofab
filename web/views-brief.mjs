// A brief: its roles and compensation statement, interest from candidates and
// the owner's decisions (a double opt-in), the team, agent nominations, and
// starting the Koinos record with the exact team as its participants.
import { h, section, emptyState, badge, field, facts, idCode, mono, notice, stateBadge, table, timeEl } from './render.mjs';
import { href } from './routes.mjs';
import { shortId } from './format.mjs';
import { confirmAction, formDialog } from './dialog.mjs';
import { startRecord } from './records.mjs';
import { NOMINATION_NOTE, PARTICIPANT_ACCESS_NOTE, canExpressInterest, interestDecision } from './actions.mjs';
import { announce, pageHead, problem, list, str, skillTags, needIdentity, needRegistration, hubFor, actionButton, settle, prose, refreshButton } from './shell.mjs';

const INTEREST_STATE = { pending: 'pending', accepted: 'accepted', declined: 'declined', withdrawn: 'withdrawn' };
const personLink = (id, name) => h('a', { href: href('person', { id }) }, name);

function interestBadge(status) {
  const label = { pending: 'Pending', accepted: 'Accepted', declined: 'Declined', withdrawn: 'Withdrawn' }[status] ?? 'Unknown';
  return stateBadge(INTEREST_STATE[status] ?? 'unknown', label);
}

export function participantsTable(participants, caption = 'Participants') {
  return table({
    caption,
    columns: ['Name', 'Kind', 'Key'],
    rows: list(participants).map((p) => [
      h('span', { class: 'who' }, str(p.name, shortId(p.id))),
      p.kind === 'agent' ? badge('Agent', 'steel') : badge('Person'),
      mono(p.id),
    ]),
  });
}

// --- Actions ----------------------------------------------------------------------------

async function expressInterest(ctx, role) {
  const interest = await formDialog({
    title: `Express interest: ${str(role.title, 'role', 120)}`,
    description: 'Only the brief owner and you can see this interest. You join the team only if the owner accepts it.',
    submitLabel: 'Send interest',
    content: [field({ label: 'Note to the owner', name: 'note', multiline: true, rows: 4, hint: 'Optional. What you bring and when you could start. Synthetic data only.' })],
    read: async (form) => {
      const note = String(new FormData(form).get('note') ?? '');
      return ctx.hub.expressInterest(ctx.brief.id, note.trim() === '' ? { role: role.id } : { role: role.id, note });
    },
  });
  if (interest) announce('Interest sent. The brief owner sees it in their inbox.', 'ok');
}

async function decide(ctx, interest, decision) {
  const name = str(interest.candidateName, 'this person', 120);
  const accept = decision === 'accept';
  const ok = await confirmAction({
    title: accept ? `Accept ${name} onto the team?` : `Decline ${name}’s interest?`,
    message: accept
      ? `${name} asked to join, and accepting completes the double opt-in. ${name} joins the team and the role is filled. When you start the record, the team becomes its fixed participant list.`
      : `${name} will see that the interest was declined. Nothing is recorded in any project.`,
    confirmLabel: accept ? 'Accept' : 'Decline',
    danger: !accept,
  });
  if (!ok) return;
  await ctx.hub.decideInterest(interest.id, decision);
  announce(accept ? `${name} joined the team.` : `Declined ${name}’s interest.`, 'ok');
}

async function withdraw(ctx, interest) {
  const ok = await confirmAction({ title: 'Withdraw your interest?', message: 'The owner will see it as withdrawn.', confirmLabel: 'Withdraw', danger: true });
  if (!ok) return;
  await ctx.hub.withdrawInterest(interest.id);
  announce('Interest withdrawn.', 'ok');
}

async function nominate(ctx, agent) {
  const ok = await confirmAction({
    title: `Nominate ${str(agent.name, 'your agent', 120)}?`,
    message: NOMINATION_NOTE,
    confirmLabel: 'Nominate',
  });
  if (!ok) return;
  await ctx.hub.nominateAgent(ctx.brief.id, agent.id);
  announce(`${str(agent.name, 'Your agent', 120)} is nominated.`, 'ok');
}

async function setBrief(ctx, changes, message) {
  await ctx.hub.updateBrief(ctx.brief.id, changes);
  announce(message, 'ok');
}

async function start(ctx) {
  const started = await startRecord({
    hub: ctx.hub,
    identity: ctx.identity,
    briefId: ctx.brief.id,
    context: (participants) => [
      h('h3', { class: 'modal-section' }, 'Participants, fixed by this record'),
      notice(`These are exactly the people and agents this record will list. Koinos 0.1 cannot add participants later. You become the steward. ${PARTICIPANT_ACCESS_NOTE}`, 'info'),
      participantsTable(participants, 'Participants this record will list'),
    ],
  });
  if (!started) return false;
  announce('The record has started. You are its steward.', 'ok');
  location.hash = href('project', { pid: started.project });
  return true;
}

// --- Sections ---------------------------------------------------------------------------

function rolesSection(ctx) {
  const { brief, me, isOwner, isMember } = ctx;
  const mine = list(brief.interests).filter((i) => i.candidate === me.id && i.status === 'pending');
  const canApply = canExpressInterest(brief, { isOwner, isMember });
  return section(
    'Roles',
    list(brief.roles).map((role) => {
      const pending = mine.some((i) => i.role === role.id);
      return h(
        'article',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('h3', { class: 'card-title' }, str(role.title, 'Unnamed role')), role.open ? badge('Open', 'steel') : badge('Filled')),
        skillTags(role.skills, list(me.skills)),
        facts([['Commitment', str(role.commitment, 'not stated')]]),
        canApply && role.open && !pending
          ? actionButton(`Express interest in ${str(role.title, 'this role', 120)}`, () => expressInterest(ctx, role), { variant: 'primary' })
          : null,
        pending ? h('p', { class: 'subtle' }, 'You expressed interest in this role. The owner has not decided yet.') : null,
      );
    }),
  );
}

function myInterestsSection(ctx) {
  const mine = list(ctx.brief.interests).filter((i) => i.candidate === ctx.me.id);
  if (ctx.isOwner || mine.length === 0) return null;
  const roleTitle = (id) => str(list(ctx.brief.roles).find((r) => r.id === id)?.title, id);
  return section(
    'Your interest',
    mine.map((i) =>
      h(
        'article',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('h3', { class: 'card-title' }, roleTitle(i.role)), interestBadge(i.status)),
        i.note ? h('p', { class: 'prose' }, prose(i.note)) : null,
        facts([['Sent', timeEl(i.created)], i.decided ? ['Decided', timeEl(i.decided)] : null]),
        i.status === 'pending' ? actionButton('Withdraw interest', () => withdraw(ctx, i), { small: true, variant: 'danger' }) : null,
      ),
    ),
  );
}

// Accept only when the hub would allow it; otherwise say why. Declining is
// always possible, so the owner can clear interests that can no longer be met.
function pendingControls(ctx, interest, name) {
  const decision = interestDecision(interest, ctx.brief);
  return [
    decision.accept ? null : h('p', { class: 'action-blocked' }, decision.reason),
    h(
      'div',
      { class: 'btn-row' },
      decision.accept ? actionButton(`Accept ${name}`, () => decide(ctx, interest, 'accept'), { variant: 'primary' }) : null,
      actionButton(`Decline ${name}`, () => decide(ctx, interest, 'decline'), { variant: 'danger' }),
    ),
  ];
}

function inboxSection(ctx) {
  if (!ctx.isOwner) return null;
  const interests = list(ctx.brief.interests);
  const role = (id) => list(ctx.brief.roles).find((r) => r.id === id);
  if (!interests.length) {
    return section('Interests', emptyState('No one has expressed interest yet. Interests are visible only to you and each candidate.'));
  }
  return section(
    'Interests',
    h('p', { class: 'subtle section-lead' }, 'Only you and each candidate see an interest. Accepting adds the candidate to the team.'),
    interests.map((i) => {
      const profile = ctx.profiles.get(i.candidate);
      const name = str(i.candidateName, shortId(i.candidate), 120);
      return h(
        'article',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('h3', { class: 'card-title' }, personLink(i.candidate, name)), interestBadge(i.status)),
        h('p', {}, 'Role: ', h('strong', {}, str(role(i.role)?.title, i.role))),
        i.note ? h('p', { class: 'prose' }, prose(i.note)) : h('p', { class: 'subtle' }, 'No note.'),
        profile
          ? h(
              'div',
              { class: 'profile-peek' },
              profile.headline ? h('p', {}, str(profile.headline)) : null,
              skillTags(profile.skills, list(role(i.role)?.skills)),
              list(profile.seeking).length ? h('p', { class: 'subtle' }, 'Seeking: ', list(profile.seeking).map((s) => str(s, '', 200)).join('; ')) : null,
            )
          : null,
        facts([['Sent', timeEl(i.created)], i.decided ? ['Decided', timeEl(i.decided)] : null]),
        i.status === 'pending' ? pendingControls(ctx, i, name) : null,
      );
    }),
  );
}

function suggestionsSection(ctx) {
  if (!ctx.isOwner || ctx.brief.project || ctx.brief.status !== 'open' || !list(ctx.brief.roles).some((r) => r.open)) return null;
  const items = list(ctx.suggestions);
  return section(
    'People who share these skills',
    h('p', { class: 'subtle section-lead' }, 'Listed people whose declared skills overlap an open role. They join only by expressing interest themselves.'),
    items.length
      ? h(
          'ul',
          { class: 'card-list' },
          items.map((s) =>
            h(
              'li',
              { class: 'card' },
              h('h3', { class: 'card-title' }, personLink(s.person.id, str(s.person.name, shortId(s.person.id), 120))),
              s.person.headline ? h('p', {}, str(s.person.headline)) : null,
              h('p', {}, 'Role: ', h('strong', {}, str(s.role?.title, 'role'))),
              h('ul', { class: 'reasons-list' }, list(s.reasons).map((r) => h('li', {}, str(r)))),
            ),
          ),
        )
      : emptyState('No listed person shares the skills of an open role yet.'),
  );
}

function teamSection(ctx) {
  const { brief, me } = ctx;
  if (!brief.team) return null;
  const myAgents = list(me.agents);
  const agentName = (id) => str(myAgents.find((a) => a.id === id)?.name ?? ctx.genesisNames.get(id), shortId(id), 120);
  const members = list(brief.team.members).map((id) => ({ id, name: str(ctx.profiles.get(id)?.name ?? ctx.genesisNames.get(id), shortId(id), 120) }));
  const nominable = myAgents.filter((a) => !list(brief.team.agents).includes(a.id));
  return section(
    'Team',
    table({
      caption: 'Team members and nominated agents',
      columns: ['Name', 'Kind', 'Key'],
      rows: [
        ...members.map((m) => [h('span', {}, personLink(m.id, m.name), m.id === brief.owner ? ' (owner)' : null), badge('Person'), idCode(m.id)]),
        ...list(brief.team.agents).map((id) => [agentName(id), badge('Agent', 'steel'), idCode(id)]),
      ],
    }),
    brief.project
      ? null
      : nominable.length
        ? h(
            'div',
            { class: 'btn-row' },
            nominable.map((a) => actionButton(`Nominate my agent ${str(a.name, shortId(a.id), 120)}`, () => nominate(ctx, a))),
          )
        : h('p', { class: 'subtle' }, myAgents.length ? 'All your agents are nominated.' : 'You have no agents registered. Agents register from their own runtime; see Profile.'),
  );
}

function startSection(ctx) {
  const { brief } = ctx;
  if (brief.project) {
    return ctx.isMember
      ? section('Project record', notice('The record has started. Its participants are fixed.', 'ok'), h('a', { class: 'btn btn-primary', href: href('project', { pid: brief.project }) }, 'Open the project record'))
      : null;
  }
  if (!ctx.isOwner) return null;
  if (list(brief.team?.members).length < 2) {
    return section(
      'Start the record',
      emptyState('A project needs at least two people on the team, because Koinos acceptance needs a reviewer who is neither the submitter nor the delegating principal. Accept someone’s interest first.'),
    );
  }
  return section(
    'Start the record',
    h('p', {}, 'Starting the record signs a Koinos project.created record that lists exactly the team below. Koinos 0.1 cannot add participants later, so nominate agents first.'),
    ctx.genesis ? participantsTable(ctx.genesis.body.participants, 'Participants the record will list') : ctx.genesisError ? problem(ctx.genesisError) : null,
    h('div', { class: 'btn-row' }, actionButton('Start the record', () => start(ctx), { variant: 'primary' })),
  );
}

// --- View -------------------------------------------------------------------------------

export async function briefView({ params, identity }) {
  const title = 'Brief';
  if (!identity) return { title, nodes: [pageHead(title, null), needIdentity('read briefs')] };
  if (!identity.token) return { title, nodes: [pageHead(title, null), needRegistration(identity)] };
  const hub = hubFor(identity);
  let brief;
  let me;
  try {
    [brief, me] = await Promise.all([hub.getBrief(params.id), hub.me()]);
  } catch (error) {
    return { title, nodes: [pageHead(title, null), problem(error, identity)] };
  }
  const isOwner = brief.owner === me.id;
  const isMember = !!brief.team;
  const people = new Set([brief.owner, ...list(brief.team?.members), ...list(brief.interests).map((i) => i.candidate)]);
  const profiles = new Map();
  await Promise.all([...people].map(async (id) => {
    const p = await settle(hub.getPerson(id));
    if (p) profiles.set(id, p);
  }));
  const ready = isOwner && !brief.project && list(brief.team?.members).length >= 2;
  const [suggestions, genesis] = await Promise.all([
    isOwner && !brief.project && brief.status === 'open' ? settle(hub.briefSuggestions(brief.id), []) : [],
    ready ? hub.genesisDraft(brief.id).then((g) => ({ g }), (error) => ({ error })) : {},
  ]);
  const ctx = {
    identity,
    hub,
    brief,
    me,
    isOwner,
    isMember,
    profiles,
    suggestions,
    genesis: genesis.g ?? null,
    genesisError: genesis.error ?? null,
    genesisNames: new Map(list(genesis.g?.body?.participants).map((p) => [p.id, p.name])),
  };
  const ownerName = str(profiles.get(brief.owner)?.name, shortId(brief.owner), 120);
  const ownerControls = isOwner
    ? [
        actionButton(brief.status === 'open' ? 'Close brief' : 'Reopen brief', () => setBrief(ctx, { status: brief.status === 'open' ? 'closed' : 'open' }, brief.status === 'open' ? 'Brief closed.' : 'Brief reopened.'), { small: true }),
        actionButton(brief.listed ? 'Unlist brief' : 'List brief', () => setBrief(ctx, { listed: !brief.listed }, brief.listed ? 'Brief unlisted.' : 'Brief listed.'), { small: true }),
      ]
    : [];
  return {
    title: str(brief.title, 'Brief', 80),
    nodes: [
      pageHead(str(brief.title, 'Untitled brief', 256), null, refreshButton(), ownerControls),
      section(
        'Brief',
        h('p', { class: 'prose' }, prose(brief.summary)),
        h('div', { class: 'compensation' }, h('h3', { class: 'card-subtitle' }, 'Compensation'), h('p', { class: 'prose' }, prose(brief.compensation, 'Not stated'))),
        facts([
          ['Owner', h('span', {}, personLink(brief.owner, ownerName), isOwner ? ' (you)' : null)],
          ['Status', badge(brief.status === 'open' ? 'Open' : 'Closed')],
          ['Listed', brief.listed ? 'Yes, visible to everyone on this hub' : 'No, visible only to people involved'],
          ['Published', timeEl(brief.created)],
          ['Brief id', idCode(brief.id)],
        ]),
      ),
      startSection(ctx),
      rolesSection(ctx),
      myInterestsSection(ctx),
      inboxSection(ctx),
      teamSection(ctx),
      suggestionsSection(ctx),
    ],
  };
}

