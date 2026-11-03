// Repository checks, standard library only:
//   1. node --check on every .mjs file under src, web, test and scripts;
//   2. every relative Markdown link and #anchor in the repository's *.md files
//      resolves (GitHub heading slugs). Links with a URI scheme, such as
//      http(s) or mailto, are not fetched or checked.
// Exits 1 with a list of problems, 0 when everything passes.
import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CODE_DIRS = ['src', 'web', 'test', 'scripts'];
const SKIP_DIRS = new Set(['.git', 'node_modules', '.exofab', 'out']);

async function walk(dir, keep) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return out;
    throw error;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...(await walk(path, keep)));
    } else if (entry.isFile() && keep(entry.name)) {
      out.push(path);
    }
  }
  return out.sort();
}

const display = (root, path) => relative(root, path).split(sep).join('/');

// --- Syntax -------------------------------------------------------------------------------

export async function checkSyntax(root = ROOT) {
  const files = (await Promise.all(CODE_DIRS.map((d) => walk(join(root, d), (n) => n.endsWith('.mjs'))))).flat();
  const run = promisify(execFile);
  const problems = [];
  for (const file of files) {
    try {
      await run(process.execPath, ['--check', file]);
    } catch (error) {
      const detail = String(error.stderr ?? error.message).trim().split('\n').find((l) => /Error/.test(l)) ?? 'syntax error';
      problems.push(`${display(root, file)}: ${detail}`);
    }
  }
  return { files: files.length, problems };
}

// --- Markdown -----------------------------------------------------------------------------

// GitHub's heading anchor: lowercase, drop everything but letters, marks,
// numbers, connector punctuation (such as _), hyphens and spaces, then turn
// each space into a hyphen.
export function githubSlug(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
}

// The rendered text of inline Markdown, near enough for anchors: images and
// links keep their text, code keeps its content, HTML tags and emphasis
// markers go.
function inlineText(markdown) {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/`+([^`]*)`+/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/(^|[^\p{L}\p{N}])[*_]+|[*_]+(?=[^\p{L}\p{N}]|$)/gu, '$1')
    .trim();
}

// Lines outside fenced code blocks, with their 1-based numbers.
function proseLines(markdown) {
  const out = [];
  let fence = null;
  markdown.split(/\r?\n/).forEach((line, i) => {
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      return;
    }
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (open) fence = open[1];
    else out.push({ line, number: i + 1 });
  });
  return out;
}

// Anchors a Markdown file defines: heading slugs (with GitHub's -1, -2
// suffixes for repeats) and explicit HTML id or name attributes.
export function markdownAnchors(markdown) {
  const anchors = new Set();
  const seen = new Map();
  const add = (text) => {
    const base = githubSlug(inlineText(text));
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.add(n === 0 ? base : `${base}-${n}`);
  };
  const lines = proseLines(markdown);
  lines.forEach(({ line }, i) => {
    const atx = /^ {0,3}#{1,6}(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (atx) add(atx[1] ?? '');
    const next = lines[i + 1];
    if (!atx && next && next.number === lines[i].number + 1 && line.trim() !== '' && /^ {0,3}(=+|-+)[ \t]*$/.test(next.line) && !/^\s*([-*+]|\d+[.)])\s/.test(line) && !line.includes('|')) {
      add(line.trim());
    }
    for (const [, id] of line.matchAll(/<[a-z][^>]*\s(?:id|name)="([^"]+)"/gi)) anchors.add(id);
  });
  return anchors;
}

// Inline links and images, and reference definitions, outside code.
export function markdownLinks(markdown) {
  const links = [];
  for (const { line, number } of proseLines(markdown)) {
    const text = line.replace(/`+[^`]*`+/g, (code) => ' '.repeat(code.length));
    const inline = /!?\[(?:[^\[\]]|\[[^\]]*\])*\]\(\s*(<[^>]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
    for (const [, target] of text.matchAll(inline)) links.push({ target: target.replace(/^<|>$/g, ''), line: number });
    const definition = /^ {0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)/.exec(text);
    if (definition) links.push({ target: definition[1].replace(/^<|>$/g, ''), line: number });
  }
  return links;
}

const hasScheme = (target) => /^[a-z][a-z0-9+.-]*:/i.test(target);

function decode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

export async function checkMarkdown(root = ROOT) {
  const files = await walk(root, (n) => n.toLowerCase().endsWith('.md'));
  const anchorCache = new Map();
  const anchorsOf = async (path) => {
    if (!anchorCache.has(path)) anchorCache.set(path, markdownAnchors(await readFile(path, 'utf8')));
    return anchorCache.get(path);
  };
  const problems = [];
  let checked = 0;
  for (const file of files) {
    for (const { target, line } of markdownLinks(await readFile(file, 'utf8'))) {
      if (target === '' || hasScheme(target)) continue;
      checked++;
      const where = `${display(root, file)}:${line}`;
      const hash = target.indexOf('#');
      const pathPart = decode(hash === -1 ? target : target.slice(0, hash));
      const anchor = hash === -1 ? '' : decode(target.slice(hash + 1));
      if (pathPart === null || anchor === null) {
        problems.push(`${where}: link ${target} has invalid percent-encoding`);
        continue;
      }
      const path = pathPart === '' ? file : pathPart.startsWith('/') ? join(root, pathPart) : resolve(dirname(file), pathPart);
      if (relative(root, path).split(sep)[0] === '..') {
        problems.push(`${where}: link ${target} leaves the repository`);
        continue;
      }
      const info = await stat(path).catch(() => null);
      if (!info) {
        problems.push(`${where}: link ${target} points to a missing file`);
        continue;
      }
      if (anchor === '') continue;
      if (!info.isFile() || !path.toLowerCase().endsWith('.md')) {
        problems.push(`${where}: link ${target} has an anchor but does not point to a Markdown file`);
        continue;
      }
      if (!(await anchorsOf(path)).has(anchor)) problems.push(`${where}: link ${target} names a heading that does not exist`);
    }
  }
  return { files: files.length, links: checked, problems };
}

export async function runChecks(root = ROOT, out = process.stdout) {
  const syntax = await checkSyntax(root);
  const markdown = await checkMarkdown(root);
  const problems = [...syntax.problems, ...markdown.problems];
  out.write(`Syntax: ${syntax.files} modules checked, ${syntax.problems.length} problem(s)\n`);
  out.write(`Links: ${markdown.links} relative links in ${markdown.files} Markdown files checked, ${markdown.problems.length} problem(s)\n`);
  for (const problem of problems) out.write(`  ${problem}\n`);
  return problems.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runChecks();
}
