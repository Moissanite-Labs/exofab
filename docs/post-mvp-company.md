# Proposal: Exofab after the MVP

Status: proposal. Not adopted. Who decides for Exofab is open in #7. The decision request is #14. The split in this document was refined on 2026-11-02: formation can happen in Exofab before a build, and the build itself sits in Synbios. The reconciliation with #5 and with the Synbios handoff, and the decisions it needs, are proposed in #18.

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
| Agent work | Exo | Exo is the agent foundation. Agents from Exo can do prepared tasks in either place, inside the grants people give them. A grant or standing approval does not replace the owner gates on the four company acts below. |

## Work Exofab would cover

- **Forming the company.** The human owners choose where to form it and what form it takes, on advice from qualified people. Exofab lays out the options and what each one means. It does not make the choice. Agents prepare the papers, file them through the chosen jurisdiction's channel, and sign where the owners approve. Exofab tracks each filing and its date.
- **Ownership structure.** Record who owns what share. Record what each person agreed in writing. Exofab stores the agreed terms. It does not set the terms. Agents draft and, with owner approval on each signature, execute the agreements through an e-signature channel.
- **Reaching users.** Plan the first launch. State who the first users are, what the price is, and which channel reaches them first.
- **Revenue.** Track how money comes in. Keep price, invoice, and payment records in the private store named under company records. Agents move money only after explicit owner approval for that payment.
- **Accounting.** Keep the books in order. Track income and costs as they happen, not at the end of the year.
- **Taxes.** List what filings are due and when. Agents keep the records each filing needs and submit returns through a tax e-file channel, under the gate in the table below.
- **Company records.** Keep filings, agreements, and decisions in one place, so an owner can find any paper fast. That place is a private store the owners control, outside this repository and outside any public Exofab service. This repository holds record templates and synthetic examples only. Which store the first slice uses is an open question below.

## Rules

- People decide strategy and choices. Agents prepare drafts, checklists, dates, records, and perform the four company acts below by default.
- **Company acts (agents by default).** An agent performs filing, signing, moving money, and tax submission. Each act uses a concrete channel type. Each act has a gate. Steps stay with a person only where a law or provider requires a natural person.

