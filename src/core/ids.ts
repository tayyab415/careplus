import { randomUUID } from "node:crypto";

export const nowIso = () => new Date().toISOString();

export function shortId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

/** Case references look like CP-1042 — memorable for staff and patients. */
export function caseRef(seq: number): string {
  return `CP-${1000 + seq}`;
}

export function reviewRef(seq: number): string {
  return `SR-${100 + seq}`;
}
