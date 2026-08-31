import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

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

  constructor(spoolFile) {
    this.spoolFile = resolve(spoolFile);
  }

  get size() {
    return this.#items.length;
  }

  snapshot() {
    return this.#items.map((item) => ({ ...item }));
  }

  async init() {
    await mkdir(dirname(this.spoolFile), { recursive: true });

    try {
      const content = await readFile(this.spoolFile, 'utf8');
      const recovered = content
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      const unique = new Map();
      for (const item of recovered) {
        if (item?.client_event_id) {
          unique.set(item.client_event_id, item);
        }
      }
      this.#items = Array.from(unique.values());
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await writeFile(this.spoolFile, '', 'utf8');
    }

    return this.size;
  }

  async enqueue(item) {
    this.#items.push(item);
    const line = `${JSON.stringify(item)}\n`;
    this.#writeChain = this.#writeChain.then(() => (
      appendFile(this.spoolFile, line, 'utf8')
    ));
    await this.#writeChain;
    return this.size;
  }

  take(maxItems) {
    return this.#items.splice(0, maxItems);
  }

  prepend(items) {
    if (!items.length) return;
    this.#items.unshift(...items);
  }

  async commit() {
    const snapshot = this.#items.map((item) => JSON.stringify(item)).join('\n');
    const body = snapshot ? `${snapshot}\n` : '';
    const temporary = `${this.spoolFile}.tmp`;

    this.#writeChain = this.#writeChain.then(async () => {
      await writeFile(temporary, body, 'utf8');
      await rename(temporary, this.spoolFile);
    });
    await this.#writeChain;
  }
}
