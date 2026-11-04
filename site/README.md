# Exofab static demo

This is a standalone, synthetic interaction demo for GitHub Pages, not the loopback hub from PR #6 and not a hosted MVP. Open `index.html` directly in a modern browser. No build, backend, account, key or network request is needed. Refresh or Reset clears choices; Download demo log saves a clearly unsigned, unverified JSON interaction log. Do not enter personal or confidential information into the optional reason field.

## Design provenance

Adapted from the chosen **Crystal Lattice merged** design in [PR #17](https://github.com/Moissanite-Labs/exofab/pull/17), specifically `docs/design/ui-directions/4-crystal-lattice-merged.html` at `ee02b4bba59c5f978e90039d01564b770fbe8ae4`. Original design work is preserved and credited; this does not merge or change that PR, settle other project proposals, or grant a license. The inline illustrative signature originates in that design and has no legal or cryptographic force.

The demo preserves the fictional Tidepool crew, source notes, lattice, approval animation and accessible controls. Release adaptations make simulated effects explicit, remove remote font requests, add reset/export, and prevent a delayed milestone toast after revocation.

## Verification

- `node scripts/check-demo.cjs` from the repository root checks syntax, IDs, anchors, local-only assets and synthetic labels.
- `node scripts/test-demo.cjs` requires Playwright 1.62.1 and its Chromium. Optionally set `CHROMIUM_EXECUTABLE` to a local Chromium executable. It exercises desktop/mobile, approval, decline/cancel, escaped notes, revision, revoke, reset, download, no overflow, no external requests, and a normal-motion double-click/revoke race.
- Local browser execution was blocked by this build environment's socket restriction. Browser assertions must pass in CI before release. Safari, Firefox and real screen readers are not verified.

## Pages release

The workflow checks PRs without deploying. A reviewed merge to `main` runs the same checks, uploads only `site/`, and deploys to the repository's `github-pages` environment. Repository Settings → Pages must use **GitHub Actions**. No repository settings or credentials are changed by these files. Branch protection and environment approvals still apply. The workflow will fail, rather than weaken a gate, if Pages is not configured.

The intended public URL is https://moissanite-labs.github.io/exofab/; do not call it live until deployment and an HTTP/browser check succeed. The real hub, Koinos cryptographic verification, Synbios handoff and company/finance workflows remain separate work. No real sends, filings, signatures, agents or payments occur here.
