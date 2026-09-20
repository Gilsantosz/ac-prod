#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  assertIsolatedCollectionTarget,
  COLLECTION_LOAD_CODE_SEGMENTS,
  COLLECTION_LOAD_PROFILE_REQUIREMENTS,
  validateCollectionCodeWindow,
  validateCollectionIdentities,
} from '../../tests/load/collection-load-preflight.js';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} e obrigatorio para gerar o plano.`);
  return value;
}

function integer(name, { minimum = 0 } = {}) {
  const value = Number(required(name));
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} deve ser um inteiro maior ou igual a ${minimum}.`);
  }
  return value;
}

function decodeClaims(token) {
  try {
    return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function distribution(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  const sizes = [...counts.values()];
  return {
    distinct: counts.size,
    minimum_devices: sizes.length ? Math.min(...sizes) : 0,
    maximum_devices: sizes.length ? Math.max(...sizes) : 0,
  };
}

async function main() {
  const profile = required('K6_PROFILE').toLowerCase();
  const runId = required('K6_RUN_ID');
  const sequenceBase = integer('K6_SEQUENCE_BASE', { minimum: 1 });
  const codeOffset = integer('K6_CODE_OFFSET');
  const fixturePath = required('K6_FIXTURES');
  const supabaseUrl = required('SUPABASE_URL').replace(/\/$/, '');

  assertIsolatedCollectionTarget(
    supabaseUrl,
    required('K6_TARGET'),
    required('K6_CONFIRM_WRITES'),
  );
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(runId)) {
    throw new Error('K6_RUN_ID deve ter de 1 a 32 caracteres seguros.');
  }

  const rawFixture = await readFile(fixturePath);
  const fixture = JSON.parse(rawFixture.toString('utf8'));
  const requirement = COLLECTION_LOAD_PROFILE_REQUIREMENTS[profile];
  if (!requirement) throw new Error(`K6_PROFILE desconhecido: ${profile}.`);
  const identities = validateCollectionIdentities(fixture, requirement, decodeClaims);
  const codeWindow = validateCollectionCodeWindow(fixture, profile, codeOffset);
  const activeDevices = fixture.devices.slice(0, requirement.devices);

  const plan = {
    mode: 'offline_plan_only',
    remote_requests_sent: 0,
    target: 'capacity-test-isolated',
    profile,
    run_id: runId,
    sequence_base: sequenceBase,
    code_window: {
      offset: codeWindow.codeOffset,
      count: codeWindow.codes,
      end_exclusive: codeWindow.codeOffset + codeWindow.codes,
    },
    fixture_sha256: createHash('sha256').update(rawFixture).digest('hex'),
    identities,
    distribution: {
      cells: distribution(activeDevices.map((device) => device.cell_id)),
      posts: distribution(activeDevices.map((device) => device.machine_id)),
    },
    workload_segments: COLLECTION_LOAD_CODE_SEGMENTS[profile],
    ingress_rpc: 'ingest_collection_batch_immediate_v3',
    maximum_events_per_request: 5,
    execute_next: false,
  };
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Plano recusado: ${error.message}\n`);
  process.exitCode = 1;
});
