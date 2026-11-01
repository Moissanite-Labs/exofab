# First slice proposal

> **Proposal for review.** This document proposes Exofab's first use case and first slice (roadmap steps 1 and 3). It is listed as proposals P-1 and P-3 in the [decision record](roadmap.md#proposals-under-review), and nothing here is adopted until a maintainer records a decision there. Evidence links are pinned to the commits that were read on 2026-10-31.

## Summary

The proposed first slice is one complete, small creation journey: **two people who have not worked together find each other through a project brief, agree terms, delegate one scoped task to an agent, review the result, and leave with a portable, independently verifiable record of the accepted work.**

The proposal combines three sources:

- The founder's stated ambition for Exofab: a communal building hub where "app builders find business partners and people with ideas and markets find builders", where humans "collaborate directly and send agents to help or automate work", and where the experience is "human-first or hybrid" ([credos FOUNDER-VISION.md:21](https://github.com/Moissanite-Labs/credos/blob/d3a5a619a725f28b1a359c89080d92091db8fb45/FOUNDER-VISION.md#L21)). That record calls these ambitions, not existing workflows.
- The proposed ecosystem milestone 3: "Create a project in Exofab; delegate a scoped task to an agent; produce a forge artifact with tests and human review; record an accepted contribution and its evidence in Exofab; export a portable representation. Record any economic allocations in explicit human agreements rather than automating them" ([credos SILICONCORDAT.md:35](https://github.com/Moissanite-Labs/credos/blob/d3a5a619a725f28b1a359c89080d92091db8fb45/SILICONCORDAT.md#L35)).
- What the sibling reference implementations already provide. [Koinos](https://github.com/Moissanite-Labs/koinos) 0.1 implements signed project, agreement, delegation, and contribution records. [Synbios](https://github.com/Moissanite-Labs/synbios) 0.1 implements a local task, artifact, evidence, and review loop. Both describe Exofab as the prospective human-first collaboration hub ([koinos docs/vision.md:22](https://github.com/Moissanite-Labs/koinos/blob/5b5f4f9eaffe45a718601744366b8ac507ffc4b6/docs/vision.md#L22), [:28](https://github.com/Moissanite-Labs/koinos/blob/5b5f4f9eaffe45a718601744366b8ac507ffc4b6/docs/vision.md#L28); [synbios docs/vision.md:30](https://github.com/Moissanite-Labs/synbios/blob/03466957a582d57b786087fb5b3fc668aab1711c/docs/vision.md#L30), [:36](https://github.com/Moissanite-Labs/synbios/blob/03466957a582d57b786087fb5b3fc668aab1711c/docs/vision.md#L36)), and both name an Exofab workflow or Exofab discovery as a next link ([koinos docs/vision.md:40](https://github.com/Moissanite-Labs/koinos/blob/5b5f4f9eaffe45a718601744366b8ac507ffc4b6/docs/vision.md#L40); [synbios docs/roadmap.md:13](https://github.com/Moissanite-Labs/synbios/blob/03466957a582d57b786087fb5b3fc668aab1711c/docs/roadmap.md#L13)).

Exofab's own part of the journey is the human part: discovery, consent to work together, the terms people agree to, the decision to send an agent, review and acceptance by people, and a record people can take with them. It references Koinos for record semantics and Synbios for forge work instead of re-creating them. See [ecosystem boundaries](ecosystem.md).

## Intended first users

**Proposed:** small teams of two to five people forming around a software project, where at least one person brings an idea, need, or audience and at least one person builds. Either may bring an agent.

**Proposed pilot population:** people already working in the Exo ecosystem, building small things such as Exo skills or plugins. The published Exo roadmap says the first marketplace should start "where Exo already has the people" and that there should be "no general hub before the first small marketplace works" ([exo-site roadmap:270, :492](https://github.com/Moissanite-Labs/exo-site/blob/9147eb147801fac3aaa2594ccaa45c6d77a768a5/roadmap/index.html#L270)). A pilot with that group avoids starting with an empty network.

**Assumption:** the first teams have at least two humans. Koinos requires this for any accepted contribution. The reviewer must be a human party to the agreement who is neither the submitter nor the delegating principal ([koinos docs/protocol.md:21](https://github.com/Moissanite-Labs/koinos/blob/5b5f4f9eaffe45a718601744366b8ac507ffc4b6/docs/protocol.md#L21)). A solo builder delegating to their own agent cannot reach acceptance. In this slice, finding a partner is therefore a precondition of the record, not an optional extra.

## Worked example

All names are fictional. The example follows the sequence Koinos recommends for a first vertical slice ([koinos docs/vision.md:36-42](https://github.com/Moissanite-Labs/koinos/blob/5b5f4f9eaffe45a718601744366b8ac507ffc4b6/docs/vision.md#L36-L42)).

1. **Ada** runs a community of home bakers and wants a recipe-scaling skill for Exo. She publishes a **brief** with one open **role**: "Skill builder", skills `exo-skills` and `testing`, a few evenings of commitment.
2. **Ben** builds Exo skills. His explicit **profile** lists those skills, so the hub suggests Ada's brief to him and shows why: the declared skills overlap. The suggestion is visible only to Ben.
3. Ben **expresses interest** in the role with a short note. Only Ada and Ben can see it.
4. Ada **accepts** the interest. This is the double opt-in: neither person is placed on a team by the other alone. Ada and Ben are now a **team**.
5. Ben **nominates** his agent, **scribe**, which he registered under his own account. Scribe has its own signing key and Ben as its responsible principal.
6. Ada **starts the record**. Her browser signs a Koinos `project.created` record that lists Ada, Ben, and scribe. Ada becomes the steward.
7. Ada drafts the **charter**: scope, acceptance criteria, how credit is recorded, and a statement that the record creates no economic right. The exact text is stored by its SHA-256 digest. Ada proposes it as a Koinos agreement whose parties are Ada and Ben.
8. Ada and Ben each read the exact charter text, see its digest, and **consent** with their own keys.
9. Ben **delegates** to scribe: `contribution.submit` under that agreement, expiring in 14 days.
10. Scribe does the work, optionally as a Synbios task with test evidence and a forge review. It **submits** a contribution that references the artifact bytes by digest.
11. Ada **reviews** the artifact and its evidence. She is a party, and she is neither the submitter (scribe) nor the principal (Ben), so Koinos lets her approve.
12. Ada, as steward, **accepts** the contribution, citing her approving review.
13. Either person **exports** the Koinos bundle with the charter and artifact bytes. Anyone can then check every signature, the authority rules, and both digests without Exofab.
14. The accepted contribution appears as **credit** for Ben and scribe, visible to the team. Credit is a record of accepted work, not money ([exo-site roadmap:481](https://github.com/Moissanite-Labs/exo-site/blob/9147eb147801fac3aaa2594ccaa45c6d77a768a5/roadmap/index.html#L481)).

## Non-goals for the first slice

- Payments, escrow, equity, revenue shares, tokens, smart contracts, or forming legal entities. The charter can reference a separate human agreement; Exofab does not create or enforce one. This follows [credos SILICONCORDAT.md:27](https://github.com/Moissanite-Labs/credos/blob/d3a5a619a725f28b1a359c89080d92091db8fb45/SILICONCORDAT.md#L27) and the prior-art cautions in [research notes](research/prior-art.md).
- Scores, rankings, reputation numbers, or automated valuation of contributions.
- Matching on inferred preferences or on anyone's Ethos records. Matching uses only what people declare in Exofab. Ethos import is a later, opt-in step.
- Public contribution ledgers. Records are private to their participants by default.
- A hosted multi-user service, federation, or remote agents. The slice can be validated on one machine.
- A general marketplace, robotics, or physical fabrication.

## What each participant can see and do

| Action | Who may act | What they see first | Where it is recorded |
| --- | --- | --- | --- |
| Publish or close a brief | Any registered person | The brief | Exofab hub log |
| Express interest in a role | A person other than the brief owner | The brief and role | Hub log; visible to owner and candidate |
| Accept or decline interest | The brief owner | Candidate profile and note | Hub log; acceptance adds a team member |
| Nominate an agent | The agent's registered principal, on the team | The agent's identity | Hub log |
| Start the record | The brief owner, who becomes steward | The exact participant list | Koinos `project.created` |
| Propose the charter | The steward | The exact terms text and digest | Koinos `agreement.proposed` |
| Consent or withdraw consent | Each named party | The exact terms text and digest | Koinos `agreement.consented` or `agreement.withdrawn` |
| Delegate a scoped task | A consenting party, to their own agent | Agent, agreement, expiry | Koinos `delegation.granted` |
| Revoke a delegation | The grantor | The delegation | Koinos `delegation.revoked` |
| Submit a contribution | The delegated agent, or a human party | Artifact digest and summary | Koinos `contribution.submitted` |
| Review | A human party who is not the submitter or principal | Artifact bytes and evidence | Koinos `contribution.reviewed` |
| Accept | The steward | The latest approving review | Koinos `contribution.accepted` |
| Dispute an acceptance | Any human party | The accepted contribution | Koinos `contribution.disputed` |
| Export | Any participant | The complete history | Bundle file plus referenced bytes |

The Koinos rows restate Koinos 0.1 rules. Exofab adds the following **proposed hub policies** on top. Each one narrows what Koinos allows; none widens it.

1. **People sign; the hub sequences.** Each record is signed in its author's own client after they see the exact record. The hub verifies and orders records, and stores no private keys. A record is accepted only from the authenticated person or agent whose key signed it.
2. **Delegate only to your own agent.** Koinos lets any human party grant any listed agent. Exofab proposes that a person can delegate only to an agent registered under their own account, so the delegating principal is also the accountable owner.
3. **Bytes are held, not just referenced.** Terms and artifacts must be stored in the hub before a record cites them, using content-addressed [RFC 6920](https://www.rfc-editor.org/rfc/rfc6920) `ni:///sha-256;…` URIs. Reviewers then always review the exact bytes, and URIs carry no local paths.
4. **Agents cannot act socially.** Agent credentials cannot publish briefs, express interest, accept matches, consent, review, or accept. They can only submit contributions under an active delegation.
5. **Private by default.** A project's records and bytes are visible only to its participants. Profiles and briefs are visible in the hub only when their owners list them.
6. **Plausible times.** A record's time must be close to the hub's clock, in addition to Koinos's nondecreasing-time rule.

## How the slice uses Koinos

The happy path is eight records, the same shape as the Koinos example bundle. Field names are Koinos 0.1 ([koinos docs/implementation-contract.md](https://github.com/Moissanite-Labs/koinos/blob/5b5f4f9eaffe45a718601744366b8ac507ffc4b6/docs/implementation-contract.md)).

| Seq | Kind | Signer | Exofab source |
| --- | --- | --- | --- |
| 0 | `project.created` | Ada (steward) | Brief title and summary; team members and nominated agents |
| 1 | `agreement.proposed` | Ada | Charter bytes, their `ni:` URI and SHA-256; parties Ada and Ben |
| 2 | `agreement.consented` | Ada | |
| 3 | `agreement.consented` | Ben | |
| 4 | `delegation.granted` | Ben | Agent scribe; scope `contribution.submit`; expiry |
| 5 | `contribution.submitted` | scribe | Artifact bytes, their `ni:` URI and SHA-256 |
| 6 | `contribution.reviewed` | Ada | Decision and note |
| 7 | `contribution.accepted` | Ada | Latest approving review |

Consequences of Koinos 0.1 that the slice must handle explicitly:

- **The participant list is fixed at genesis.** Exofab must form the team, including nominated agents, before the record starts. Adding a person later needs a new record. A `participant.added` event would be an upstream Koinos change.
- **The delegation must outlive acceptance.** An expired or revoked grant makes that contribution permanently unacceptable, so the interface should warn when a review is still pending near expiry.
- **There is no evidence field.** Test evidence lives inside the digested artifact bytes, for example a Synbios task export, or in the summary.
- **A shorter history still verifies.** Exofab must keep a trusted `{project, head}` pin outside the bundle to detect rollback.

## How the slice can use Synbios

Synbios is optional for validating the slice and recommended for the milestone 3 version. In that version, the delegated task runs as a Synbios task and the Koinos artifact is the exact bytes of the Synbios task export, which carries the artifact revision, test evidence, and the forge review ([synbios README.md](https://github.com/Moissanite-Labs/synbios/blob/03466957a582d57b786087fb5b3fc668aab1711c/README.md)).

The proposed order is forge review first, then the Koinos submission, review, and acceptance. The Koinos digest then covers the tests and the forge review. The cost is that a person reviews twice, once in each system, unless a later adapter combines the two steps.

Synbios 0.1 is loopback-only, cannot store external references except in task text, and leaves grants out of its export. Those limits are listed in [ecosystem boundaries](ecosystem.md#gaps-found-in-sibling-repositories) as candidate upstream issues, not Exofab work.

## Acceptance criteria

The slice is ready for review when each of these can be shown, using synthetic data only:

1. Two people go from a published brief to a team using only their own actions: interest by one, acceptance by the other.
2. Every Koinos record is signed by its author's own key. The hub's data contains no private keys.
3. Before consenting, a party sees the exact charter text, and the digest shown equals the SHA-256 of the stored bytes.
4. An agent submits only under an active, scoped, expiring delegation from its own principal. Revocation or expiry before acceptance prevents acceptance.
5. A review by the submitter or the principal is refused.
6. The exported bundle verifies unchanged with Exofab's verifier and with the Koinos reference verifier. Re-importing it yields the same head, participants, and attribution.
7. A reader can trace an accepted contribution to its artifact bytes and to the agreed charter text, which is the Koinos definition of done for its own slice ([koinos docs/vision.md:42](https://github.com/Moissanite-Labs/koinos/blob/5b5f4f9eaffe45a718601744366b8ac507ffc4b6/docs/vision.md#L42)).
8. Each refusal rule has a test, as well as the successful journey.

## Alternatives considered

**First use case**

| Option | Strength | Weakness | Proposal |
| --- | --- | --- | --- |
| Builder and idea-holder pair | Matches the founder framing; exercises matching, consent, delegation, and review; satisfies Koinos's two-human rule | Needs at least two committed people per project | **Recommended** |
| "Exo builds Exo": agents propose fixes to Exo, maintainers accept ([exo-site roadmap:123](https://github.com/Moissanite-Labs/exo-site/blob/9147eb147801fac3aaa2594ccaa45c6d77a768a5/roadmap/index.html#L123)) | Real users and real work exist today | A maintainer-review loop is mostly forge and code-host work; it barely exercises discovery or agreement | Use as the pilot population, not the journey |
| A small marketplace for skills, agents, and pets ([exo-site roadmap:492](https://github.com/Moissanite-Labs/exo-site/blob/9147eb147801fac3aaa2594ccaa45c6d77a768a5/roadmap/index.html#L492)) | Concrete demand signal | Listings quickly imply pricing and payment, which are out of scope | Revisit after the slice |

**Record layer**

| Option | Proposal |
| --- | --- |
| Koinos 0.1 records and bundles | **Recommended.** They already implement the needed records; Exofab would be an adapter and a second independent implementation, which the Koinos roadmap asks for. |
| Exofab-native contribution records | Rejected: duplicates Koinos and fragments provenance. |
| Wait for the unmerged Koinos 0.2 proposal | Rejected for now: it is unmerged and adds tokens and payouts that conflict with the credos stance. Revisit if Koinos adopts it. |
| Exo ledger events | Rejected for shared records: the Exo ledger belongs to one principal. |

**Key custody**

| Option | Proposal |
| --- | --- |
| Keys held by each person's client (browser WebCrypto, CLI key file) | **Recommended.** A signature then means the person signed. |
| Keys held by the hub | Rejected: a signature would only prove the hub signed. |
| Reuse Exo seat keys | Later; it needs an Exo decision about key reuse across protocols. |

**Matching**

| Option | Proposal |
| --- | --- |
| Declared skills and roles, with a visible reason for every suggestion | **Recommended.** It is explainable and uses only what people chose to list. |
| Learned or inferred matching | Rejected for the slice: it raises Ethos publication and consent questions, and earlier credit systems that scored activity were gamed ([prior art notes](research/prior-art.md#collaborative-production-and-credit)). |

## Risks and open questions

- **Decision owner.** No Exofab maintainer or decision owner is recorded. Choosing initial maintainers is credos milestone 1.
- **Economic direction.** The founder's raw notes in the Koinos repository explore trust-minimized payouts and smart contracts. The credos draft does not promise them. This slice records references to human agreements only. A different direction would change the charter template and every later stage.
- **Identity.** A key proves control, not personhood. The slice uses local accounts with proof of key possession. Real identity, recovery, and rotation are open across the ecosystem.
- **Unlisted participants.** Koinos bundles are fully visible to anyone who receives them. Names, notes, and summaries must be written for that audience.
- **Two reviews.** With Synbios, a person reviews in the forge and again in Exofab. A combined flow needs an adapter decision.
- **Public credit.** Whether and how a person can show accepted work outside the team needs the consent of the other participants. The slice keeps credit visible to the team only.
- **Spec work.** HitRecord drew a backlash when unpaid contribution was framed as opportunity ([prior art notes](research/prior-art.md#collaborative-production-and-credit)). Briefs should say plainly whether any compensation is offered.

## Validation plan

A local prototype for testing this design against the acceptance criteria above is proposed in a separate pull request. Its runtime and structure are a proposal of their own and would not settle the project's technology stack.
