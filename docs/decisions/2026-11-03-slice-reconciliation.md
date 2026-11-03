# Reconciliation of the first end-to-end slice, 2026-11-03

Status: proposal, prepared for decision. Not adopted. The decision owner is open in #7.

This record reconciles the open proposals in Exofab, Synbios, and Synmerit against the boundary given by Shahid Arifuddin on 2026-11-03. It separates what is implemented, what is proposed, and what is undecided. It lists the decisions needed and the order in which the open pull requests should change. The responsibility matrix, the handoffs, the synthetic example, and the acceptance criteria are in [end-to-end-slice.md](../end-to-end-slice.md).

## Ownership check

Read from the compass coordination log of 2026-11-03 (`ecosystem-map/2026-11-03-log.md` in Moissanite-Labs/compass, merged in compass #10):

- Lane 1, exo backlog health, is the active lane. It covers the exo main ruleset, CODEOWNERS, and linking the hand-made PR chains. This record changes nothing in any Exo repository and touches no ruleset or stack.
- Lane 3, the first end-to-end slice, lists Exofab first, then Synbios #50 and #51 with qalam reviewing them first, then Synmerit #9 and #14, then compass #8 and #9. This record is the Exofab item. It proposes wording for Synbios #51 and pushes nothing there before qalam's review.
- Adjacent work by other authors is read, not changed: exofab #17 (design direction), synmerit #6 (contribution credit and local tokens), synmerit #16 (funding design), compass #8 and #9 (names and the unified thesis).

## Implemented, proposed, undecided

**Implemented on a default branch**

- Synbios 0.1: project, task, grant, artifact, test evidence, independent human review, acceptance, task export, and `verify`. Loopback only.
- Synmerit 0.1, the Koinos reference: signed project history, agreement consent and withdrawal, scoped delegation, contribution submit, review, accept, and dispute, with portable bundles and two independent verifiers.
- Compass: founder vision, the Siliconcordat, the naming record, and the 2026-11-03 ecosystem map.
- Exofab: orientation and roadmap only. No product.

**Implemented in an open pull request**

- Exofab #6, proposal P-4: a local prototype of the #5 slice with an independent Koinos implementation, a hub, a browser client, and a Synbios adapter. Interop passed against synbios `c285f07` and koinos `5b5f4f9`. Approved by ahrazzle at `9530c80`. Stacked on #5.
- Synmerit #6: a contribution graph and local token contracts on test assets. Open since 2026-10-29. Its adoption is the economics question in #11.

**Proposed**

- Exofab #5, proposals P-1 to P-3: boundaries and the formation-plus-build slice. Approved by ahrazzle at `3ecb155`; the six review questions were answered in `20d6b00`, the current head.
- Exofab #15: the company direction. Changes requested by ahrazzle at `13a64fd` on three wordings. The fixes are described under "Order of updates" below.
- Exofab #14: the direction itself and its decision list.
- Synbios #50 and #51: the split, the build-start record, and the MVP handoff pack. No review yet.
- Synmerit #16: funding, rights, and bounded agent spending. Design scope only, recorded at the founder's request.
- Compass #9: the unified venture thesis. Compass #8: current repository names.

**Undecided**

- Who decides for Exofab (#7).
- Whether #14 is accepted with the 2026-11-03 boundary (D1 below).
- Decisions D2 to D9 below.

## Where the proposals agree

- People decide and agents prepare. Every record is signed by its own author. Recording a contribution decides no ownership, rights, or pay. Stated in synbios `docs/vision.md`, the synmerit README, #5, and #15.
- Team formation stays in Exofab. Stated in the 2026-11-02 correction on #14 and in P-2 of #5.
- The build sits in Synbios. Stated in #14, #15, and synbios#50.
- The record layer is Koinos 0.1 with keys held by each person's own client. Stated in P-3 of #5 and implemented in #6.

## Where they differ, and the proposed reconciliation

1. **Where the build steps of the #5 slice run.** #5 says the delegated task runs "optionally as a Synbios task". #14 and #15 say the build is never Exofab work. Reconciled: the task always runs in Synbios. Exofab keeps the delegation decision and the Koinos record. One sentence changes in #5.
2. **Who holds the ownership record.** #15 says "Exofab stores the agreed terms". The 2026-11-03 boundary gives ownership and participation to Synmerit. Reconciled as a proposal: Synmerit records the terms digest each owner consented to and the credit that informs the terms. Exofab runs the process and points to the private store that holds the signed instrument. Needs D4.
3. **Ventures as the main job or a later step.** #13 lists ventures under "later, only if decided". #14 and #15 make them the main job. Reconciled: the formation slice in #5 and the venture slice in #15 are two halves of one journey, in the order of the synthetic example. The ventures bullet in #13 becomes a pointer to #15.
4. **Economics.** #11 and the compass draft record only explicit human agreements. Synmerit #6 and #16 explore tokens, funding, and bounded spending. Reconciled for this slice: Koinos 0.1 agreement records only. #6 and #16 stay outside the slice and need their own decisions. The reserved acts hold either way (D2).
5. **Matching.** Narrowed by the 2026-11-02 correction. Exofab owns matching in the slice. Whether Koinos defines portable profile records stays in #11.

## Decisions needed

Each decision needs an owner (#7) and a row in the [roadmap](../roadmap.md) when it is made. The proposals in the last column are this record's suggestions, not defaults that apply without a decision.

| ID | Decision | Options seen in the record | Proposal |
| --- | --- | --- | --- |
| D1 | Accept, change, or reject #14 with the 2026-11-03 boundary | Accept. Change. Reject. | Accept, with the wording in end-to-end-slice.md. |
| D2 | Are the four reserved acts (file, sign, move money, submit a tax filing) human-only even under a grant? | Human-only. Allowed under a per-act, exact-text human approval, as Exo's gate does for tool calls. Allowed under a bounded spend mandate, as synmerit#16 explores for venture funds. | Human-only for the pilot. Any change needs its own recorded decision and legal review. |
| D3 | Where do a real company's private records live? | A private repository the owners control. An encrypted store on the owners' own machines. A private hosted Exofab workspace, which does not exist yet. | Undecided. In every option this repository holds templates and synthetic examples only. |
| D4 | Where does the ownership record live? | Exofab stores the terms, as #15 says today. Synmerit records the consented digest and the credit, while Exofab runs the process and keeps the private instrument, as the 2026-11-03 boundary implies. | The second. |
| D5 | Who writes the Koinos contribution records for Synbios work? | Exofab, with the exact export bytes as the artifact, as #6 does and tests. Synbios directly, which has no signing today. One coarse record per product from the handoff pack. | Exofab for the pilot. |
| D6 | Order of #5 and #15 | #5 first, then #15 rebased. #15 first. One merged proposal. | #5 first. Both are halves of one journey. |
| D7 | Venture form for the pilot | A company in one named place and form. A DAO with a legal wrapper. Both. | Undecided. No document defines the DAO path yet. The place and the company forms are already open in #14. |
| D8 | Shape of the handoff pack | A new Synbios export type. A pack composed from task exports. Who attests the pack, given that Synbios has a hash chain and no signatures. | Composed from task exports, each verifiable on its own. Attestation open. |
| D9 | Reviewers and review order | Per the compass log, qalam reviews synbios #50 and #51 first. ahrazzle reviewed exofab #5, #6, and #15. | Confirm. |

## Order of updates

1. **Exofab #5.** Change one sentence in "How the slice can use Synbios": the delegated task runs in Synbios, not optionally. Ask for the approval to be confirmed on the current head `20d6b00`. Merge when #7 and D1 allow.
2. **Exofab #6.** Retarget to `main` after #5 merges. No content change for this record.
3. **Exofab #15.** The review fixes: the four acts are reserved to people even under a grant; the human owners choose the place and the form on advice from qualified people; company records live in a private store the owners control, outside this repository; the pilot delivers four things and tracks two acts done outside Exofab; the body says proposal, not draft. After D4, narrow the ownership bullet to the process and the private store. Rebase on `main` after #5.
4. **This pull request.** Add the README and roadmap links after #5 and #15 land, so the links do not conflict with either.
5. **Synbios #51**, after qalam's review. Proposed wording is below.
6. **Synbios #50.** Tick the roadmap and vision wording items once D1 is recorded.
7. **Exofab #13.** Point the ventures bullet at #15 once D1 is recorded.
8. **Synmerit #16.** Suggest, in a comment, that the funding design start from the reserved acts (D2) and the ownership record (D4) this slice produces. The issue belongs to its author.
9. **Synmerit #9, #10, #14, and compass #8, #9.** Lane 3 items 3 and 4. Unchanged by this record.

## Proposed wording for Synbios #51

To apply after qalam's review. Nothing is pushed to #51 by this record.

- **Status line.** Add: "On 2026-11-03 the split was stated as: Synbios is the self-contained source control and product-building hub; Exofab handles the venture work around the product; Synmerit covers participation, ownership, and economic coordination."
- **At build start.** Name the record: "A build-start record names the team members, their roles, the charter digest, and who may accept finished work. Until a reference field exists (Moissanite-Labs/exofab#12), the Exofab adapter carries the Koinos project id, agreement id, and terms digest in the task text, which is fixed at creation."
- **Fields proposed, last bullet.** Add: "These are the people who perform the reserved acts: filing, signing, moving money, and submitting tax filings. An agent is never listed here."
- **Rules.** Add: "The pack states facts from Synbios's own hash-chained history. In 0.1 it carries no signature of its own. A recipient verifies each task export in it with `synbios verify`."
- **Open questions.** Add the D8 options: a new export type, or a pack composed from task exports, and who attests the pack.

## Proposed follow-up wording for Exofab #15, after D4

- **Ownership structure bullet.** Replace "Record who owns what share. Record what each person agreed in writing. Exofab stores the agreed terms. It does not set the terms." with "Run the ownership discussion. Draft the terms for the owners. Track who has signed. Keep the signed instrument in the owners' private store. Record in Synmerit the digest of the text each owner consented to. Exofab does not set the terms."
