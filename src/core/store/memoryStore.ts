import fs from "node:fs";
import path from "node:path";
import type { CaseStore } from "./CaseStore";
import type {
  Appointment,
  CarePlanTask,
  Case,
  Communication,
  Fact,
  Patient,
  ResolvedMedication,
  StaffReview,
  UploadedDocument,
} from "@/core/types";
import { caseRef, reviewRef } from "@/core/ids";

interface Snapshot {
  patients: Record<string, Patient>;
  facts: Record<string, Fact>;
  cases: Record<string, Case>;
  documents: Record<string, UploadedDocument>;
  medications: Record<string, ResolvedMedication>;
  appointments: Record<string, Appointment>;
  careTasks: Record<string, CarePlanTask>;
  communications: Record<string, Communication>;
  reviews: Record<string, StaffReview>;
  counters: { case: number; review: number };
}

const empty = (): Snapshot => ({
  patients: {},
  facts: {},
  cases: {},
  documents: {},
  medications: {},
  appointments: {},
  careTasks: {},
  communications: {},
  reviews: {},
  counters: { case: 42, review: 0 },
});

/**
 * In-memory store that optionally persists to a JSON file. Used for local dev,
 * the eval harness, and tests. Firestore is the production backend.
 */
export class MemoryStore implements CaseStore {
  private s: Snapshot;
  private file?: string;

  constructor(file?: string) {
    this.file = file;
    this.s = empty();
    if (file && fs.existsSync(file)) {
      try {
        this.s = { ...empty(), ...(JSON.parse(fs.readFileSync(file, "utf8")) as Snapshot) };
      } catch {
        this.s = empty();
      }
    }
  }

  private flush() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.s, null, 2));
  }

  async getPatient(id: string) {
    return this.s.patients[id] ?? null;
  }
  async listPatients() {
    return Object.values(this.s.patients).sort((a, b) => a.name.localeCompare(b.name));
  }
  async putPatient(p: Patient) {
    this.s.patients[p.id] = p;
    this.flush();
  }

  async listFacts(patientId: string) {
    return Object.values(this.s.facts)
      .filter((f) => f.patientId === patientId)
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  }
  async putFact(f: Fact) {
    this.s.facts[f.id] = f;
    this.flush();
  }

  async nextCaseRef() {
    this.s.counters.case += 1;
    this.flush();
    return caseRef(this.s.counters.case);
  }
  async getCase(id: string) {
    return this.s.cases[id] ?? null;
  }
  async putCase(c: Case) {
    this.s.cases[c.id] = c;
    this.flush();
  }
  async listCases(filter?: { patientId?: string; status?: Case["status"][] }) {
    return Object.values(this.s.cases)
      .filter((c) => !filter?.patientId || c.patientId === filter.patientId)
      .filter((c) => !filter?.status || filter.status.includes(c.status))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getDocument(id: string) {
    return this.s.documents[id] ?? null;
  }
  async putDocument(d: UploadedDocument) {
    this.s.documents[d.id] = d;
    this.flush();
  }

  async getMedication(id: string) {
    return this.s.medications[id] ?? null;
  }
  async putMedication(m: ResolvedMedication) {
    this.s.medications[m.id] = m;
    this.flush();
  }

  async listAppointments(filter?: { patientId?: string; caseId?: string; from?: string; to?: string }) {
    return Object.values(this.s.appointments)
      .filter((a) => !filter?.patientId || a.patientId === filter.patientId)
      .filter((a) => !filter?.caseId || a.caseId === filter.caseId)
      .filter((a) => !filter?.from || a.end >= filter.from)
      .filter((a) => !filter?.to || a.start <= filter.to)
      .sort((a, b) => a.start.localeCompare(b.start));
  }
  async putAppointment(a: Appointment) {
    this.s.appointments[a.id] = a;
    this.flush();
  }
  async listCareTasks(patientId: string) {
    return Object.values(this.s.careTasks).filter((t) => t.patientId === patientId);
  }
  async putCareTask(t: CarePlanTask) {
    this.s.careTasks[t.id] = t;
    this.flush();
  }

  async listCommunications(filter: { patientId?: string; caseId?: string }) {
    return Object.values(this.s.communications)
      .filter((c) => !filter.patientId || c.patientId === filter.patientId)
      .filter((c) => !filter.caseId || c.caseId === filter.caseId)
      .sort((a, b) => a.at.localeCompare(b.at));
  }
  async putCommunication(c: Communication) {
    this.s.communications[c.id] = c;
    this.flush();
  }

  async nextReviewRef() {
    this.s.counters.review += 1;
    this.flush();
    return reviewRef(this.s.counters.review);
  }
  async getReview(id: string) {
    return this.s.reviews[id] ?? null;
  }
  async putReview(r: StaffReview) {
    this.s.reviews[r.id] = r;
    this.flush();
  }
  async listReviews(filter?: { status?: StaffReview["status"][]; caseId?: string }) {
    return Object.values(this.s.reviews)
      .filter((r) => !filter?.status || filter.status.includes(r.status))
      .filter((r) => !filter?.caseId || r.caseId === filter.caseId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async reset() {
    this.s = empty();
    this.flush();
  }
}
