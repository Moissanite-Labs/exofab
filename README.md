# Exofab

Exofab is a proposed human-first or hybrid collaboration hub where people and agents find one another, develop projects, and bring products and, when participants choose, companies into the world.

**Status: early proposal.** This repository holds orientation and proposals. Its scope, implementation, technology stack, and license are not yet decided, and nothing described here is a running service.

## Where the direction comes from

- The [Moissanite Labs founder vision](https://github.com/Moissanite-Labs/credos/blob/d3a5a619a725f28b1a359c89080d92091db8fb45/FOUNDER-VISION.md) names Exofab as the collaboration hub and records the founder's ambition for it: a communal building hub where "app builders find business partners and people with ideas and markets find builders", where people can collaborate directly and send agents to help. That record calls these ambitions, not existing workflows.
- The [proposed ecosystem architecture](https://github.com/Moissanite-Labs/credos/blob/d3a5a619a725f28b1a359c89080d92091db8fb45/SILICONCORDAT.md) places Exofab next to Exo, the Synbios forge, the Koinos collaboration protocol, and Ethos, and proposes a first end-to-end slice.
- The [organization site](https://moissanite-labs.github.io/.github/) labels Exofab an early proposal. The repository's original description called it the "creation hub of project exo".

## Documents

- [Orientation](docs/orientation.md): purpose, what the project record already says, and the questions that remain open
- [Ecosystem boundaries](docs/ecosystem.md): what Exofab proposes to own and what it references in sibling repositories
- [First slice proposal](docs/first-slice.md): the proposed first use case, worked example, and acceptance criteria
- [Roadmap and decision record](docs/roadmap.md): proposed stages, recorded decisions, and proposals under review
- [Prior art notes](docs/research/prior-art.md): reference material from earlier platforms
- [First-slice prototype](docs/prototype.md): a local reference prototype for testing the proposal (proposal P-4)
- [Contributing](CONTRIBUTING.md) and [agent guidance](AGENTS.md)

## Try the prototype

The prototype is a proposal under review, not an adopted product. It needs Node.js 22 or newer and installs nothing.

```sh
npm run demo    # the synthetic journey end to end, with an exported, verified record
npm start       # the local hub and browser client at http://127.0.0.1:4317
npm test
```

All data is fictional. See [prototype](docs/prototype.md) for what it does and does not do.

## License

No license has been selected. Do not assume one.
