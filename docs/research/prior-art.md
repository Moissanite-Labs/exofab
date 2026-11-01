# Prior art notes

> **Reference material, not decisions.** These notes were compiled on 2026-10-31 to inform the [first slice proposal](../first-slice.md). They summarize public sources about earlier platforms; they do not adopt any of them, their formats, or their services. Dates and outcomes come from the linked sources and were not independently audited. Check a source before repeating a claim from it. Nothing here is legal advice.

The founder framed Exofab as "hitrecord meets tinder meets linkedin" ([credos FOUNDER-VISION.md:21](https://github.com/Moissanite-Labs/credos/blob/d3a5a619a725f28b1a359c89080d92091db8fb45/FOUNDER-VISION.md#L21)). The notes follow that framing: collaborative production and credit, matching, and professional identity, then the newer question of delegating work to agents.

## Collaborative production and credit

- **HitRecord** let anyone contribute to and remix creative work, kept an attribution history for each piece, and shared profits from monetized productions with contributors. It drew a "spec work" backlash in 2018 over a fan-sourced game-asset project, and it wound down its community collaborative projects in May 2022 when its team joined MasterClass. ([VentureBeat](https://venturebeat.com/business/joseph-gordon-levitt-hitrecord-is-github-for-creativity), [Hollywood Reporter](https://www.hollywoodreporter.com/business/digital/joseph-gordon-levitt-hitrecord-masterclass-1235146242/), [PCGamesInsider](https://www.pcgamesinsider.biz/news/67240/joseph-gordon-levitt-responds-to-backlash-against-beyond-good-and-evil-2-spec-work-accusations/))
- **SourceCred** computed contribution scores from activity graphs and paid rewards from them. Its organization dissolved in 2022; later accounts describe gaming and funding problems. ([Metagame](https://metagame.substack.com/p/sourcecred-is-dead-long-live-sourcecred), [Protocol Labs Research](https://research.protocol.ai/blog/2020/sourcecred-an-introduction-to-calculating-cred-and-grain/))
- **Coordinape** let teams allocate credit to each other by peer vote. Its site now says the app is sunset. ([Coordinape](https://coordinape.com/))
- **Gitcoin** wound down its Grants Stack and Allo software in 2025 while continuing its grants program. ([The Block](https://www.theblock.co/news/markets/2025-04-25-ethereum-public-goods-funding-protocol-gitcoin-winding-down-its-software-division-352055), [Gitcoin](https://gitcoin.co/blog/grants-stack-winds-down--heres-whats-changing-and-what-to-expect))
- **Incentive programs** that rewarded countable contributions attracted spam: Hacktoberfest moved to maintainer opt-in in October 2020, and tea.xyz rewards drew package spam in 2024. ([The Register](https://www.theregister.com/2020/10/01/digitalocean_hacktoberfest_pull_request_spam/), [Socket](https://www.socket.dev/blog/tea-xyz-spam-plagues-npm-and-rubygems-package-registries))
- **Optimism's retroactive funding** retrospective concluded that large open rounds drift toward popularity contests and that metrics should inform, not replace, human judgment. ([Optimism governance forum](https://gov.optimism.io/t/lessons-learned-from-two-years-of-retroactive-public-goods-funding/9239))

**Lessons for the first slice:** record accepted work as reviewed evidence, not as scores; keep credit separate from money; let recipients consent to and control incoming contributions; and say plainly whether any compensation is offered.

## Matching

- **YC Co-Founder Matching** uses structured profiles (technical or not, commitment, idea status), double opt-in invitations, and encourages trial projects before committing. YC's published data reports that most matches paired complementary founders. ([YC blog](https://www.ycombinator.com/blog/what-do-people-want-in-a-co-founder), [YC blog](https://www.ycombinator.com/blog/does-co-founder-matching-work))
- **Open co-founder marketplaces** such as CoFoundersLab grew largely by acquisition; founder accounts describe inactive or unverifiable profiles as the main problem. These accounts are anecdotal. ([TechCrunch](https://techcrunch.com/2014/01/30/cofounderslabs-looks-to-become-an-okcupid-for-founders-following-acquisition-of-stealth-mode-competitor-wonpy), [Indie Hackers](https://www.indiehackers.com/post/why-co-founder-matching-fails-df873190bc))

**Lessons for the first slice:** explicit, declared intent; double opt-in; a small scoped trial as the unit of commitment; and starting where people already are rather than with an empty network.

## Professional identity

- **Polywork**, a LinkedIn alternative, closed in January 2025. **Read.cv** was acquired and wound down the same month, giving users a deadline to export their data. ([Business Post](https://www.businesspost.ie/tech-news/stripe-backed-irish-linkedin-challenger-polywork-to-close/), [TechCrunch](https://techcrunch.com/2025/01/17/perplexity-acquires-read-cv-a-social-media-platform-for-professionals/))
- **LinkedIn** now lets partner sites display its verifications. It also began using member data for AI training by default in several regions from November 2025, which drew criticism. ([LinkedIn](https://news.linkedin.com/2025/Verified_on_LinkedIn), [Malwarebytes](https://www.malwarebytes.com/blog/news/2025/09/linkedin-will-use-your-data-to-train-its-ai-unless-you-opt-out-now))
- **GitHub** popularity signals are gamed: a 2024 study found millions of suspected fake stars. GitHub also added controls in 2026 that let maintainers limit incoming pull requests. ([arXiv 2412.13459](https://arxiv.org/abs/2412.13459), [GitHub changelog](https://github.blog/changelog/2026-06-17-limit-open-pull-requests-for-users-without-write-access/))

**Lessons for the first slice:** profiles work better as a by-product of accepted work than as the product; portable records outlive platforms; and reuse of people's content needs explicit consent.

## Money and legal structure

- **Bountysource** stopped paying awarded bounties in 2023 while holding contributors' funds. ([Wikipedia](https://en.wikipedia.org/wiki/Bountysource))
- **Open Collective Foundation**, a fiscal host, dissolved at the end of 2024; the Open Collective software continued. ([Open Collective](https://opencollective.com/foundation/updates/announcement-we-are-dissolving-open-collective-foundation-at-the-end-of-this-year))
- Public offers of equity, revenue shares, or tokens can be regulated as securities, and US equity crowdfunding runs through registered intermediaries. ([SEC](https://www.sec.gov/resources-small-businesses/exempt-offerings/regulation-crowdfunding))

**Lessons for the first slice:** no custody of funds, no automated allocation, and no platform-originated offers of equity or revenue. Record references to agreements people make themselves, with advice. This matches [credos SILICONCORDAT.md:27](https://github.com/Moissanite-Labs/credos/blob/d3a5a619a725f28b1a359c89080d92091db8fb45/SILICONCORDAT.md#L27).

## Delegating work to agents

- **GitHub's coding agent** works on its own branch for an authorized requester; the requester cannot approve its pull request, and workflow runs need human approval. ([GitHub Docs](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent), [GitHub Docs](https://docs.github.com/en/copilot/concepts/security-governance-and-network-settings/risks-and-mitigations))
- **Upwork's** 2025 study of agents on real jobs reported much higher completion when people gave brief feedback than when agents worked alone. ([VentureBeat](https://venturebeat.com/technology/upwork-study-shows-ai-agents-excel-with-human-partners-but-fail))
- **Moltbook**, a social network for agents, exposed credentials in early 2026 and could not tell agents from scripted accounts. ([Wiz](https://wiz.io/blog/exposed-moltbook-database-reveals-millions-of-api-keys))

**Lessons for the first slice:** bind every agent to an accountable person; scope and time-limit what an agent may do; keep review independent of the person who delegated; and never expose credentials to clients.
