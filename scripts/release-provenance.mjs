#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  PROVENANCE_FILENAME,
  releaseCandidatePolicy,
} from './release-candidate-policy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HEX_SHA256 = /^[0-9a-f]{64}$/;
const GIT_COMMIT = /^[0-9a-f]{40}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const WORKFLOW = /^[A-Za-z0-9][A-Za-z0-9._-]*\.ya?ml$/;
const POSITIVE_INTEGER = /^[1-9]\d*$/;

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

export async function readPinnedRegularFile(path, encoding = undefined) {
  const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | noFollow);
  } catch (error) {
    if (error?.code === 'ELOOP') {
      throw new Error(
        `Release input ${basename(path)} must be one regular, non-symlink file.`,
        { cause: error },
      );
    }
    throw error;
  }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1) {
      throw new Error(
        `Release input ${basename(path)} must be one regular, non-symlink file.`,
      );
    }
    const contents = encoding === undefined
      ? await handle.readFile()
      : await handle.readFile({ encoding });
    const [after, selected] = await Promise.all([handle.stat(), lstat(path)]);
    if (
      selected.isSymbolicLink()
      || !selected.isFile()
      || selected.nlink !== 1
      || !sameIdentity(before, after)
      || !sameIdentity(after, selected)
      || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs
      || before.ctimeMs !== after.ctimeMs
    ) {
      throw new Error(`Release input changed while it was being read: ${basename(path)}`);
    }
    return contents;
  } finally {
    await handle.close();
  }
}

async function sha256File(path) {
  return createHash('sha256').update(await readPinnedRegularFile(path)).digest('hex');
}

function requireInvocation(value) {
  const values = {
    repository: value.repository,
    commit: value.commit,
    workflow: value.workflow,
    runId: String(value.runId ?? ''),
    runAttempt: String(value.runAttempt ?? ''),
  };
  if (!REPOSITORY.test(values.repository ?? '')) {
    throw new Error(`Invalid provenance repository: ${String(values.repository)}`);
  }
  if (!GIT_COMMIT.test(values.commit ?? '')) {
    throw new Error(`Invalid provenance commit: ${String(values.commit)}`);
  }
  if (!WORKFLOW.test(values.workflow ?? '')) {
    throw new Error(`Invalid provenance workflow: ${String(values.workflow)}`);
  }
  if (!POSITIVE_INTEGER.test(values.runId) || !POSITIVE_INTEGER.test(values.runAttempt)) {
    throw new Error('Provenance run id and attempt must be positive integers.');
  }
  return values;
}

function expectedStatement(policy, invocation, subjects) {
  const workflowUri = `https://github.com/${invocation.repository}/.github/workflows/`
    + `${invocation.workflow}@${invocation.commit}`;
  const runUri = `https://github.com/${invocation.repository}/actions/runs/${invocation.runId}`
    + `/attempts/${invocation.runAttempt}`;
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: subjects,
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildDefinition: {
        buildType: workflowUri,
        externalParameters: {
          flavor: policy.flavor,
          tag: policy.tag,
          workflow: invocation.workflow,
        },
        internalParameters: {
          node: '24',
        },
        resolvedDependencies: [{
          uri: `git+https://github.com/${invocation.repository}.git@refs/tags/${policy.tag}`,
          digest: { gitCommit: invocation.commit },
        }],
      },
      runDetails: {
        builder: { id: runUri },
        metadata: { invocationId: runUri },
      },
    },
  };
}

async function subjectsFor(directory, names) {
  return Promise.all([...names].sort().map(async (name) => ({
    name,
    digest: { sha256: await sha256File(resolve(directory, name)) },
  })));
}

async function readProvenanceStatement(path) {
  const source = await readPinnedRegularFile(path, 'utf8');
  if (!source.endsWith('\n') || source.slice(0, -1).includes('\n')) {
    throw new Error('Release provenance must contain exactly one JSONL statement.');
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new Error('Release provenance is not valid JSON.');
  }
}

