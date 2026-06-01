// Fila offline de registros de produção (persistida em localStorage)
const KEY = 'prodview_offline_queue';

export function getQueue() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || [];
  } catch {
    return [];
  }
}

function saveQueue(q) {
  localStorage.setItem(KEY, JSON.stringify(q));
  window.dispatchEvent(new Event('offline-queue-changed'));
}

export function enqueue(entry) {
  const q = getQueue();
  q.push({ ...entry, _tempId: `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}` });
  saveQueue(q);
}

export function clearItem(tempId) {
  saveQueue(getQueue().filter((e) => e._tempId !== tempId));
}

// Tenta sincronizar todos os itens pendentes. createFn recebe o registro e persiste.
export async function flushQueue(createFn) {
  const q = getQueue();
  if (!q.length) return { synced: 0, remaining: 0 };
  let synced = 0;
  for (const item of q) {
    const { _tempId, ...data } = item;
    try {
      await createFn(data);
      clearItem(_tempId);
      synced += 1;
    } catch {
      break; // para na primeira falha (provável perda de conexão)
    }
  }
  return { synced, remaining: getQueue().length };
}