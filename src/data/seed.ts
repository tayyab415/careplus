import type { CaseStore } from "@/core/store/CaseStore";
import { careTasks, facts, pastAppointments, patients } from "./patients";

/** Load the synthetic clinic population into a store. Idempotent. */
export async function seedStore(store: CaseStore, opts: { reset?: boolean } = {}) {
  if (opts.reset) await store.reset();
  for (const p of patients) await store.putPatient(p);
  for (const f of facts) await store.putFact(f);
  for (const t of careTasks) await store.putCareTask(t);
  for (const a of pastAppointments) await store.putAppointment(a);
  return { patients: patients.length, facts: facts.length, careTasks: careTasks.length, appointments: pastAppointments.length };
}
