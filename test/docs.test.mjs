// Tests that the repository's own documents match the code: links resolve,
// proposals are reachable from the entry documents and recorded as proposals,
// and the claims docs/prototype.md and docs/first-slice.md make about the
// command line, the test suites and the evidence they cite stay true.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { checkMarkdown } from '../scripts/check.mjs';
import { main } from '../src/cli.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(join(ROOT, path), 'utf8');
const sink = () => new Writable({ write: (_chunk, _encoding, done) => done() });

// The lines of a Markdown section, from its heading to the next heading of the same or higher level.
function section(markdown, heading) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => l.replace(/^#+\s*/, '') === heading && l.startsWith('#'));
  assert.ok(start >= 0, `no section "${heading}"`);
  const level = /^#+/.exec(lines[start])[0].length;
  const end = lines.findIndex((l, i) => i > start && /^#+\s/.test(l) && /^#+/.exec(l)[0].length <= level);
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

test('every relative link in the repository documents resolves', async () => {
  const { links, problems } = await checkMarkdown();
  assert.ok(links > 0);
  assert.deepEqual(problems, []);
});

test('the proposals are reachable from the entry documents and recorded as proposals, not decisions', async () => {
  const roadmap = await read('docs/roadmap.md');
  const proposals = section(roadmap, 'Proposals under review');
  for (const doc of ['first-slice.md', 'prototype.md']) {
    const row = proposals.split('\n').find((l) => l.includes(`](${doc})`));
    assert.ok(row, `roadmap.md does not list ${doc}`);
    assert.match(row, /\| Unassigned \| Proposed(, not adopted)? \|/);
  }
  const readme = await read('README.md');
  for (const doc of ['docs/first-slice.md', 'docs/prototype.md']) assert.ok(readme.includes(`](${doc})`), `README.md does not link ${doc}`);
  assert.ok((await read('CONTRIBUTING.md')).includes('](docs/prototype.md)'));
  // A decision id cited anywhere must be defined in the decision record.
  for (const doc of ['docs/first-slice.md', 'docs/prototype.md', 'README.md', 'CONTRIBUTING.md']) {
    for (const [id] of (await read(doc)).matchAll(/\b(?:EXF|P)-\d+\b/g)) assert.ok(roadmap.includes(id), `${doc} cites ${id}, which the decision record does not define`);
  }
});

test('the documented commands exist, and people sign only in the browser, except the demonstration’s fictional people', async () => {
  const prototype = await read('docs/prototype.md');
  const table = section(prototype, 'Command line');
  const commands = new Set([...table.matchAll(/`exofab ([a-z]+)/g)].map((m) => m[1]));
  assert.ok(commands.size >= 8);
  for (const command of commands) assert.equal(await main([command, '--help'], { stdout: sink(), stderr: sink(), env: {} }), 0, `exofab ${command}`);
  // `exofab` is a name for the entry point; the document says how to run it.
  assert.ok(section(prototype, 'Run it').includes('`node src/cli.mjs`'));
  // Only the demonstration signs as (fictional) people, and the document must say so;
  // it must not say the command line holds a real person's key.
  const people = section(prototype, 'Identities and keys').split('\n').find((l) => l.startsWith('- **People.**'));
  assert.doesNotMatch(people, /command line uses/i);
  assert.doesNotMatch(people, /no command signs as a person/i);
  assert.match(people, /Only `exofab demo` signs as a person: it plays its fictional people with keys generated in memory for that run\./);
  assert.match(people, /No command holds a real person's key/);
});

test('every test suite that can skip is documented with what it needs', async () => {
  const prototype = await read('docs/prototype.md');
  const suites = (await readdir(join(ROOT, 'test'))).filter((f) => f.endsWith('.test.mjs') && f !== 'docs.test.mjs');
  for (const file of suites) {
    if ((await read(`test/${file}`)).includes('t.skip(')) assert.ok(prototype.includes(`test/${file}`), `docs/prototype.md does not mention test/${file}`);
  }
});

test('no test writes into the repository: screenshots and data go to temporary directories', async () => {
  for (const file of (await readdir(join(ROOT, 'test'))).filter((f) => f.endsWith('.mjs'))) {
    const source = await read(`test/${file}`);
    assert.doesNotMatch(source, /join\(\s*ROOT\s*,\s*'out'/, `test/${file} writes under the repository's out/`);
  }
});

test('the interoperability description counts the mutated bundles the suite actually has', async () => {
  const source = await read('test/interop-koinos.test.mjs');
  const block = (name) => {
    const start = source.indexOf(`const ${name} = {`);
    if (source.startsWith(`const ${name} = {};`, start)) return '';
    return source.slice(start, source.indexOf('\n};', start));
  };
  const total = [...block('MUTATIONS').matchAll(/^ {2}'[^']+': \[/gm)].length;
  const known = [...block('KNOWN_UPSTREAM').matchAll(/^ {2}'[^']+':/gm)].length;
  assert.ok(total >= 12);
  const prototype = await read('docs/prototype.md');
  assert.ok(prototype.includes(`Exofab rejects all ${total} mutated bundles`), `expected "all ${total}"`);
  // Mutated bundles are compared on accept or reject alone; valid histories on their full derived state.
  const reading = section(prototype, 'Reading the results');
  assert.ok(reading.includes(`For the ${total} mutated bundles, the comparison with Koinos is accept or reject only`), 'reject-only comparison');
  assert.match(reading, /Valid histories are compared on their full derived state/);
  const koinosShare = known === 0 ? `rejects all ${total} as well` : `rejects ${total - known} of them`;
  assert.ok(prototype.includes(koinosShare), `expected "${koinosShare}"`);
});

test('the first-slice summary cites the lines that call Exofab the human-first hub', async () => {
  const sentence = (await read('docs/first-slice.md')).split('\n').find((l) => l.includes('prospective human-first collaboration hub'));
  assert.ok(sentence);
  assert.ok(sentence.includes('koinos/blob/5b5f4f9eaffe45a718601744366b8ac507ffc4b6/docs/vision.md#L22'));
  assert.ok(sentence.includes('synbios/blob/03466957a582d57b786087fb5b3fc668aab1711c/docs/vision.md#L30'));
});
