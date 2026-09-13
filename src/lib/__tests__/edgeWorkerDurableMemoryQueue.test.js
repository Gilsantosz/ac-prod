import { afterEach, describe, expect, it } from 'vitest';
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableMemoryQueue } from '../../../edge-worker/src/durableMemoryQueue.mjs';

const temporaryDirectories = [];

function event(id, tag = '09950001') {
  return {
    client_event_id: id,
    tag_lida: tag,
    timestamp_leitura: '2026-09-13T12:00:00.000Z',
  };
}

async function createSpool() {
  const directory = await mkdtemp(join(tmpdir(), 'acprod-edge-journal-'));
  temporaryDirectories.push(directory);
  return {
    directory,
    spoolFile: join(directory, 'collection-spool.jsonl'),
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('DurableMemoryQueue', () => {
  it('sincroniza append, arquivo final e diretório antes de confirmar o ACK', async () => {
    const source = await readFile(
      join(process.cwd(), 'edge-worker/src/durableMemoryQueue.mjs'),
      'utf8',
    );

    expect(source).toMatch(/async function appendFileDurably[\s\S]*await handle\.sync\(\)/);
    expect(source).toMatch(/async function writeFileDurably[\s\S]*await handle\.sync\(\)/);
    expect(source).toMatch(
      /await appendFileDurably\(this\.spoolFile, line\);[\s\S]*this\.#items\.push\(item\)/,
    );
    expect(source).toMatch(
      /await rename\(temporary, this\.spoolFile\);[\s\S]*await syncExistingFile\(this\.spoolFile\);[\s\S]*await syncDirectory\(dirname\(this\.spoolFile\)\)/,
    );
  });

  it('recupera os registros completos e remove uma cauda JSON truncada', async () => {
    const { spoolFile } = await createSpool();
    const first = event('event-1', '09950001');
    const second = event('event-2', '09950002');
    await writeFile(
      spoolFile,
      `${JSON.stringify(first)}\n${JSON.stringify(second)}\n{"client_event_id":"event-3"`,
      'utf8',
    );

    const queue = new DurableMemoryQueue(spoolFile);
    await expect(queue.init()).resolves.toBe(2);
    expect(queue.snapshot()).toEqual([first, second]);
    expect(await readFile(spoolFile, 'utf8')).toBe(
      `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`,
    );

    const third = event('event-3', '09950003');
    await queue.enqueue(third);

    const restarted = new DurableMemoryQueue(spoolFile);
    await expect(restarted.init()).resolves.toBe(3);
    expect(restarted.snapshot()).toEqual([first, second, third]);
  });

  it('normaliza uma última linha JSON válida sem quebra antes de anexar', async () => {
    const { spoolFile } = await createSpool();
    const first = event('event-1');
    const second = event('event-2');
    await writeFile(spoolFile, JSON.stringify(first), 'utf8');

    const queue = new DurableMemoryQueue(spoolFile);
    await queue.init();
    await queue.enqueue(second);

    const restarted = new DurableMemoryQueue(spoolFile);
    await expect(restarted.init()).resolves.toBe(2);
    expect(restarted.snapshot()).toEqual([first, second]);
  });

  it('não ignora corrupção no meio do journal', async () => {
    const { spoolFile } = await createSpool();
    await writeFile(
      spoolFile,
      `${JSON.stringify(event('event-1'))}\n{inválido}\n${JSON.stringify(event('event-2'))}\n`,
      'utf8',
    );

    const queue = new DurableMemoryQueue(spoolFile);
    await expect(queue.init()).rejects.toThrow(/linha 2/i);
  });

  it('retoma a escrita depois de uma falha transitória sem aceitar o evento que não persistiu', async () => {
    const { directory, spoolFile } = await createSpool();
    const backupFile = join(directory, 'spool.backup');
    const queue = new DurableMemoryQueue(spoolFile);
    await queue.init();

    await rename(spoolFile, backupFile);
    await mkdir(spoolFile);
    await expect(queue.enqueue(event('event-failed'))).rejects.toMatchObject({
      code: expect.stringMatching(/EISDIR|EACCES|EPERM/),
    });
    expect(queue.size).toBe(0);

    await rm(spoolFile, { recursive: true });
    await rename(backupFile, spoolFile);
    // Simula um append que escreveu parte do JSON antes de devolver erro.
    await writeFile(spoolFile, '{"client_event_id":"torn-write"', { flag: 'a' });
    const accepted = event('event-accepted');
    await expect(queue.enqueue(accepted)).resolves.toBe(1);

    const restarted = new DurableMemoryQueue(spoolFile);
    await expect(restarted.init()).resolves.toBe(1);
    expect(restarted.snapshot()).toEqual([accepted]);
  });

  it('preserva o lote para reenvio, compacta após confirmação e recupera após reinício', async () => {
    const { spoolFile } = await createSpool();
    const events = [event('event-1'), event('event-2'), event('event-3')];
    const queue = new DurableMemoryQueue(spoolFile);
    await queue.init();
    for (const item of events) await queue.enqueue(item);

    const failedBatch = queue.take(2);
    queue.prepend(failedBatch);

    const afterFailedSend = new DurableMemoryQueue(spoolFile);
    await expect(afterFailedSend.init()).resolves.toBe(3);
    expect(afterFailedSend.snapshot()).toEqual(events);

    const confirmedBatch = queue.take(2);
    expect(confirmedBatch).toEqual(events.slice(0, 2));
    await queue.commit();

    const afterConfirmedSend = new DurableMemoryQueue(spoolFile);
    await expect(afterConfirmedSend.init()).resolves.toBe(1);
    expect(afterConfirmedSend.snapshot()).toEqual([events[2]]);
  });

  it('retoma a compactação depois de uma falha transitória', async () => {
    const { spoolFile } = await createSpool();
    const queue = new DurableMemoryQueue(spoolFile);
    await queue.init();
    const first = event('event-1');
    const second = event('event-2');
    await queue.enqueue(first);
    await queue.enqueue(second);

    const confirmed = queue.take(1);
    await mkdir(`${spoolFile}.tmp`);
    await expect(queue.commit()).rejects.toMatchObject({
      code: expect.stringMatching(/EISDIR|EACCES|EPERM/),
    });
    queue.prepend(confirmed);

    await rm(`${spoolFile}.tmp`, { recursive: true });
    await expect(queue.commit()).resolves.toBeUndefined();

    const restarted = new DurableMemoryQueue(spoolFile);
    await expect(restarted.init()).resolves.toBe(2);
    expect(restarted.snapshot()).toEqual([first, second]);
  });
});
