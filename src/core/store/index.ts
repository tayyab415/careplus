import { env } from "@/config/env";
import type { CaseStore } from "./CaseStore";
import { MemoryStore } from "./memoryStore";
import { FirestoreStore } from "./firestoreStore";

let instance: CaseStore | null = null;

export function getStore(): CaseStore {
  if (instance) return instance;
  if (env.storeBackend === "firestore") {
    instance = new FirestoreStore();
  } else {
    instance = new MemoryStore(env.memoryStorePath);
  }
  return instance;
}

/** Test helper: swap in a specific store (e.g. a fresh MemoryStore with no file). */
export function setStore(s: CaseStore) {
  instance = s;
}

export type { CaseStore } from "./CaseStore";
export { MemoryStore } from "./memoryStore";
