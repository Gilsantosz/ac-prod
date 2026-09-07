import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// A disposable PostgreSQL instance, reachable only through its private Unix socket.
// There is deliberately no database URL, remote host, linked-project or reset option.
export function isolatedEnvironment(source = process.env) {
  return Object.fromEntries(Object.entries(source).filter(([key]) =>
    !/^PG/i.test(key) && !/^(SUPABASE|DATABASE_URL|DB_URL)/i.test(key)));
}

export function inspectReplayInput(filename, sql) {
  if (!filename.endsWith('.sql')) throw new Error('Replay input must be a reviewed .sql file.');
  if (/^[ \t]*\\/m.test(sql)) throw new Error('psql meta-commands are forbidden in replay input.');
  if (/\buozuzdfvnufsjsonswag\b/i.test(sql)) throw new Error('Production project reference is forbidden in replay input.');
  if (/\bCOPY\b[\s\S]*?\bPROGRAM\b/i.test(sql)) throw new Error('COPY PROGRAM is forbidden in replay input.');
  if (/\b(?:dblink_connect|dblink_exec|http_post|http_get|http_request)\s*\(/i.test(sql)) {
    throw new Error('External connection or HTTP execution requires a separate environment-neutral baseline.');
  }
  return { filename: basename(filename), sha256: createHash('sha256').update(sql).digest('hex') };
}

export function replay({ pgBin, files, expectedFailures = {} }) {
  if (!pgBin || !files.length) throw new Error('Usage: --pg-bin /absolute/bin --file reviewed.sql [--file next.sql]');
  const bin = realpathSync(resolve(pgBin));
  const inputs = files.map((file) => {
    const path = realpathSync(resolve(file));
    const sql = readFileSync(path, 'utf8');
    return { path, sql, ...inspectReplayInput(path, sql) };
  });
  const env = isolatedEnvironment();
  const run = (name, args, options = {}) => spawnSync(join(bin, name), args, {
    env, encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024, ...options,
  });
  const version = run('postgres', ['--version']);
  if (version.status !== 0 || !/PostgreSQL\) 17\./.test(version.stdout)) {
    throw new Error('A PostgreSQL 17 binary is required.');
  }
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'acprod-pg17-replay-')));
  const data = join(directory, 'data');
  const artifact = join(directory, 'replay-result.json');
  const result = {
    schema_version: 1, environment: 'disposable-local-unix-socket',
    postgres_version: version.stdout.trim(), started_at: new Date().toISOString(),
    inputs: inputs.map(({ filename, sha256 }) => ({ filename, sha256 })),
    steps: [], decision: 'NO-GO', cluster_stopped: false,
    limitation: 'SQL replay only; this does not validate Supabase services, production data, capacity or rollout.',
  };
  let started = false;
  try {
    const init = run('initdb', ['--pgdata', data, '--username', 'postgres', '--auth-local', 'trust', '--auth-host', 'reject', '--encoding', 'UTF8', '--no-locale']);
    if (init.status !== 0) throw new Error('Local initdb failed.');
    const start = run('pg_ctl', ['--pgdata', data, '--log', join(directory, 'postgres.log'),
      '--options', `-c listen_addresses='' -c unix_socket_directories='${directory.replaceAll("'", "''")}' -c unix_socket_permissions=0700 -c max_connections=10`,
      '--wait', 'start']);
    if (start.status !== 0) throw new Error('Local PostgreSQL start failed.');
    started = true;
    const psqlArgs = ['--no-psqlrc', '--host', directory, '--username', 'postgres', '--dbname', 'postgres', '--set', 'ON_ERROR_STOP=1', '--set', 'VERBOSITY=sqlstate'];
    for (const [index, input] of inputs.entries()) {
      const startedAt = performance.now();
      const applied = run('psql', [...psqlArgs, '--single-transaction'], {
        input: `SET statement_timeout = '60s';\nSET lock_timeout = '2s';\n${input.sql}`,
      });
      const sqlstate = applied.stderr?.match(/(?:ERROR|FATAL):\s+([0-9A-Z]{5})\b/)?.[1] ?? null;
      const expected = expectedFailures[index] ?? null;
      const passed = expected ? applied.status !== 0 && sqlstate === expected : applied.status === 0;
      result.steps.push({ filename: input.filename, sha256: input.sha256,
        duration_ms: Math.round(performance.now() - startedAt), exit_code: applied.status,
        sqlstate, expected_failure_sqlstate: expected, passed });
      if (!passed) throw new Error(`Local replay failed at ${input.filename}; see sanitized artifact.`);
    }
    result.decision = 'REPLAY_PASS_ONLY';
  } catch (error) {
    result.failure = error.message;
  } finally {
    if (started) {
      const stopped = run('pg_ctl', ['--pgdata', data, '--mode', 'fast', '--wait', 'stop']);
      result.cluster_stopped = stopped.status === 0;
      if (!result.cluster_stopped) result.decision = 'NO-GO';
    }
    result.finished_at = new Date().toISOString();
    writeFileSync(artifact, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  }
  return { ...result, artifact, directory };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const options = { files: [] };
    for (let i = 0; i < args.length; i += 2) {
      if (args[i] === '--pg-bin' && args[i + 1]) options.pgBin = args[i + 1];
      else if (args[i] === '--file' && args[i + 1]) options.files.push(args[i + 1]);
      else throw new Error('Unknown or incomplete replay option.');
    }
    const result = replay(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.decision === 'REPLAY_PASS_ONLY' ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
