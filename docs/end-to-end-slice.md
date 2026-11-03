# The first end-to-end slice: responsibilities, handoffs, example, and acceptance criteria

> **Proposal for review.** This document reconciles the open proposals in Exofab (#5, #6, #15), Synbios (Moissanite-Labs/synbios#50 and #51), and Synmerit (Moissanite-Labs/synmerit#16) against the boundary given on 2026-11-03. Nothing here is adopted. The decisions it depends on, and the order in which the open pull requests should change, are in the [reconciliation record](decisions/2026-11-03-slice-reconciliation.md). Who decides for Exofab is open in #7. Links to `first-slice.md` and `post-mvp-company.md` resolve once #5 and #15 are merged.

## The boundary

Given by Shahid Arifuddin on 2026-11-03, refining #14:

- **Synbios** is the self-contained source control and product-building hub. The build, and working together on the build, happen there.
- **Exofab** handles the venture and DAO-building work around a product, before or after the build: the team, the company, the ownership process, reaching users, revenue, accounting, and taxes.
- **Synmerit**, the home of the Koinos protocol, covers participation, ownership, and economic coordination: the portable record of who took part, what they agreed to, what was accepted, and the economic terms they chose.
- **Exo** is the agent foundation. Agents from Exo do prepared tasks in any of the three, inside the grants people give them, and never a reserved act.

**Reserved acts.** Four acts are reserved to people in every project of this slice: filing a company paper, signing a document, moving money, and submitting a tax filing. An agent may prepare each of them. No grant covers the act itself. This is proposed in #15 and needs confirmation (decision D2 in the reconciliation record).

## Responsibility matrix

Each cell says what that project does for the activity. An empty cell means the project has no part in it. The last column names the human act that no project and no agent can take over.

| Activity | Exofab | Synbios | Synmerit | Exo | People |
| --- | --- | --- | --- | --- | --- |
| Discovery and matching | Owns: briefs, declared profiles, explained suggestions, double opt-in | | | | Each person accepts or declines |
| Team and charter | Owns the process and the experience of agreement | | Records `project.created`, `agreement.proposed`, `agreement.consented` | Drafts the charter if asked | Each party consents with their own key |
| Sending an agent | Owns the decision, the scope, the expiry, and revocation | Holds the task grant: `claim`, `work`, `artifact`, `evidence`, `submit` | Records `delegation.granted` and `delegation.revoked` | Runs the agent under its own gate | The grantor decides |
| Build | | Owns, self-contained: tasks, artifacts, test evidence, forge review, acceptance | | Does the prepared work | A human other than the artifact author approves |
| Contribution record | Sequences the records in the pilot, with the exact Synbios export bytes as the artifact | Exports the task bundle | Defines and verifies `contribution.submitted`, `reviewed`, `accepted`, `disputed` | | Reviewer and steward are people |
| MVP handoff pack | Receives it and starts the company checklist from it | Produces it from the accepted tasks | May hold a reference to it (open) | | Participants consent to sharing it |
| Forming the company | Lays out the options, tracks each filing and its date, keeps the checklist | | | Prepares the papers | Owners choose, file, and sign, on advice from qualified people |
| Ownership and participation terms | Runs the discussion, drafts the terms, tracks signatures, points to the private store that holds the signed instrument | | Records the terms digest each owner consented to, and the credit that informs the terms | Drafts | Owners decide and sign |
| Users, revenue, accounting, taxes | Owns the launch plan, the revenue and accounting records, and the tax calendar | | | Prepares plans, calendars, and record lists | Moving money and submitting a tax filing |
| Funding, rights, bounded spending | Hosts the human side of a funding request, later | | Design scope of Moissanite-Labs/synmerit#16; not in this slice | | Funders consent to exact terms |
| Private company records | Holds templates and synthetic examples only; points to the owners' store | | | | Owners control the store |

## Handoffs

| # | From, to | What crosses | State | Where |
| --- | --- | --- | --- | --- |
| H1 | Exofab to Synmerit | Project, agreement, consent, and delegation records, each signed in its author's own client | Implemented in the #6 prototype; proposed as P-3 in #5 | [first slice](first-slice.md) in #5; `src/koinos/` in #6 |
| H2 | Exofab to Synbios | Build-start record: team members, roles, the charter digest, and who may accept finished work | Shape proposed in synbios#51; the #6 adapter already turns a charter into `task.create` with the agreement digest in the task text | synbios#50, synbios#51; `src/adapters/synbios.mjs` in #6 |
| H3 | Exo to Synbios | An agent works under a task grant with named capabilities | Implemented in Synbios 0.1; the Exo channel itself is a later step (#13) outside this slice | synbios `docs/trust-model.md` |
| H4 | Synbios to Exofab | Task export: task, artifacts, evidence, reviews, audit events; verifiable with `synbios verify` | Implemented in Synbios 0.1; interop tested in #6 against synbios c285f07 | synbios README |
| H5 | Exofab to Synmerit | Contribution submitted, reviewed, and accepted, with the exact export bytes as the artifact | Implemented in #6; whether Synbios writes these records itself later is open (D5) | [first slice](first-slice.md), "How the slice can use Synbios" |
| H6 | Synbios to Exofab | MVP handoff pack: product and revision, accepted tasks with evidence, contributors and reviewers, third party code and licenses, known defects, people who can act | Proposed in synbios#51; not implemented | synbios#51 |
| H7 | Synmerit to Exofab | Attribution and credit summary that informs the ownership discussion | Implemented in Koinos 0.1 `summarize`; token ownership (synmerit#6) and funding rights (synmerit#16) are separate proposals | synmerit README |
| H8 | Exofab to Synmerit | The ownership terms digest each owner consented to | Proposed here (D4); uses Koinos 0.1 agreement records unchanged | this document |
| H9 | Exofab to the owners' private store | Filings, the signed ownership instrument, invoices, payment and tax records | Proposed in #15; which store is open (D3) | [post-MVP proposal](post-mvp-company.md) in #15 |

## A synthetic end-to-end example

All names are fictional. Steps 1 to 5 follow the worked example in the [first slice](first-slice.md) proposed in #5. The build steps sit in Synbios, as #14 directs.

**Formation, in Exofab**

1. Ada runs a community of home bakers. She publishes a brief for a recipe-scaling skill for Exo, with one open role.
2. Ben builds Exo skills. The hub suggests the brief from his declared skills and shows why. Ben expresses interest. Ada accepts. They are a team.
3. Ben nominates his agent, scribe, which he registered under his own account.
4. Ada starts the record. Her browser signs `project.created`, listing Ada, Ben, and scribe (H1).
5. Ada proposes the charter: scope, acceptance criteria, how credit is recorded, and a statement that the record creates no economic right. Ada and Ben each consent with their own key (H1).

**Build start, from Exofab to Synbios**

6. The hub creates the Synbios project and the first task from the charter. The task text carries the Koinos project id, the agreement id, and the terms digest. Ada is the person who may accept finished work (H2).
7. Ben delegates `contribution.submit` to scribe under the charter, expiring in 14 days (H1). In Synbios, Ada grants scribe `claim`, `work`, `artifact`, `evidence`, and `submit` on the task (H3).

**Build, in Synbios**

8. Scribe claims the task, captures a Git revision, records test evidence tied to it, and submits for review.
9. Ada reviews in Synbios and approves. The task is accepted and sealed.
10. Ada exports the task bundle. `synbios verify` passes (H4).

**Contribution record, in Exofab and Synmerit**

11. Scribe submits a Koinos contribution that cites the exact export bytes by digest. Ada reviews and approves. Ada accepts as steward (H5).
12. The Koinos bundle exports and verifies with both the Exofab verifier and the Koinos reference verifier.

Steps 6 to 12 repeat for each task until Ada and Ben agree that the product is an MVP.

**MVP handoff, from Synbios to Exofab**

13. Ada and Ben name the MVP revision. Synbios produces the handoff pack: the product and revision; the accepted tasks with their evidence; the contributors, Ada, Ben, and scribe, and the reviewer, Ada; third party code and licenses; known defects; and the people who can act for the product, Ada and Ben. Both consent to sharing it (H6).

**Venture, in Exofab**

14. Exofab builds the company checklist from the pack: each step, its owner, and its date. Every reserved act names Ada or Ben, or an adviser they engage.
15. Exofab lays out the formation options for the place and the form the owners are considering. Ada and Ben choose, on advice from a qualified person. An agent prepares the papers. Ada files and signs. The checklist records the filing as done. The papers go to the owners' private store (H9).
16. An agent drafts ownership terms from the charter and the credit summary (H7). Ada and Ben change them, agree them, and sign outside Exofab. The signed instrument goes to the private store (H9). Each owner consents to the digest of the agreed text in a Koinos agreement record (H8).
17. Exofab holds the launch plan: the first users, the price, the first channel, and the first sales steps.
18. Exofab holds the 90-day money and tax calendar: income, costs, filing dates, and the records each filing needs. Each payment and each tax submission names the person who will do it.

**Done when** the owners can point to the checklist, the agreed terms, the launch plan, and the calendar in Exofab; the checklist shows the formation and the signing as done by named people; and a reader can trace the ownership record back through the handoff pack and the accepted tasks to the charter.

## Acceptance criteria

Synthetic data only. Where a criterion reuses the [first slice](first-slice.md#acceptance-criteria) criteria from #5, it says so.

1. **E-1, formation.** Two people reach a team through their own actions. Every Koinos record is signed in its author's own client. The hub's data holds no private key. (First slice criteria 1 to 3.)
2. **E-2, build start.** A Synbios project and task are created from the charter. The task text carries the Koinos project id, the agreement id, and the terms digest. The Synbios grant names only an agent listed in the Koinos project.
3. **E-3, build.** The task reaches `accepted` in Synbios with current passing test evidence and a review by a human who is not the artifact author. The export verifies with `synbios verify`.
4. **E-4, contribution record.** The Koinos contribution cites the exact export bytes. Delegation, review, acceptance, and refusals follow first slice criteria 4 to 8. The bundle verifies with both verifiers and re-imports to the same head, participants, and attribution.
5. **E-5, handoff pack.** One pack carries the six fields proposed in synbios#51. Every accepted task in it has an export that verifies. The contributors and reviewers named in the pack match the Koinos attribution for those tasks. Each participant's consent to sharing is recorded.
6. **E-6, reserved acts.** Every reserved act in the checklist names a person. An agent credential cannot mark a reserved act as done, and a test shows the refusal.
7. **E-7, ownership terms.** The agreed terms exist as bytes with a digest. Each owner consents to that digest with their own key. The consent records verify.
8. **E-8, private records.** No real company record, name, or account enters any public repository or hub log. A check runs against the synthetic pack and the hub data.
9. **E-9, launch and calendar.** The launch plan and the 90-day calendar exist, and each item names its owner and its date.
10. **E-10, traceability.** From the ownership record, a reader reaches the handoff pack, each accepted task's export, and the charter text, without Exofab running.

## Outside this slice

- Funding requests, funder rights, and bounded agent spending (Moissanite-Labs/synmerit#16). The ownership record above is the input that design needs.
- Token ownership and settlement (Moissanite-Labs/synmerit#6). The slice uses Koinos 0.1 agreement records only.
- A DAO legal wrapper. No current document defines one (D7).
- Matching records in Koinos (#11).
- An Exo channel into Exofab or Synbios (#13), and any change in the Exo repositories.
