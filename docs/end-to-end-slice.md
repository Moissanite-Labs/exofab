# The first end-to-end slice: responsibilities, handoffs, example, and acceptance criteria

> **Proposal for review.** This document reconciles the open proposals in Exofab (#5, #6, #15), Synbios (Moissanite-Labs/synbios#50 and #51), and Synmerit (Moissanite-Labs/synmerit#16) against the boundary given on 2026-11-03. Nothing here is adopted. The decisions it depends on, and the order in which the open pull requests should change, are in the [reconciliation record](decisions/2026-11-03-slice-reconciliation.md). Who decides for Exofab is open in #7. Links to `first-slice.md` and `post-mvp-company.md` resolve once #5 and #15 are merged.

## The boundary

Given by Shahid Arifuddin on 2026-11-03, refining #14:

- **Synbios** is the self-contained source control and product-building hub. The build, and working together on the build, happen there.
- **Exofab** handles the venture and DAO-building work around a product, before or after the build: the team, the company, the ownership process, reaching users, revenue, accounting, and taxes.
- **Synmerit**, the home of the Koinos protocol, covers participation, ownership, and economic coordination: the portable record of who took part, what they agreed to, what was accepted, and the economic terms they chose.
- **Exo** is the agent foundation. Agents from Exo do prepared tasks in any of the three, inside the grants people give them, and perform the four approved acts only under a per-act approval.

**Approved acts.** Four acts need their own approval in every project of this slice: filing a company paper, signing a document, moving money, and submitting a tax filing. An agent prepares and performs each of them. No grant or standing approval covers the act. Each act needs its own exact-text approval from an owner, and a tax submission always needs its own. A step stays with a person only where a law or a provider requires a natural person, cited per step. This was directed on #15 on 2026-11-03 (decision D2 in the reconciliation record).

**Standalone and composed.** Each component stays useful on its own, as the compass record asks. The example and the handoffs below describe the composed slice, where all four work together. Standalone, Exofab does not require a running Synbios and does not duplicate the forge: the Koinos delegation is granted exactly as in the composed case, with its scope and expiry; the delegated task is done with the agent's own tools; and the work is submitted as artifact bytes under that active delegation, as the first slice in #5 allows. Only the Synbios steps are replaced, never the delegation. Synbios and Synmerit already run on their own. Each acceptance criterion says which case it covers.

## Responsibility matrix

Each cell says what that project does for the activity. An empty cell means the project has no part in it. The last column names the human decision or approval that no project and no agent can take over.

| Activity | Exofab | Synbios | Synmerit | Exo | People |
| --- | --- | --- | --- | --- | --- |
| Discovery and matching | Owns: briefs, declared profiles, explained suggestions, double opt-in | | | | Each person accepts or declines |
| Team and charter | Owns the process and the experience of agreement | | Records `project.created`, `agreement.proposed`, `agreement.consented` | Drafts the charter if asked | Each party consents with their own key |
| Sending an agent | Owns the decision, the scope, the expiry, and revocation | Holds the task grant: `claim`, `work`, `artifact`, `evidence`, `submit` | Records `delegation.granted` and `delegation.revoked` | Runs the agent under its own gate | The grantor decides |
| Build | Holds no forge. Standalone, the delegated task runs with the agent's own tools | Owns, self-contained: tasks, artifacts, test evidence, forge review, acceptance (composed case) | | Does the prepared work | A human other than the artifact author approves |
| Contribution record | Sequences the records in the pilot, with the exact Synbios export bytes as the artifact | Exports the task bundle | Defines and verifies `contribution.submitted`, `reviewed`, `accepted`, `disputed` | | Reviewer and steward are people |
| MVP handoff pack | Receives it and starts the company checklist from it | Produces it from the accepted tasks | May hold a reference to it (open) | | Participants consent to sharing it |
| Forming the company | Lays out the options, tracks each filing, its approval, and its date, keeps the checklist | | | Prepares the papers and files them under per-act approval | Owners choose the place and form on qualified advice, and approve each filing and signature; a step stays with a person only where a rule requires it |
| Ownership and participation terms | Runs the discussion, drafts the terms, tracks signatures and their approvals, points to the private store that holds the signed instrument | | Records the terms digest each owner consented to, and the credit that informs the terms | Drafts, and signs under per-act approval where a rule does not require a natural person | Owners decide the terms and approve each signature |
| Users, revenue, accounting, taxes | Owns the launch plan, the revenue and accounting records, and the tax calendar | | | Prepares plans, calendars, and record lists; moves money and submits filings under per-act approval | Owners approve each payment and each tax submission |
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

H2, H3, H4, and H6 exist only in the composed case. H1 exists in both, including the `delegation.granted` record. Standalone, H5 cites the agent's artifact bytes instead of a Synbios export, submitted under that active delegation, and the product record for the venture steps is assembled from the accepted Koinos contributions instead of a handoff pack.

## A synthetic end-to-end example

All names are fictional. Steps 1 to 5 follow the worked example in the [first slice](first-slice.md) proposed in #5. This is the composed case: the build steps sit in Synbios, as #14 directs for work done together on the build. Standalone, step 6, the Synbios grant in step 7, and steps 8 to 10 are replaced: Ben's Koinos delegation to scribe in step 7 stays, with its scope `contribution.submit` and its 14-day expiry; scribe does the work with its own tools; and step 11 submits those artifact bytes under that active delegation. If the delegation has expired or been revoked, refusal rule R-6 in the first slice blocks the submission in either case.

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

14. Exofab builds the company checklist from the pack: each step, its owner, and its date. Every approved act names the agent that will perform it and the owner, Ada or Ben, whose approval it needs.
15. Exofab lays out the formation options for the place and the form the owners are considering. Ada and Ben choose, on advice from a qualified person. An agent prepares the papers and shows Ada the exact filing. Ada approves it. The agent files it. Where the filing office requires a natural person, for example an identity check, Ada does that step and the checklist names the rule. The checklist records the filing as done, by which agent, under which approval. The papers go to the owners' private store (H9).
16. An agent drafts ownership terms from the charter and the credit summary (H7). Ada and Ben change them and agree them. Each sees the exact final text and approves the signature; the agent applies it, unless the signing rule in their place requires a named person to sign, in which case they sign themselves and the checklist names the rule. The signed instrument goes to the private store (H9). Each owner consents to the digest of the agreed text in a Koinos agreement record (H8).
17. Exofab holds the launch plan: the first users, the price, the first channel, and the first sales steps.
18. Exofab holds the 90-day money and tax calendar: income, costs, filing dates, and the records each filing needs. Each payment and each tax submission names the agent that will perform it and the owner whose per-act approval it needs. A tax submission always needs its own approval.

**Done when** the owners can point to the checklist, the agreed terms, the launch plan, and the calendar in Exofab; the checklist shows the formation and the signing as done, each act with the agent that did it and the approval that covered it; and a reader can trace the ownership record back through the handoff pack and the accepted tasks to the charter.

## Acceptance criteria

Synthetic data only. Where a criterion reuses the [first slice](first-slice.md#acceptance-criteria) criteria from #5, it says so. Each criterion names its case: both, standalone only, or composed only.

1. **E-1, formation.** Two people reach a team through their own actions. Every Koinos record is signed in its author's own client. The hub's data holds no private key. (First slice criteria 1 to 3.) Both cases.
2. **E-2, build start.** A Synbios project and task are created from the charter. The task text carries the Koinos project id, the agreement id, and the terms digest. The Synbios grant names only an agent listed in the Koinos project. Composed case.
3. **E-3, build.** The task reaches `accepted` in Synbios with current passing test evidence and a review by a human who is not the artifact author. The export verifies with `synbios verify`. Composed case.
4. **E-4, contribution record.** The Koinos contribution cites the exact artifact bytes: the Synbios export in the composed case, the agent's artifact standalone. Delegation, review, acceptance, and refusals follow first slice criteria 4 to 8. In both cases the submission needs an active, scoped, expiring delegation from the agent's own principal (first slice criterion 4 and R-6). The bundle verifies with both verifiers and re-imports to the same head, participants, and attribution. Both cases.
5. **E-5, handoff pack.** One pack carries the six fields proposed in synbios#51. Every accepted task in it has an export that verifies. The contributors and reviewers named in the pack match the Koinos attribution for those tasks. Each participant's consent to sharing is recorded. Composed case; standalone, the product record is assembled from the accepted Koinos contributions and E-10 covers its trace.
6. **E-6, approved acts.** Every approved act in the checklist records the agent that performed it and the owner's per-act approval that covered it, or the rule that kept the step with a person. An agent cannot perform an approved act under a grant or a standing approval alone, and a test shows the refusal. A tax submission without its own approval is refused. Both cases.
7. **E-7, ownership terms.** The agreed terms exist as bytes with a digest. Each owner consents to that digest with their own key. The consent records verify. Both cases.
8. **E-8, private records.** No real company record, name, or account enters any public repository or hub log. A check runs against the synthetic pack, or the standalone product record, and the hub data. Both cases.
9. **E-9, launch and calendar.** The launch plan and the 90-day calendar exist, and each item names its owner and its date. Both cases.
10. **E-10, traceability.** From the ownership record, a reader reaches the handoff pack or the standalone product record, each accepted contribution's artifact bytes, and the charter text, without Exofab running. Both cases.

## Outside this slice

- Funding requests, funder rights, and bounded agent spending (Moissanite-Labs/synmerit#16). The ownership record above is the input that design needs. Automated decision making for approved acts is a later feature outside this slice.
- Token ownership and settlement (Moissanite-Labs/synmerit#6). The slice uses Koinos 0.1 agreement records only.
- A DAO legal wrapper. No current document defines one (D7).
- Matching records in Koinos (#11).
- An Exo channel into Exofab or Synbios (#13), and any change in the Exo repositories.
