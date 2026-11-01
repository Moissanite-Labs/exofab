# Roadmap and decision record

This is a proposed sequence for discussion, not an approved delivery schedule or a claim that work is assigned.

| Stage | Outcome | Evidence that it is done | Current state |
| --- | --- | --- | --- |
| 1. Frame the first use case | Intended user, a concrete creation journey, desired outcome, and non-goals are agreed. | A maintainer records a decision on proposal P-1. | Proposed in [First slice](first-slice.md). |
| 2. Define boundaries | The roles of people and agents, the relationship to Exo and sibling projects, data and authority boundaries, and the decisions that need human review are described. | A maintainer records a decision on proposal P-2, and sibling maintainers have had the chance to object. | Proposed in [Ecosystem boundaries](ecosystem.md). |
| 3. Design a first slice | Approaches are compared against the use case, tradeoffs and risks are documented, and a small milestone has observable acceptance criteria. | A maintainer records a decision on proposals P-1 and P-3. | Proposed in [First slice](first-slice.md#acceptance-criteria). |
| 4. Build and evaluate | The first slice is delivered and assessed against its acceptance criteria. | Each acceptance criterion is demonstrated with synthetic data and reviewed. | Not started. A prototype for testing the proposal may be proposed separately; it would not settle the stack. |

## Current record

| Topic | Evidence or status |
| --- | --- |
| Purpose | The founder vision names Exofab as the collaboration hub ([credos FOUNDER-VISION.md:21](https://github.com/Moissanite-Labs/credos/blob/d3a5a619a725f28b1a359c89080d92091db8fb45/FOUNDER-VISION.md#L21)); the organization site describes a planned human-agent collaboration hub and labels it an early proposal. The repository's original README called it the "creation hub of project exo". |
| Choices recorded upstream | The credos record lists as chosen: Exofab as the hub's name, separate repositories for the forge and the hub, and an open-building approach ([FOUNDER-VISION.md:43](https://github.com/Moissanite-Labs/credos/blob/d3a5a619a725f28b1a359c89080d92091db8fb45/FOUNDER-VISION.md#L43)). It is a working proposal, not adopted policy. |
| Product scope and implementation | Open. Proposals P-1 to P-3 below are under review. |
| Architecture, stack, deployment, license, and first milestone | Not established. |
| Decision owner | Not recorded. Choosing initial maintainers is the first proposed ecosystem milestone ([SILICONCORDAT.md:33](https://github.com/Moissanite-Labs/credos/blob/d3a5a619a725f28b1a359c89080d92091db8fb45/SILICONCORDAT.md#L33)). |
| External research | Research references are not adoption decisions. See [prior art notes](research/prior-art.md). |

Record future decisions here or link to a durable decision record. Include the decision, rationale, date, owner, and consequences; distinguish a proposal from an approved decision.

## Proposals under review

These are proposals, not decisions. Nothing here is adopted until a maintainer records a decision in the current record above. IDs are stable so that issues and pull requests can refer to them.

| ID | Proposal | Rationale | Date | Owner | Status | Consequences if adopted |
| --- | --- | --- | --- | --- | --- | --- |
| P-1 | First use case and slice: two people find each other through a brief, agree a charter, delegate one scoped task to an agent, review it, and keep a verifiable record of the accepted work | [First slice](first-slice.md) | 2026-10-31 | Unassigned | Proposed | Exofab's first journey requires at least two people per project; payments, rankings, and hosting stay out of the slice. |
| P-2 | Boundaries: Exofab owns discovery, team formation, agreement, delegation decisions, human review, and export; it references Koinos, Synbios, Exo, and Ethos instead of rebuilding them | [Ecosystem boundaries](ecosystem.md) | 2026-10-31 | Unassigned | Proposed | Exofab defines no parallel contribution records; changes Exofab needs in sibling projects go to their maintainers. |
| P-3 | Record layer and custody: Koinos 0.1 records for projects, with keys held by each person's own client so the hub sequences records but never signs them | [First slice](first-slice.md#alternatives-considered) | 2026-10-31 | Unassigned | Proposed | Exofab must track Koinos versions and keep a trusted head per project; lost keys cannot be recovered by the hub. |
