// Tests for scripts/check.mjs: GitHub heading slugs, link extraction, and the
// syntax and link checks on small fixture repositories in temporary directories.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkMarkdown, checkSyntax, githubSlug, markdownAnchors, markdownLinks } from '../scripts/check.mjs';

async function fixture(t, files) {
  const root = await mkdtemp(join(tmpdir(), 'exofab-check-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

test('githubSlug follows GitHub heading anchors', () => {
  assert.equal(githubSlug('HTTP API'), 'http-api');
  assert.equal(githubSlug('Gaps found in sibling repositories'), 'gaps-found-in-sibling-repositories');
  assert.equal(githubSlug('What it does not do'), 'what-it-does-not-do');
  assert.equal(githubSlug('Risks and open questions?'), 'risks-and-open-questions');
  assert.equal(githubSlug('Step 1: frame (the) use case.'), 'step-1-frame-the-use-case');
  assert.equal(githubSlug('snake_case and kebab-case'), 'snake_case-and-kebab-case');
  assert.equal(githubSlug('Two  spaces'), 'two--spaces');
  assert.equal(githubSlug('Café déjà vu'), 'café-déjà-vu');
});

test('markdownAnchors handles inline markup, repeats, setext headings, HTML ids and code fences', () => {
  const md = [
    '# Title',
    '## `exofab serve` and **bold** [link](x.md)',
    '## Repeat',
    '## Repeat',
    'Setext heading',
    '---',
    '<a id="custom-anchor"></a>',
    '```md',
    '## Not a heading',
    '```',
    '### Closing hashes ###',
  ].join('\n');
  const anchors = markdownAnchors(md);
  for (const a of ['title', 'exofab-serve-and-bold-link', 'repeat', 'repeat-1', 'setext-heading', 'custom-anchor', 'closing-hashes']) {
    assert.ok(anchors.has(a), a);
  }
  assert.ok(!anchors.has('not-a-heading'));
});

test('markdownLinks finds inline links, images and definitions outside code', () => {
  const md = [
    'See [a](docs/a.md), ![img](img.svg "title") and [b](<docs/with space.md#part>).',
    'Code `[c](nope.md)` is skipped.',
    '[ref]: ../other.md',
    '~~~',
    '[d](also-nope.md)',
    '~~~',
    'And [e](https://example.org) [f](#local).',
  ].join('\n');
  assert.deepEqual(markdownLinks(md).map((l) => [l.target, l.line]), [
    ['docs/a.md', 1],
    ['img.svg', 1],
    ['docs/with space.md#part', 1],
    ['../other.md', 3],
    ['https://example.org', 7],
    ['#local', 7],
  ]);
});

test('checkMarkdown reports missing files, missing anchors and links leaving the repository', async (t) => {
  const root = await fixture(t, {
    'README.md': '# Readme\n\n[ok](docs/a.md#section-one) [self](#readme) [web](https://example.org/missing)\n[dir](docs) [mail](mailto:x@example.org)\n',
    'docs/a.md': '# A\n\n## Section one\n\n[back](../README.md) [bad anchor](../README.md#nope) [missing](b.md) [out](../../x.md)\n[txt](notes.txt#top) [enc](%E0%A4%A.md)\n',
    'docs/notes.txt': 'plain\n',
  });
  const { files, links, problems } = await checkMarkdown(root);
  assert.equal(files, 2);
  assert.equal(links, 9);
  assert.deepEqual(problems, [
    'docs/a.md:5: link ../README.md#nope names a heading that does not exist',
    'docs/a.md:5: link b.md points to a missing file',
    'docs/a.md:5: link ../../x.md leaves the repository',
    'docs/a.md:6: link notes.txt#top has an anchor but does not point to a Markdown file',
    'docs/a.md:6: link %E0%A4%A.md has invalid percent-encoding',
  ]);
});

test('checkMarkdown skips ignored directories', async (t) => {
  const root = await fixture(t, {
    'README.md': '# Readme\n',
    'node_modules/x/README.md': '[broken](nope.md)\n',
    '.exofab/notes.md': '[broken](nope.md)\n',
    'out/report.md': '[broken](nope.md)\n',
  });
  assert.deepEqual((await checkMarkdown(root)).problems, []);
});

test('checkSyntax runs node --check on modules under src, web, test and scripts', async (t) => {
  const root = await fixture(t, {
    'src/good.mjs': 'export const x = 1;\n',
    'web/bad.mjs': 'export const = ;\n',
    'test/deep/also-good.mjs': 'import { x } from "../../src/good.mjs";\nexport { x };\n',
    'other/ignored.mjs': 'this is not checked\n',
  });
  const { files, problems } = await checkSyntax(root);
  assert.equal(files, 3);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^web\/bad\.mjs: SyntaxError/);
});
