# Proposal: Exofab after the MVP

Status: proposal. Not adopted. Who decides for Exofab is open in #7. The decision request is #14. The split in this document was refined on 2026-11-02: formation can happen in Exofab before a build, and the build itself sits in Synbios. The reconciliation with #5 and with the Synbios handoff, and the decisions it needs, are proposed in #18. On 2026-11-03 the rule on filing, signing, payments, and tax submissions was revised: agents perform these acts under a per-act approval from an owner.

## What Exofab is for

Exofab work can start before any build. A team can form there. A company can form there.

Exofab also carries a product after it is built. An MVP is enough for that part.

Exofab turns a product into a real company. It helps get the product into the hands of users. It covers the company work, before the build and after it: forming the team, forming the company, ownership, sales, money, and taxes.

The build itself is not Exofab work. Building, and working together on the build, happens in Synbios.

## The split between projects

| Stage | Home | What happens there |
| --- | --- | --- |
| Formation, before the build | Exofab | People find each other, form a team, agree roles, and can form the company. |
| Build | Synbios | People and agents build software together. Synbios is like GitHub, redesigned from the ground up for agents first. Work is scoped, reviewed, and accepted there. |
| After the MVP | Exofab | The product becomes a company, or the company formed earlier takes it to users. The company reaches users and runs its money and tax work. |
| Agent work | Exo | Exo is the agent foundation. Agents from Exo can do prepared tasks in either place, inside the grants people give them. Filing a company paper, signing a document, moving money, and submitting a tax filing each need a per-act approval from an owner; see the rules below. |

## Work Exofab would cover

- **Forming the company.** The human owners choose where to form it and what form it takes, on advice from qualified people. Exofab lays out the options and what each one means. It does not make the choice. An agent prepares the papers and files them, each filing under its own approval from an owner. Exofab tracks each filing and its date. Where the law or the filing office requires a natural person, for example an identity check or a signature that must come from a named officer, that step stays with the owner, and the checklist names the rule and keeps the step as small as the rule allows.
- **Ownership structure.** Record who owns what share. Record what each person agreed in writing. Exofab stores the agreed terms. It does not set the terms.
- **Reaching users.** Plan the first launch. State who the first users are, what the price is, and which channel reaches them first.
- **Revenue.** Track how money comes in. Keep price, invoice, and payment records in the private store named under company records.
- **Accounting.** Keep the books in order. Track income and costs as they happen, not at the end of the year.
- **Taxes.** List what filings are due and when. An agent prepares and submits each filing on the advice of a qualified person, and every tax submission needs its own approval from an owner.
- **Company records.** Keep filings, agreements, and decisions in one place, so an owner can find any paper fast. That place is a private store the owners control, outside this repository and outside any public Exofab service. This repository holds record templates and synthetic examples only. Which store the first slice uses is an open question below.

## Rules

- People decide. Agents prepare drafts, checklists, dates, and records.
- **Approved acts.** Filing a company paper, signing a document, moving money, and submitting a tax filing are approved acts. An agent prepares and performs each of them. No grant, delegation, or standing approval covers an approved act. Each act needs its own exact-text approval from an owner, who sees the exact paper, document, payment, or filing before approving it, under the team's existing approval rules. A tax submission always needs its own approval. A step stays with a person only where a law or a provider requires a natural person; the record then names that rule and keeps the step as small as the rule allows. Automated decision making for these acts, such as a judge model deciding an approval, is a later feature that would need thorough testing and its own decision, and it is not part of this proposal. Bounded agent spending under a funder-approved policy is explored in Moissanite-Labs/synmerit#16 and is also outside this proposal.
- Legal and tax advice comes from qualified people. An agent then does the work on that advice. Exofab organises the work. It does not replace a lawyer or an accountant.
- Real company records are private. This public repository holds designs, templates, and proposals only. It must never hold a real company's papers, accounts, or tax data.

## First slice

Pick one real product that already has an MVP. Run one pilot from end to end:

1. Receive a handoff pack from Synbios. The pack names the product, the people and agents who built it, and the accepted work.
2. Make a company checklist for that product. List each step, its owner, and its date.
3. Draft the ownership terms for the owners to review, change, and sign outside Exofab.
4. Write a launch plan for the first users. State the price, the first channel, and the first sales steps.
5. Set up a money and tax calendar for the first 90 days. List income, costs, filing dates, and the records each filing needs.

The pilot delivers four things inside Exofab: the company checklist, the ownership terms for the owners to sign, the launch plan, and the calendar. Two things happen through approved acts: the company is formed, and the ownership record is signed. For each approved act the checklist records which agent performed it, which owner's approval covered it, and which steps a named rule kept with a person. The pilot is done when the owners can point to the four deliverables, and the checklist shows the formation and the signing as done, each act with its approval, with the papers in the owners' private store.

## Open questions

- Which country and state should the first slice support? Incorporation and tax rules differ by place.
- Which company forms should the first slice support?
- What fields does the Synbios handoff pack need? Ownership work needs a clear record of who built what.
- Which parts of a team charter stay in Exofab, and which parts become build tasks in Synbios?
- What data model holds company records, and which private store should the first slice use? Options seen so far: a private repository the owners control, an encrypted store on the owners' own machines, or a private hosted Exofab workspace, which does not exist yet. In every option this repository holds templates only.
- Which steps does the law or the filing office in the chosen place keep with a natural person? This is answered per place once the first place of incorporation is chosen, and each answer cites its rule.
- Who decides each of these? See #7.

## Relation to current proposals

This proposal changes the direction in #5, #8, #11, and #13.

- #5 and #8 put finding people and forming a team inside Exofab, before a build. This proposal keeps that work in Exofab. It moves the build steps of that slice to Synbios: delegating a build task, doing the work, and reviewing it.
- #11 records a credos draft that does not promise incorporation or equity allocation. This proposal makes both core Exofab work, with human agreements and human approval of each signature, filing, payment, and tax submission that an agent performs.
- #13 lists ventures as a later step, only if decided. This proposal makes ventures the main job.