| Act | Agent route | Gate | What stays with a person and why |
| --- | --- | --- | --- |
| Filing a company paper | State or national **business-entity filing channel**: upload or API submission to the jurisdiction's formation office, often with a **registered-agent service** that accepts service of process and may file on the company's behalf. | Pending owner decision **U1** on [#15](https://github.com/Moissanite-Labs/exofab/pull/15): **(a)** owner approval for each submission (recommended for the first slice), or **(b)** one approval of the prepared filing content, then the agent submits without asking again. | **Choice of entity, jurisdiction, and registered agent** stays with the owners; Exofab does not make those choices. **Written authorization for an agent or attorney-in-fact to sign** a certificate may need to be retained by the company (for example Delaware LLC law allows an agent or attorney-in-fact to sign under 6 Del. C. § 18-204; see [Delaware LLC certificate instructions](https://corpfiles.delaware.gov/LLCFormation.pdf)). Whether a particular state accepts a non-human filer account is **to verify** per jurisdiction. |
| Signing a document | **E-signature provider** integrated as a tool: the agent places fields and sends the envelope; signatures are applied on the approved document text. | Owner **explicit per-action approval** under existing team rules before the agent applies or requests each signature. No grant or standing approval covers signing. | **Review and approval of the exact text** before each signature is a person step because the gate requires it, not because signing itself is reserved to people. Some agreements may require a **named officer or member** to be a signatory under corporate law or contract terms; who must appear on the signature block is **to verify** per document and jurisdiction. |
| Moving money | **Bank or payments API** (ACH, wire, card payout, or treasury API exposed by the company's financial institution or payment processor). | Owner **explicit per-action approval** under existing team rules before each transfer or payment instruction. No grant or standing approval covers moving money. | **Beneficial-owner identification and certification** when opening or changing a legal-entity account: U.S. banks must identify and verify natural-person beneficial owners under FinCEN's CDD rule ([31 CFR 1020.230](https://www.federalreserve.gov/frrs/regulations/section-1010230-beneficial-ownership-requirements-for-legal-entity-customers.htm); [FinCEN CDD FAQs](https://www.fincen.gov/resources/statutes-and-regulations/cdd-rule-faqs)). The **natural person opening the account** certifies beneficial-owner information on the standard certification form. **Identity verification** steps the bank or provider runs on those individuals (government ID, liveness, or in-person) stay with the person the provider requires; which steps apply is **to verify** per institution. |
| Submitting a tax filing | **Tax e-file channel** through an authorized e-file provider or software: the agent transmits the return and supporting records the provider accepts. | Pending owner decision **U1** on [#15](https://github.com/Moissanite-Labs/exofab/pull/15): **(a)** owner approval for each submission (recommended for the first slice), or **(b)** one approval of the prepared return content, then the agent submits without asking again. | **Taxpayer signature or PIN authorization** on U.S. individual e-file: the taxpayer must review the return and sign or authorize a PIN (for example [Form 8879](https://www.irs.gov/forms-pubs/about-form-8879), [IRS signing FAQ](https://www.irs.gov/faqs/irs-procedures/signing-the-return); ERO identity confirmation per [Publication 1345](https://www.irs.gov/pub/irs-pdf/p1345.pdf)). That authorization step stays with the taxpayer or the person the IRS rules name. Business or non-U.S. filings: required signatory and identity steps are **to verify** per form and jurisdiction. |

- Legal and tax advice comes from qualified people. Agents then carry out the work those advisers inform, inside the gates above.
- Real company records are private. This public repository holds designs, templates, and proposals only. It must never hold a real company's papers, accounts, or tax data.

## First slice

Pick one real product that already has an MVP. Run one pilot from end to end:

1. Receive a handoff pack from Synbios. The pack names the product, the people and agents who built it, and the accepted work.
2. Make a company checklist for that product. List each step, its owner, and its date.
3. Draft the ownership terms for the owners to review and change. Agents execute signatures after per-signature owner approval.
4. Write a launch plan for the first users. State the price, the first channel, and the first sales steps.
5. Set up a money and tax calendar for the first 90 days. List income, costs, filing dates, and the records each filing needs.

The pilot delivers four things inside Exofab: the company checklist, the ownership terms (signed through the approved channel), the launch plan, and the calendar. Formation filing, signing, money movement, and tax submission are performed by named agents under the gates above, not reserved to people by default. The pilot is done when the owners can point to the four deliverables, the checklist shows each act complete, and the checklist records **which agent performed each act** and **which owner approval covered it**, with the papers in the owners' private store.

## Open questions

- Which country and state should the first slice support? Incorporation and tax rules differ by place.
- Which company forms should the first slice support?
- What fields does the Synbios handoff pack need? Ownership work needs a clear record of who built what.
- Which parts of a team charter stay in Exofab, and which parts become build tasks in Synbios?
- What data model holds company records, and which private store should the first slice use? Options seen so far: a private repository the owners control, an encrypted store on the owners' own machines, or a private hosted Exofab workspace, which does not exist yet. In every option this repository holds templates only.
- **U1 (owner decision on [#15](https://github.com/Moissanite-Labs/exofab/pull/15)):** For filing a company paper and submitting a tax filing, choose **(a)** owner approval for each submission, or **(b)** one approval of prepared content, then agent submission without a second ask. Moving money and signing already require explicit per-action owner approval. Reply on the PR with **U1: a** or **U1: b**.
- Who decides each of these? See #7.

## Relation to current proposals

This proposal changes the direction in #5, #8, #11, and #13.

- #5 and #8 put finding people and forming a team inside Exofab, before a build. This proposal keeps that work in Exofab. It moves the build steps of that slice to Synbios: delegating a build task, doing the work, and reviewing it.
- #11 records a credos draft that does not promise incorporation or equity allocation. This proposal makes both core Exofab work, with human choices and agent execution under the gates above.
- #13 lists ventures as a later step, only if decided. This proposal makes ventures the main job.
