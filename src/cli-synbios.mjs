// `exofab synbios ...` subcommands: optional Synbios hand-off helpers.
// The caller passes the arguments after `synbios`, for example
// synbiosCommand(['inspect', 'export.json'], {stdout, stderr, env}).

import { readFile, stat } from 'node:fs/promises';
import { inspectExport, MAX_EXPORT_BYTES, SynbiosError, taskFromCharter } from './adapters/synbios.mjs';
import { safe } from './display.mjs';

const USAGE = `Usage:
  exofab synbios task --project KOINOS_PROJECT --agreement AGREEMENT_ID --terms-digest SHA256
                      --title TEXT --description TEXT --criteria TEXT... --scope TEXT...
                      [--synbios-project SYNBIOS_PROJECT_ID] [--priority low|normal|high]
      Print the Synbios task.create body for an agreed charter. Without
      --synbios-project, add project_id before sending it.
  exofab synbios inspect EXPORT.json
      Summarize a Synbios task export. Exit status 1 if it fails the
      export's internal consistency checks.
`;

class UsageError extends Error {}

// Option values are taken verbatim; a value that starts with "--" must be
// written as --name=value. Multi-value options take every following
// argument up to the next option, and may also be repeated.
function parseOptions(argv, { single, multi }) {
  const options = Object.fromEntries(multi.map((name) => [name, []]));
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith('--')) throw new UsageError('unexpected argument');
    const equals = arg.indexOf('=');
    const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
    const inline = equals === -1 ? undefined : arg.slice(equals + 1);
    const nextIsValue = () => index + 1 < argv.length && !argv[index + 1].startsWith('--');
    if (multi.includes(name)) {
      if (inline !== undefined) {
        options[name].push(inline);
        continue;
      }
      if (!nextIsValue()) throw new UsageError(`--${name} needs at least one value`);
      while (nextIsValue()) options[name].push(argv[++index]);
    } else if (single.includes(name)) {
      if (options[name] !== undefined) throw new UsageError(`--${name} was given more than once`);
      if (inline !== undefined) options[name] = inline;
      else if (nextIsValue()) options[name] = argv[++index];
      else throw new UsageError(`--${name} needs a value`);
    } else {
      throw new UsageError('unknown option');
    }
  }
  return options;
}

// Export text is untrusted. JSON.stringify already escapes C0 controls; safe()
// also escapes C1 controls and bidirectional or line-separator characters so
// the output cannot drive or reorder a terminal display. The result is still
// JSON. Error messages can quote export text too, so they pass through safe().
function displayJson(value) {
  return `${safe(JSON.stringify(value, null, 2))}\n`;
}

function taskCommand(argv, stdout) {
  const options = parseOptions(argv, {
    single: ['project', 'agreement', 'terms-digest', 'title', 'description', 'synbios-project', 'priority'],
    multi: ['criteria', 'scope'],
  });
  for (const name of ['project', 'agreement', 'terms-digest', 'title', 'description']) {
    if (options[name] === undefined) throw new UsageError(`--${name} is required`);
  }
  for (const name of ['criteria', 'scope']) {
    if (options[name].length === 0) throw new UsageError(`--${name} is required`);
  }
  const charter = {
    title: options.title,
    description: options.description,
    criteria: options.criteria,
    scope: options.scope,
    koinos: { project: options.project, agreement: options.agreement, termsDigest: options['terms-digest'] },
  };
  if (options['synbios-project'] !== undefined) charter.synbiosProject = options['synbios-project'];
  if (options.priority !== undefined) charter.priority = options.priority;
  stdout.write(displayJson(taskFromCharter(charter)));
  return 0;
}

async function inspectCommand(argv, stdout) {
  if (argv.length !== 1 || argv[0].startsWith('--')) throw new UsageError('inspect takes exactly one export file');
  let bytes;
  try {
    const info = await stat(argv[0]);
    if (!info.isFile()) throw new SynbiosError('export path is not a regular file');
    if (info.size > MAX_EXPORT_BYTES) throw new SynbiosError(`export file is larger than ${MAX_EXPORT_BYTES} bytes`);
    bytes = await readFile(argv[0]);
  } catch (error) {
    if (error instanceof SynbiosError) throw error;
    throw new SynbiosError(`cannot read export file (${error.code ?? 'error'})`);
  }
  const summary = inspectExport(bytes);
  stdout.write(displayJson(summary));
  return summary.integrity.valid ? 0 : 1;
}

// Returns the process exit code: 0 success, 1 failure, 2 usage error.
export async function synbiosCommand(argv, { stdout = process.stdout, stderr = process.stderr } = {}) {
  const [subcommand, ...rest] = argv;
  try {
    if (subcommand === 'task') return taskCommand(rest, stdout);
    if (subcommand === 'inspect') return await inspectCommand(rest, stdout);
    if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
      stdout.write(USAGE);
      return 0;
    }
    throw new UsageError(subcommand === undefined ? 'missing subcommand' : 'unknown subcommand');
  } catch (error) {
    if (error instanceof UsageError) {
      stderr.write(`exofab synbios: ${safe(error.message)}\n${USAGE}`);
      return 2;
    }
    if (error instanceof SynbiosError) {
      stderr.write(`exofab synbios: ${safe(error.message)}\n`);
      return 1;
    }
    throw error;
  }
}
