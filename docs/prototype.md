# First-slice prototype

> **Proposal for review.** This is a local reference prototype for testing the [first slice proposal](first-slice.md). Its runtime, structure, and interfaces are proposal P-4 in the [decision record](roadmap.md#proposals-under-review) and are not adopted until a maintainer accepts them. It is not a hosted service, it handles synthetic data only, and it grants no license.

## What it is

A single local program that runs the first-slice journey end to end on one machine:

- a **hub** that keeps briefs, profiles, interests, matches, and teams, and sequences each project's Koinos records;
- an **independent Koinos 0.1 implementation** that builds, signs, and verifies records in Node.js and in the browser;
- a **browser client** in which each person's signing key is generated and kept by the browser, never by the hub;
- a **command-line tool** for serving, the synthetic demonstration, agent actions, export, import, and verification;
- an optional **Synbios adapter** that turns a charter into a Synbios task and reads a Synbios task export back as a contribution artifact.

## Proposed runtime

Node.js 22 or newer, standard library only, no package installation, and no build step. The reasons for proposing it:

- Node.js and modern browsers both provide Ed25519 and SHA-256 through WebCrypto, so one Koinos module serves the hub, the command line, and the browser. The Python standard library has no Ed25519.
- Koinos 0.1 uses the same runtime and dependency policy, and Synbios's runtime also uses only its standard library.
- With no dependencies, there is no supply chain to review and nothing to install.

## Run it

```sh
npm run check          # syntax and documentation link checks
npm test               # unit, integration, and end-to-end tests (see "Conditional test suites")
npm run demo           # synthetic journey; prints the exported bundle path
npm start              # serves http://127.0.0.1:4317
node src/cli.mjs --help
```

The command-line tool is `node src/cli.mjs`, run from the repository root. This document writes it as `exofab`, the name `package.json` gives it, but nothing puts an `exofab` command on your `PATH`: type `node src/cli.mjs` where it says `exofab`, or `node /path/to/exofab/src/cli.mjs` from another directory.

`npm start` keeps its data in `./.exofab`. Open the address in a browser, create a person, and follow the journey. Keys are created and kept in that browser profile. Use a second browser profile for a second person, or the in-page identity switcher, which is labelled as a single-machine demonstration aid.

## Layout

| Path | Contents |
| --- | --- |
| `src/koinos/` | Independent Koinos 0.1 implementation: canonical JSON, encodings, WebCrypto keys and signatures, record creation, bundle verification, and derived state. Runs in Node.js and browsers. |
| `src/json/strict.mjs` | Size-bounded JSON parser that rejects duplicate keys. |
| `src/hub/store.mjs` | File store: hash-chained hub log, per-project bundles, content-addressed blobs, credential hashes, trusted heads. |
| `src/hub/hub.mjs` | Hub rules: accounts, profiles, briefs, interests, matches, teams, record sequencing, and the hub policies. |
| `src/server.mjs` | Loopback HTTP API and static client. |
| `src/client.mjs` | HTTP client used by the command line and the demonstration. |
| `src/cli.mjs` | Command-line entry point. |
| `src/demo.mjs` | Synthetic end-to-end journey through the HTTP API. |
| `src/export.mjs` | Export directories (bundle, cited bytes, verification note) and their offline verification. |
| `src/adapters/synbios.mjs` | Optional Synbios adapter. |
| `web/` | Browser client: plain HTML, CSS, and JavaScript modules. |
| `test/` | `node:test` suites. The browser journey runs only when Playwright is available, and the interoperability suites only when sibling checkouts are provided. |
| `scripts/` | Repository checks. |
| `.github/workflows/` | Continuous integration: checks, tests, and the demonstration on Linux and macOS with Node.js 22 and 24. |

## Identities and keys

- An identity is a Koinos key id: `koinos:ed25519:` followed by the unpadded base64url encoding of a 32-byte Ed25519 public key.
- **People.** The browser generates a non-extractable key with WebCrypto and stores it in IndexedDB. People act through the browser client: no command signs as a person, and `exofab agent register` authenticates the person with their session token, not their key.
- **Agents.** An agent's key belongs to the agent's runtime: a PEM file used by `exofab agent` commands. A person registers an agent by presenting the agent's public key and a proof signed by that key.
- **Proof of possession.** Registration signs a hub challenge: `exofab/0.1\nregister-person\n<nonce>\n<key>` for people and `exofab/0.1\nregister-agent\n<nonce>\n<key>\n<principal>` for agents. Challenges are single-use and expire after five minutes. The hub keeps no table of outstanding challenges: each nonce carries its expiry and an HMAC under a key the hub makes when it starts, so requesting many challenges cannot push out one in use. Spent nonces are remembered until they expire, and a restart invalidates outstanding challenges.
- **Sessions.** Registration returns a bearer token once. The hub stores only its SHA-256. Authority always comes from the token, never from request fields.

The hub never receives a private key. A test checks that the data directory contains no private key material after the demonstration.

## Hub state

The hub log is an append-only JSON file. Each event is `{seq, prev, time, author, type, body, hash}`, where `hash` is the SHA-256 of the canonical JSON of the other fields and `prev` is the previous event's hash. The store refuses to load a log whose chain does not verify.

Each stored file has a size limit: 64 MiB for the hub log, 4 MiB each for the credentials, the trusted heads and a project's blob list. A change that would make a file larger than its limit is refused with `507` and nothing is stored, so the hub keeps serving reads and still starts. There are no per-person quotas, so one registered person can fill the hub log, after which the hub refuses further changes. This is acceptable only because the prototype is a single-machine demonstration with synthetic data.

| Event type | Author | Meaning |
| --- | --- | --- |
| `person.registered` | person | Account created for a proven key |
| `agent.registered` | person | Agent key bound to its principal |
| `profile.updated` | person | Name, headline, skills, what they are seeking, listing |
| `brief.published` | person | Title, summary, roles, compensation statement, listing |
| `brief.updated` | owner | Status `open` or `closed`, or edited fields |
| `interest.expressed` | person | Interest in one role, with a note |
| `interest.withdrawn` | candidate | |
| `interest.decided` | owner | `accept` adds the candidate to the team; `decline` closes it |
| `agent.nominated` | team member | One of their own agents will be listed at genesis |
| `project.started` | owner | Links the brief to the Koinos project id |

Each project's Koinos history is stored separately as a `koinos-bundle/0.1` file. The hub also keeps the last verified `{project, head}` pair and refuses a stored bundle that does not extend it.

## Hub policies

These narrow Koinos 0.1. None widens it.

1. The authenticated identity must equal the record's `actor`.
2. `previous` must equal the current head. Otherwise the hub answers `409` with the current head, and the client rebuilds and signs again.
3. A record's `time` must be within ten minutes before and two minutes after the hub clock, and not earlier than the previous record.
4. Genesis must be signed by the brief owner and list exactly the team: the owner, accepted candidates, and nominated agents, with their registered names and kinds. The team must include at least two people, because Koinos acceptance needs a reviewer who is neither the submitter nor the principal.
5. `agreement.proposed` must cite a blob already stored for the project, using the URI `ni:///sha-256;<base64url digest>` and its hex digest.
6. `contribution.submitted` must cite a stored artifact blob in the same way.
7. `delegation.granted` may name only an agent registered under the granting person's account.
8. Agent credentials can call only read endpoints for their projects, blob upload, and record append for `contribution.submitted`.
9. Project records and blobs are visible only to project participants. A blob is served for a project only if it was stored for that project, by upload or by `exofab import --blobs`; a record citing its digest is not enough. Briefs and profiles are visible to others only when listed, except between people the hub has already put in contact: a brief's owner and its candidates, and teammates. Sharing an imported project does not count, because a Koinos genesis is signed by its steward alone.

## HTTP API

The server binds to `127.0.0.1` only. It rejects other `Host` headers, rejects cross-origin requests, caps JSON bodies at 1 MiB and blobs at 4 MiB, and parses JSON with duplicate-key rejection. Errors are `{"error": {"code", "message"}}`, with `head` and `sequence` added on `409` and `koinosCode` added when Koinos refuses a record.

| Method and path | Who | Purpose |
| --- | --- | --- |
| `GET /api/health` | anyone | Version and record protocol |
| `GET /.well-known/exofab.json` | anyone | Discovery, including what the hub will not do |
| `POST /api/challenges` | anyone | Registration challenge |
| `POST /api/people` | anyone | Register a person with proof of key possession |
| `POST /api/agents` | person | Register an agent with proof signed by the agent key |
| `GET /api/me` | person or agent | Own identity, profile, agents |
| `PUT /api/me/profile` | person | Update own profile |
| `GET /api/people`, `GET /api/people/{id}` | person | Listed profiles |
| `GET /api/people/{id}/credit` | person | Accepted contributions in projects the viewer shares |
| `POST /api/briefs`, `GET /api/briefs` | person | Publish and list briefs |
| `GET /api/briefs/{id}`, `PATCH /api/briefs/{id}` | person; owner edits | Read or update a brief |
| `GET /api/suggestions` | person | Briefs whose roles share declared skills, with reasons |
| `GET /api/briefs/{id}/suggestions` | owner | Listed people who share a role's skills, with reasons |
| `POST /api/briefs/{id}/interests` | person | Express interest in a role |
| `POST /api/interests/{id}/withdraw` | candidate | Withdraw interest |
| `POST /api/interests/{id}/decision` | owner | Accept or decline |
| `POST /api/briefs/{id}/agents` | team member | Nominate one of their own agents |
| `GET /api/briefs/{id}/genesis` | owner | Draft genesis body and project id |
| `POST /api/briefs/{id}/project` | owner | Start the record with a signed genesis |
| `GET /api/projects` | person or agent | Projects the caller participates in |
| `GET /api/projects/{pid}` | participant | Verified state, records, head |
| `GET /api/projects/{pid}/bundle` | participant | Export the bundle |
| `POST /api/projects/{pid}/records` | participant | Append one signed record |
| `POST /api/projects/{pid}/blobs` | participant | Store bytes; returns digest and `ni:` URI |
| `GET /api/projects/{pid}/blobs/{digest}` | participant | Read stored bytes |

## Command line

| Command | Purpose |
| --- | --- |
| `exofab serve [--data DIR] [--port N]` | Run the hub and browser client |
| `exofab demo [--out DIR] [--data DIR]` | Run the synthetic journey through the HTTP API, export the result, and verify the export from disk |
| `exofab keygen OUT.pem` | Create a key file and print its id |
| `exofab verify BUNDLE [--expect-head H] [--expect-project P] [--blobs DIR]` | Verify a bundle and, optionally, the bytes it references. Prints every cited URI; one that is not an `ni:///sha-256` URI is reported with a warning and never fetched. |
| `exofab export PROJECT OUTDIR [--data DIR]` | Write the bundle, referenced bytes, and a short verification note |
| `exofab import BUNDLE [--data DIR] [--expect-head H] [--blobs DIR]` | Import a verified bundle without changing attribution and, with `--blobs`, the bytes it cites. Warns when a history not started on this hub names identities registered here: the project then appears in their lists. |
| `exofab agent register` / `exofab agent submit` | Act as an agent against a running hub |
| `exofab synbios task` / `exofab synbios inspect` | Optional Synbios hand-off helpers |

`exofab serve` and `exofab import` hold a lock file, `exofab.lock`, in the data directory, so only one process uses it at a time. A lock left by a process that has stopped is replaced only by a process that also holds `exofab.lock.break`, so two processes starting together cannot both take it over.

## Conditional test suites

`npm test` runs every suite, but some tests run only when what they need is available. Otherwise each one is skipped, and its skip message says why. Continuous integration provides none of these, so it skips them all.

- `test/web.e2e.test.mjs` drives the browser client through the whole journey with Playwright, when `require("playwright")` resolves, for example through `NODE_PATH`. Playwright is not a dependency and nothing here installs it. It is the only test that shows the consent dialog in a browser (acceptance criterion 3); `test/e2e.test.mjs` checks the same terms and digest logic without a browser. Screenshots go to a temporary directory that is removed afterwards; set `EXOFAB_SCREENSHOTS=DIR` to keep them.
- One test in `test/koinos.test.mjs` reads the Koinos example bundle and its cited files as data when `KOINOS_DIR` is set, and verifies them with Exofab's implementation. No Koinos code is loaded.
- The three interoperability suites below.

## Interoperability checks

Three suites check Exofab against the sibling reference implementations. Each one runs only when the variables it needs are set. Otherwise it is skipped, and the skip message names the missing variable. Continuous integration has no sibling checkouts, so it skips all three; a maintainer runs them locally. The Koinos half of acceptance criterion 6 is therefore shown only in a maintainer's run. The last such run, on 2026-11-01 against Koinos `5b5f4f9` and Synbios `c285f07`, passed all 29 interoperability tests.

| Suite | Needs | What it checks |
| --- | --- | --- |
| `test/interop-koinos.test.mjs` | `KOINOS_DIR` | Exofab's verifier derives the same state as `koinos inspect` from the Koinos example bundle. Histories made by Exofab pass Koinos `import`, `verify` (with head and project pins) and `inspect`, and the derived state is deep-equal. Exofab rejects all 23 mutated bundles, and its reason for each rejection is asserted. Koinos `5b5f4f9` rejects all 23 as well. |
| `test/interop-synbios.test.mjs` | `SYNBIOS_DIR` | A temporary Synbios runs a task made by `taskFromCharter` through claim, artifact, test evidence, submission and independent human approval, and refuses a review by the agent. Exofab's `inspectExport` and Synbios's own `verify` both accept the exact export bytes, and both reject an edited copy. |
| `test/interop-journey.test.mjs` | both | The milestone 3 journey. Ada and Ben agree a charter in an Exofab hub over HTTP, and Ben delegates to scribe. scribe's work is a real Synbios task with a forge artifact, passing test evidence and a forge review by Ada. The exact export bytes become the artifact of scribe's `contribution.submitted`. Ada reads them back from the hub, reviews and accepts. The export written from the hub then verifies with Exofab and with Koinos: `verify` of the bundle file and of an imported store, both with head and project pins, and `inspect` deep-equal to Exofab's derived state. Its cited artifact file still passes Synbios `verify`. A second Synbios task checks that `inspectExport` warns about a `file:` URI and an absolute local path. |

### Prerequisites

- Node.js 22 or newer, as for the rest of the prototype.
- A Koinos checkout that contains `src/cli.mjs` and `examples/accepted.bundle.json`. These suites were written against Koinos commit `5b5f4f9`.
- A Synbios checkout that contains `synbios/__main__.py`, and Python 3.11 or newer. These suites were written against Synbios commit `0346695` and also pass against `c285f07`. Set `SYNBIOS_PYTHON` to choose the interpreter; the default is `python3`.
- No installation in either checkout. Koinos has no dependencies. Synbios runs from its checkout through `PYTHONPATH` and does not need its web client.

### Running them

```sh
# Everything, including all three interoperability suites
KOINOS_DIR=/path/to/koinos SYNBIOS_DIR=/path/to/synbios npm test

# One suite at a time
KOINOS_DIR=/path/to/koinos node --test test/interop-koinos.test.mjs
SYNBIOS_DIR=/path/to/synbios node --test test/interop-synbios.test.mjs
KOINOS_DIR=/path/to/koinos SYNBIOS_DIR=/path/to/synbios node --test test/interop-journey.test.mjs
```

Relative paths are resolved against the current directory. A variable that is set but does not name a checkout fails the suite with a message; it is not skipped.

### How they run sibling code

- No Koinos or Synbios code is imported into the test process. The suites run `node $KOINOS_DIR/src/cli.mjs` and `python -m synbios` as separate processes on files in a new temporary directory, which is removed afterwards.
- A child process gets only `PATH`, plus, for Synbios, `PYTHONPATH` and settings for UTF-8, no bytecode files and no user site packages. No credentials or other variables are passed on.
- Synbios is started with `serve --host 127.0.0.1 --port 0` on a temporary database, which `init` creates. It is stopped with SIGINT, then SIGKILL after five seconds.
- All data is synthetic: the people Ada and Ben and the agent scribe.

### Reading the results

- **Known divergences.** Cases where the Koinos reference accepts a bundle that Exofab rejects on purpose are listed in `KNOWN_UPSTREAM` in `test/interop-koinos.test.mjs`. They are reported as `# TODO` with the reason and do not fail the run, while Exofab's own rejection is still asserted. The list is currently empty.
- The Koinos comparisons are accept or reject only. Koinos has no error codes, so the reasons cannot be compared.
- A Synbios export is unsigned. A valid `inspectExport` or Synbios `verify` result shows internal consistency, not who produced the bytes. The Koinos record signs the digest of the exact bytes that were reviewed.

### Not covered

- Synbios Git intake (`synbios capture`) is not run. The leak check uses the URI shape that it records instead.
- Synbios `POST /api/bundles/verify`, `GET /api/events` and `GET /api/schema` are not called.

Koinos and Synbios code is never copied into this repository: neither has a license, and an independent implementation is what the Koinos roadmap asks for.

## What it does not do

It does not host anyone's data, prove personhood, recover lost keys, federate between hubs, move money, create legal agreements, score people, or use preferences learned elsewhere. A signature proves control of a key, not identity. The demonstration data is fictional and visibly labelled.
