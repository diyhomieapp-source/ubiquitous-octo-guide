// Lightweight offline write queue (Blueprint 33).
// Queues local writes in AsyncStorage while offline and flushes them to the sync engine
// with idempotency keys when connectivity returns. The server is the source of truth.
import { storage } from "@/src/utils/storage";
import { api } from "@/src/api";

const QUEUE_KEY = "diyhomie_sync_queue";

export type QueuedOp = {
  local_id: string;
  entity_type: string;
  entity_id?: string | null;
  operation_type: string;
  payload?: any;
  idempotency_key: string;
  base_version?: string | null;
  created_at: string;
};

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readQueue(): Promise<QueuedOp[]> {
  const raw = await storage.getItem<string>(QUEUE_KEY, "");
  if (!raw) return [];
  try { return JSON.parse(raw) as QueuedOp[]; } catch { return []; }
}

async function writeQueue(q: QueuedOp[]): Promise<void> {
  await storage.setItem(QUEUE_KEY, JSON.stringify(q));
}

export async function enqueue(op: Omit<QueuedOp, "local_id" | "idempotency_key" | "created_at"> & { idempotency_key?: string }): Promise<QueuedOp> {
  const q = await readQueue();
  const rec: QueuedOp = {
    local_id: uid(),
    idempotency_key: op.idempotency_key || uid(),
    created_at: new Date().toISOString(),
    ...op,
  };
  q.push(rec);
  await writeQueue(q);
  return rec;
}

export async function queueCount(): Promise<number> {
  return (await readQueue()).length;
}

export async function getQueue(): Promise<QueuedOp[]> {
  return readQueue();
}

// Push all queued ops. Removes any that the server accepted, deduped, or permanently failed.
export async function flush(): Promise<{ pushed: number; conflicts: number; remaining: number }> {
  const q = await readQueue();
  if (q.length === 0) return { pushed: 0, conflicts: 0, remaining: 0 };
  const res = await api<any>("/hi/sync/push", { method: "POST", body: { records: q } });
  const byLocal: Record<string, any> = {};
  for (const r of res.results || []) byLocal[r.local_id] = r;
  const keep = q.filter((rec) => {
    const r = byLocal[rec.local_id];
    if (!r) return true; // no result → keep for retry
    return r.sync_status === "retrying"; // keep only retryables; synced/conflict/failed are terminal client-side
  });
  await writeQueue(keep);
  const conflicts = (res.results || []).filter((r: any) => r.sync_status === "conflict").length;
  const pushed = (res.results || []).filter((r: any) => r.sync_status === "synced").length;
  return { pushed, conflicts, remaining: keep.length };
}

export async function clearQueue(): Promise<void> {
  await writeQueue([]);
}
