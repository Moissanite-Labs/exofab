# Ecosystem boundaries

> **Proposal for review.** This document proposes what Exofab owns and what it references in the Moissanite Labs ecosystem (roadmap step 2). It describes sibling repositories as they were read on 2026-10-31 and 2026-11-01, at the commits linked below. It is not a decision, and it does not speak for the maintainers of those repositories.

## Where Exofab sits

The founder record describes Exofab as a human-first or hybrid collaboration hub: people and agents find one another, develop projects, and bring products and, when participants choose, companies into the world ([credos SILICONCORDAT.md:14](https://github.com/Moissanite-Labs/credos/blob/d3a5a619a725f28b1a359c89080d92091db8fb45/SILICONCORDAT.md#L14)). The same record proposes that the components "interoperate while being useful as distinct components" and do not need "a shared database, a central service, a blockchain, or a collection of microservices as a prerequisite for the first release" ([credos FOUNDER-VISION.md:17](https://github.com/Moissanite-Labs/credos/blob/d3a5a619a725f28b1a359c89080d92091db8fb45/FOUNDER-VISION.md#L17); [SILICONCORDAT.md:25](https://github.com/Moissanite-Labs/credos/blob/d3a5a619a725f28b1a359c89080d92091db8fb45/SILICONCORDAT.md#L25)).

| Repository | Role | What exists | Relationship to Exofab |
| --- | --- | --- | --- |
| [credos](https://github.com/Moissanite-Labs/credos) | Founder vision, the Siliconcordat manifesto, and the proposed ecosystem architecture. The org site calls it the constitution repository. | Working proposals; no code. | The source of Exofab's direction. Exofab cites it and does not restate it as Exofab decisions. |
| [Exo](https://github.com/Moissanite-Labs/exo) | Agent harness: memory, a gate with exact-text approvals, peers, signed ledger. | "Early and in active build"; in daily use on one agent ([README](https://github.com/Moissanite-Labs/exo/blob/d995d667236479119004a33c65e1491e4b961d21/README.md)). | The agent a person may send to help. Exofab does not build an agent runtime or approve actions on an agent's own machine. |
| [Synbios](https://github.com/Moissanite-Labs/synbios) | Agent-first development forge. | Local reference implementation 0.1: task, grant, artifact, test evidence, independent human review, task export ([README](https://github.com/Moissanite-Labs/synbios/blob/c285f07a5d452ed6cabc2b4ee690f4f2e6cfb1e2/README.md)). | Where delegated software work can happen. Exofab references Synbios exports as contribution artifacts. |
| [Koinos](https://github.com/Moissanite-Labs/koinos) | Collaboration protocol. | Experimental reference implementation 0.1: signed, hash-linked project, agreement, delegation, and contribution records ([README](https://github.com/Moissanite-Labs/koinos/blob/5b5f4f9eaffe45a718601744366b8ac507ffc4b6/README.md)). | The proposed record layer for Exofab projects. Exofab would be an adapter and an independent implementation. |
| [Ethos](https://github.com/Moissanite-Labs/ethos) | Portable preference protocol. | Draft v0.1 schema, fixtures, and checks. | Later and opt-in. A preference is context, never permission. |
| [.github](https://github.com/Moissanite-Labs/.github) | Organization site and profile. | Static site; labels Exofab "Early proposal". | Exofab's public maturity label lives there. |
| [exo-site](https://github.com/Moissanite-Labs/exo-site) | Published Exo website and roadmap. | Its roadmap lists a collaboration hub, credit for accepted work, and a fair resolver as "Exploring". | Useful design input; ownership of those items is not settled. |

The names Synbios and Koinos are used by their repositories. The credos record on `main` still lists the forge and protocol names as open; an unmerged credos branch, `docs/ecosystem-names`, would record both as chosen. Until that lands, these documents refer to the repositories by their names without treating the naming as ratified.

## What Exofab proposes to own

- **Discovery and matching.** Briefs, explicit profiles, explained suggestions, and double opt-in introductions. Credos assigns "find one another" to the hub ([SILICONCORDAT.md:14](https://github.com/Moissanite-Labs/credos/blob/d3a5a619a725f28b1a359c89080d92091db8fb45/SILICONCORDAT.md#L14)), and Synbios says "Exofab remains the hub for people and agents to find collaborators" ([synbios docs/vision.md:38](https://github.com/Moissanite-Labs/synbios/blob/03466957a582d57b786087fb5b3fc668aab1711c/docs/vision.md#L38)).
- **Team formation.** Turning matches into a team whose people and agents can be listed in a project record.
- **The human experience of agreement.** Showing people the exact terms, collecting each person's own consent, and making withdrawal visible.
- **The decision to send an agent.** Letting a person grant their own agent a scoped, expiring delegation, and revoke it.
- **Human review and acceptance.** Presenting the exact artifact bytes and evidence to an independent reviewer, then recording the decision.
- **A record people can take with them.** Export of the complete history and the bytes it references.
- **Credit as a record of accepted work.** Shown to the team; not money, scores, or rankings.

## What Exofab proposes to reference instead of building

| Concern | Owner | How Exofab uses it |
| --- | --- | --- |
| Record format, signatures, and authority rules | Koinos | Builds and verifies Koinos 0.1 records; defines no parallel contribution, consent, delegation, or acceptance records. |
| Task execution, artifact capture, test evidence, forge review | Synbios | Uses the exact bytes of a Synbios task export as a contribution artifact. |
| Agent runtime, per-tool approvals, seat keys | Exo | Treats an Exo agent as a participant with its own key and a responsible person. |
| Preferences and taste | Ethos | Not used in the first slice. A later import would be opt-in and selective. |
| Principles and operating practices | credos | Cited, not restated. |

## Constraints the siblings impose

These follow from reading the sibling code and docs. They shape the [first slice proposal](first-slice.md).

- **Two humans before any acceptance.** In Koinos 0.1 the reviewer must be a human party who is neither the submitter nor the principal ([koinos docs/protocol.md:21](https://github.com/Moissanite-Labs/koinos/blob/5b5f4f9eaffe45a718601744366b8ac507ffc4b6/docs/protocol.md#L21)). A solo builder working with their own agent cannot reach acceptance.
- **A fixed participant list.** "Genesis lists immutable participants" ([koinos docs/protocol.md:17](https://github.com/Moissanite-Labs/koinos/blob/5b5f4f9eaffe45a718601744366b8ac507ffc4b6/docs/protocol.md#L17)). The hub has to form the team, including agents, before a record starts.
- **Delegations must outlive acceptance.** An agent's grant must still be active when the steward accepts, so an expired or revoked grant makes that contribution unacceptable.
- **No evidence field.** Koinos contributions reference one artifact by URI and digest. Test evidence travels inside the artifact bytes.
- **Rollback detection needs a stored head.** A complete shorter history still verifies, so a trusted `{project, head}` pin must be kept outside the bundle ([koinos docs/protocol.md:23](https://github.com/Moissanite-Labs/koinos/blob/5b5f4f9eaffe45a718601744366b8ac507ffc4b6/docs/protocol.md#L23)).
- **Synbios is local only.** Its server refuses non-loopback binding ([synbios/server.py:15-21](https://github.com/Moissanite-Labs/synbios/blob/c285f07a5d452ed6cabc2b4ee690f4f2e6cfb1e2/synbios/server.py#L15-L21)), so Exofab, the agent, and Synbios share a machine in the first slice.
- **Digest the stored bytes.** A Synbios export includes its own export time ([synbios/store.py:462](https://github.com/Moissanite-Labs/synbios/blob/c285f07a5d452ed6cabc2b4ee690f4f2e6cfb1e2/synbios/store.py#L462)), so two exports of the same task differ. A Koinos record must commit to the exact bytes that were stored and reviewed.
- **No external reference field in Synbios.** Task text is fixed at creation, so a link back to a Koinos agreement has to be written into the task description when the task is created.

## Interface sketches

These are proposals for discussion. The [first slice](first-slice.md#how-the-slice-uses-koinos) lists the Koinos records in detail.

- **Koinos.** Exofab sequences each project's records and verifies every append. People and agents sign their own records. Terms and artifacts are stored by content and cited with [RFC 6920](https://www.rfc-editor.org/rfc/rfc6920) `ni:///sha-256;…` URIs, which carry no local paths.
- **Synbios.** The hub can turn an agreed charter into a Synbios `task.create` body that embeds the Koinos project id, agreement id, and terms digest. After the forge review, the exact export bytes become the Koinos artifact.
- **Exo.** The least invasive path is an Exofab skill or MCP server attached to an Exo seat, with no Exo code change. Exo's own guidance implies that anything Exofab sends an agent is input, never consent, and that outward actions should use tool verbs Exo's gate classifies for exact-text approval. This is a later step and needs Exo maintainers' agreement.
- **Ethos.** Not in the first slice. Ethos v0.1 treats any disclosure of a person's preferences to others as publication that needs an explicit grant ([ethos v0.1/SPEC.md](https://github.com/Moissanite-Labs/ethos/blob/f9ecc2e680e733aa04dc5326afe9480ae472785c/v0.1/SPEC.md)). Matching that uses other people's preferences would therefore need publication grants first.

## Gaps found in sibling repositories

Candidate upstream items found while preparing this proposal. Each is for the owning repository's maintainers to judge.

**Koinos**
- `docs/implementation-contract.md:19` describes delegation as "consenting human party to consenting agent participant", then says "Agent itself does not consent." The code never lets an agent consent.
- No way to add a participant or transfer stewardship after genesis.
- No language-neutral test vectors or error codes. A second implementation can compare only accept or reject outcomes.

**Synbios**
- `synbios capture` records the artifact URI as an absolute local `file://` path plus revision ([synbios/cli.py:93](https://github.com/Moissanite-Labs/synbios/blob/c285f07a5d452ed6cabc2b4ee690f4f2e6cfb1e2/synbios/cli.py#L93)). Exported and shared, this reveals a local directory layout.
- Grant events are stored without a task id ([synbios/store.py:230](https://github.com/Moissanite-Labs/synbios/blob/c285f07a5d452ed6cabc2b4ee690f4f2e6cfb1e2/synbios/store.py#L230)), so task exports omit the grant that authorized the work.
- Exports are not reproducible because the export time is inside the digested bundle.
- No external reference field for linking a task to records elsewhere.

**Organization site and records**
- The org site and profile link the `constitution` repository; the repository is now `credos`. GitHub redirects the links, but the names differ.
- The org profile's "founder vision and manifesto proposals" link points to a merged pull request rather than the current files.
- credos `main` still lists the forge and protocol names as open while the repositories already exist under chosen names.

## Open boundary questions

- **Matching in Koinos or Exofab.** An unmerged Koinos proposal for version 0.2 adds published profiles, opportunities, and matching to the protocol, along with tokens and settlement records. If adopted, it would move part of Exofab's proposed role into Koinos and conflict with the credos statement that the ecosystem does not promise payments or smart-contract execution ([SILICONCORDAT.md:27](https://github.com/Moissanite-Labs/credos/blob/d3a5a619a725f28b1a359c89080d92091db8fb45/SILICONCORDAT.md#L27)). This needs a decision between the two projects' maintainers.
- **Hub, credit, and resolver.** The Exo roadmap lists these as Exo ecosystem items without naming Exofab. Who owns them is not recorded.
- **Economic direction.** Founder notes preserved in Koinos explore smart contracts, payment tools, and model-decided payouts as ideas to evaluate. Credos records only explicit human agreements. Exofab's first slice follows credos; any change needs a recorded decision and legal review.
- **Identity.** A key proves control, not personhood. Cross-ecosystem identity, recovery, and rotation are open everywhere.
- **Public or private by default.** The Exo roadmap imagines a public credit ledger; credos and Ethos lean private by default. The first slice keeps records private to participants.
