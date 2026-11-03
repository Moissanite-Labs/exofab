# Orientation

## What is Exofab?

Exofab is the proposed collaboration hub of the Moissanite Labs ecosystem. The [founder vision](https://github.com/Moissanite-Labs/credos/blob/d3a5a619a725f28b1a359c89080d92091db8fb45/FOUNDER-VISION.md#L21) records it as the chosen name and repository for that hub, with "fab" evoking a production factory for agent-built products and companies. The repository's original README called it the "creation hub of project exo". The [organization site](https://moissanite-labs.github.io/.github/) labels it an early proposal. None of these sources establishes a product architecture or implemented capabilities.

## What the project record already says

The founder vision and the proposed ecosystem architecture live in the [credos repository](https://github.com/Moissanite-Labs/credos), which the organization site calls the constitution repository. Both documents are working proposals, not adopted policy. Read on 2026-10-31 at commit [`d3a5a61`](https://github.com/Moissanite-Labs/credos/tree/d3a5a619a725f28b1a359c89080d92091db8fb45), they say:

- **Ambition.** The founder described Exofab as "hitrecord meets tinder meets linkedin": a communal building hub where app builders find business partners and people with ideas and markets find builders. People should be able to collaborate directly and send agents to help or automate work, in an experience that is human-first or hybrid. Robotics is a longer-term aspiration. The record calls these "ambitions, not claims that those workflows already exist" ([FOUNDER-VISION.md:21](https://github.com/Moissanite-Labs/credos/blob/d3a5a619a725f28b1a359c89080d92091db8fb45/FOUNDER-VISION.md#L21)).
- **Chosen.** Exofab as the hub's name, separate repositories for the agent-first forge and the human-first or hybrid hub, and an open-building approach ([FOUNDER-VISION.md:43](https://github.com/Moissanite-Labs/credos/blob/d3a5a619a725f28b1a359c89080d92091db8fb45/FOUNDER-VISION.md#L43)).
- **Open.** Interfaces, identity, delegation, provenance, and governance; how contributions, credit, and possible economic rights are documented; and the timing of robotics ([FOUNDER-VISION.md:47](https://github.com/Moissanite-Labs/credos/blob/d3a5a619a725f28b1a359c89080d92091db8fb45/FOUNDER-VISION.md#L47)).
- **How the pieces fit.** Components cooperate through versioned contracts and adapters, without a shared database, central service, blockchain, or microservices as a prerequisite for the first release ([SILICONCORDAT.md:25](https://github.com/Moissanite-Labs/credos/blob/d3a5a619a725f28b1a359c89080d92091db8fb45/SILICONCORDAT.md#L25)).
- **Economics.** Economic arrangements need explicit agreements among the people involved. The draft does not promise autonomous incorporation, equity allocation, payments, legal enforcement, or smart-contract execution ([SILICONCORDAT.md:27](https://github.com/Moissanite-Labs/credos/blob/d3a5a619a725f28b1a359c89080d92091db8fb45/SILICONCORDAT.md#L27)).
- **A first slice.** "Create a project in Exofab; delegate a scoped task to an agent; produce a forge artifact with tests and human review; record an accepted contribution and its evidence in Exofab; export a portable representation" ([SILICONCORDAT.md:35](https://github.com/Moissanite-Labs/credos/blob/d3a5a619a725f28b1a359c89080d92091db8fb45/SILICONCORDAT.md#L35)).

Two sibling repositories already contain reference implementations that this slice would use: [Koinos](https://github.com/Moissanite-Labs/koinos), the collaboration protocol, and [Synbios](https://github.com/Moissanite-Labs/synbios), the agent-first forge. Both describe Exofab as the prospective human-first hub. See [ecosystem boundaries](ecosystem.md).

## Starting here

1. Read the [roadmap and decision record](roadmap.md) and the proposals under review.
2. Read the [ecosystem boundaries](ecosystem.md) before proposing anything that touches a sibling repository.
3. Look at the current issues and pull requests before starting work; avoid duplicating active work.
4. Propose a small, reviewable change with its evidence, assumptions, and open questions. See [Contributing](../CONTRIBUTING.md).

## Questions to resolve

Each question below notes what is now proposed. A proposal is not an answer until a maintainer records a decision.

| Question | Current state |
| --- | --- |
| Who is the first intended user, and what creation journey should the first version support? | Proposed in [First slice](first-slice.md): small teams pairing an idea or audience holder with a builder, piloted with people already in the Exo ecosystem. |
| What belongs in Exofab versus Exo and other projects? What integration boundaries are needed? | Proposed in [Ecosystem boundaries](ecosystem.md). Whether matching belongs in Exofab or in a future Koinos version is open. |
| How should people and agents share context, make decisions, and hand work off? Which actions require human approval? | Proposed in [First slice](first-slice.md#what-each-participant-can-see-and-do): every record is signed by its own author; agents can only submit work under a scoped, expiring delegation. |
| What data, identity, access, privacy, and deployment requirements apply? | Partly proposed: records private to participants, keys held by each person's client. Identity, recovery, and deployment are open. |
| What is the smallest useful first milestone, and how will its outcome be evaluated? | Proposed acceptance criteria are in [First slice](first-slice.md#acceptance-criteria). |
| Which technology stack, operating model, and license should the project use? | Open. Who decides for Exofab is not yet recorded. |

External research can inform comparison; it does not authorize adopting code, services, or an architecture. See [prior art notes](research/prior-art.md).
