import { getStore } from "@/core/store";
import { seedStore } from "@/data/seed";

let seeded: Promise<void> | null = null;

/**
 * Make sure the store has the synthetic clinic loaded. Idempotent; safe to call from
 * every API route. Never resets an already-populated store.
 */
export function ensureSeeded(): Promise<void> {
  if (!seeded) {
    seeded = (async () => {
      const store = getStore();
      const patients = await store.listPatients();
      if (patients.length === 0) await seedStore(store, { reset: false });
    })().catch((e) => {
      seeded = null;
      throw e;
    });
  }
  return seeded;
}

export function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
}

export function errorResponse(e: unknown, status = 500) {
  const message = e instanceof Error ? e.message : String(e);
  console.error("[api]", message);
  return json({ error: message }, { status });
}
