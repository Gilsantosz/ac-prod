import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

async function withFileHandle(path, flags, operation) {
  const handle = await open(path, flags);
  try {
    return await operation(handle);
  } finally {
    await handle.close();
  }
}

async function writeFileDurably(path, content) {
  await withFileHandle(path, 'w', async (handle) => {
    await handle.writeFile(content, 'utf8');
    // O ACK só pode sair depois que o kernel confirmar o journal no disco.
    await handle.sync();
  });
}

async function appendFileDurably(path, content) {
  await withFileHandle(path, 'a', async (handle) => {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  });
}

async function syncDirectory(directory) {
  try {
    await withFileHandle(directory, 'r', (handle) => handle.sync());
  } catch (error) {
    // Windows não permite FlushFileBuffers em diretórios. O arquivo temporário
    // e o arquivo final já foram sincronizados individualmente nesse ambiente.
    const unsupportedOnWindows = process.platform === 'win32'
      && ['EACCES', 'EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM'].includes(error.code);
    if (!unsupportedOnWindows) throw error;
  }
}

async function syncExistingFile(path) {
  await withFileHandle(path, 'r+', (handle) => handle.sync());
}

function serialize(items) {
  const snapshot = items.map((item) => JSON.stringify(item)).join('\n');
  return snapshot ? `${snapshot}\n` : '';
}

function parseJournal(content, spoolFile) {
  const lines = content.split(/\r?\n/);
  const hasTerminatingNewline = content.length === 0 || content.endsWith('\n');
  const recovered = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;

    try {
      recovered.push(JSON.parse(line));
    } catch (cause) {
      const isIncompleteTail = !hasTerminatingNewline && index === lines.length - 1;
      if (isIncompleteTail) break;

      const error = new Error(
        `Journal JSONL inválido em ${spoolFile}, linha ${index + 1}: ${cause.message}`,
        { cause },
      );
      error.code = 'INVALID_JOURNAL_RECORD';
      throw error;
    }
  }

  const unique = new Map();
  for (const item of recovered) {
    if (item?.client_event_id) {
      unique.set(item.client_event_id, item);
    }
  }

  return {
    items: Array.from(unique.values()),
    needsRepair: content.length > 0 && !hasTerminatingNewline,
  };
}

/**
 * Array em memória com journal JSONL local.
 *
 * O journal permanece com o lote "em voo" até a confirmação do Supabase.
 * Se o processo reiniciar no meio do envio, os mesmos client_event_id serão
 * recuperados e a idempotência do banco impedirá baixa duplicada.
 */
export class DurableMemoryQueue {
  #items = [];
  #writeChain = Promise.resolve();
  #journalNeedsRepair = false;

  constructor(spoolFile) {
    this.spoolFile = resolve(spoolFile);
  }

  get size() {
    return this.#items.length;
  }

  snapshot() {
    return this.#items.map((item) => ({ ...item }));
  }

  #scheduleWrite(operation) {
    const scheduled = this.#writeChain
      .catch(() => undefined)
      .then(async () => {
        try {
          // appendFile pode falhar depois de escrever apenas parte da linha.
          // Antes de qualquer nova gravação, restaura o journal pelo estado
          // conhecido em memória para que a próxima linha não seja concatenada.
          if (this.#journalNeedsRepair) {
            await this.#replaceJournal(this.#items);
            this.#journalNeedsRepair = false;
          }
          return await operation();
        } catch (error) {
          this.#journalNeedsRepair = true;
          throw error;
        }
      });
    this.#writeChain = scheduled;
    return scheduled;
  }

  async #replaceJournal(items) {
    const temporary = `${this.spoolFile}.tmp`;
    await writeFileDurably(temporary, serialize(items));
    await rename(temporary, this.spoolFile);
    // Confirma o inode já no nome definitivo e persiste a troca de diretório.
    await syncExistingFile(this.spoolFile);
    await syncDirectory(dirname(this.spoolFile));
  }

  async init() {
    await mkdir(dirname(this.spoolFile), { recursive: true });

    try {
      const content = await readFile(this.spoolFile, 'utf8');
      const parsed = parseJournal(content, this.spoolFile);
      this.#items = parsed.items;

      // Uma queda pode interromper o último append antes do "\n". Reescrever
      // somente os registros completos impede a cauda de contaminar o próximo.
      if (parsed.needsRepair) {
        await this.#replaceJournal(this.#items);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await writeFileDurably(this.spoolFile, '');
      await syncDirectory(dirname(this.spoolFile));
    }

    return this.size;
  }

  async enqueue(item) {
    const line = `${JSON.stringify(item)}\n`;
    let queueSize;

    await this.#scheduleWrite(async () => {
      await appendFileDurably(this.spoolFile, line);
      // O endpoint só pode observar/confirmar uma leitura depois do journal.
      queueSize = this.#items.push(item);
    });

    return queueSize;
  }

  take(maxItems) {
    return this.#items.splice(0, maxItems);
  }

  prepend(items) {
    if (!items.length) return;
    this.#items.unshift(...items);
  }

  async commit() {
    await this.#scheduleWrite(() => this.#replaceJournal(this.#items));
  }
}