function inferredInvocation(statement) {
  const definition = statement?.predicate?.buildDefinition;
  const runDetails = statement?.predicate?.runDetails;
  const dependency = definition?.resolvedDependencies?.[0];
  const invocationId = runDetails?.metadata?.invocationId;
  const runMatch = typeof invocationId === 'string'
    ? /\/actions\/runs\/(\d+)\/attempts\/(\d+)$/.exec(invocationId)
    : undefined;
  const repositoryMatch = typeof dependency?.uri === 'string'
    ? /^git\+https:\/\/github\.com\/([^@]+)\.git@refs\/tags\//.exec(dependency.uri)
    : undefined;
  return {
    repository: repositoryMatch?.[1],
    commit: dependency?.digest?.gitCommit,
    workflow: definition?.externalParameters?.workflow,
    runId: runMatch?.[1],
    runAttempt: runMatch?.[2],
  };
}

function verifySubjectDigests(statement) {
  for (const subject of statement.subject) {
    if (!HEX_SHA256.test(subject.digest.sha256)) {
      throw new Error(`Invalid provenance digest for ${String(subject.name)}.`);
    }
  }
}

export async function createReleaseProvenance(
  directory,
  packageJson,
  tag,
  flavor,
  invocationInput,
) {
  const policy = releaseCandidatePolicy(packageJson, tag, flavor);
  const invocation = requireInvocation(invocationInput);
  const statement = expectedStatement(
    policy,
    invocation,
    await subjectsFor(directory, policy.binaryPayloads),
  );
  const path = resolve(directory, PROVENANCE_FILENAME);
  await writeFile(path, `${JSON.stringify(statement)}\n`, { flag: 'wx', mode: 0o644 });
  return { path, statement };
}

export async function verifyReleaseProvenance(
  directory,
  packageJson,
  tag,
  flavor,
  expectedInvocation = undefined,
) {
  const policy = releaseCandidatePolicy(packageJson, tag, flavor);
  const path = resolve(directory, PROVENANCE_FILENAME);
  const statement = await readProvenanceStatement(path);
  const invocation = requireInvocation({ ...inferredInvocation(statement), ...expectedInvocation });
  const expected = expectedStatement(
    policy,
    invocation,
    await subjectsFor(directory, policy.binaryPayloads),
  );
  if (JSON.stringify(statement) !== JSON.stringify(expected)) {
    throw new Error('Release provenance does not exactly match its subjects and invocation.');
  }
  verifySubjectDigests(statement);
  return statement;
}

function usageError() {
  process.stderr.write(
    'Usage: node scripts/release-provenance.mjs <create|verify> <directory> <tag> '
    + '<private|public> <owner/repository> <commit> <workflow.yml> <run-id> <attempt>\n',
  );
  process.exit(2);
}

function requireCliValue(value) {
  if (!value) usageError();
  return value;
}

function parseCliInvocation(args) {
  const [command, directory, tag, flavor, repository, commit, workflow, runId, runAttempt, ...extra]
    = args;
  if (!['create', 'verify'].includes(command) || extra.length > 0) usageError();
  return {
    command,
    directory: requireCliValue(directory),
    tag: requireCliValue(tag),
    flavor: requireCliValue(flavor),
    invocation: {
      repository: requireCliValue(repository),
      commit: requireCliValue(commit),
      workflow: requireCliValue(workflow),
      runId: requireCliValue(runId),
      runAttempt: requireCliValue(runAttempt),
    },
  };
}

async function cli() {
  const { command, directory, flavor, invocation, tag } = parseCliInvocation(process.argv.slice(2));
  const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  if (command === 'create') {
    await createReleaseProvenance(directory, packageJson, tag, flavor, invocation);
    process.stdout.write(`Release provenance created: ${PROVENANCE_FILENAME}\n`);
  } else {
    await verifyReleaseProvenance(directory, packageJson, tag, flavor, invocation);
    process.stdout.write(`Release provenance verified: ${PROVENANCE_FILENAME}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await cli();
}
