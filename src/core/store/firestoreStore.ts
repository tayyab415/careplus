import { Firestore, type Query, type DocumentData } from "@google-cloud/firestore";
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
import { env } from "@/config/env";
import { caseRef, reviewRef } from "@/core/ids";

/** Firestore (Native mode) backend. Database name comes from FIRESTORE_DATABASE. */
export class FirestoreStore implements CaseStore {
  private db: Firestore;

  constructor() {
    this.db = new Firestore({
      projectId: env.gcpProject,
      databaseId: env.firestoreDatabase,
      ...(env.gcpServiceAccountKey ? { keyFilename: env.gcpServiceAccountKey } : {}),
      ignoreUndefinedProperties: true,
    });
  }

  private col(name: string) {
    return this.db.collection(name);
  }

  private async getOne<T>(col: string, id: string): Promise<T | null> {
    const snap = await this.col(col).doc(id).get();
    return snap.exists ? (snap.data() as T) : null;
  }

  private async put(col: string, id: string, data: object) {
    await this.col(col).doc(id).set(JSON.parse(JSON.stringify(data)));
  }

  private async all<T>(q: Query<DocumentData>): Promise<T[]> {
    const snap = await q.get();
    return snap.docs.map((d) => d.data() as T);
  }

  private async nextCounter(name: string, start: number): Promise<number> {
    const ref = this.col("counters").doc(name);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const cur = snap.exists ? (snap.data()!.value as number) : start;
      const next = cur + 1;
      tx.set(ref, { value: next });
      return next;
    });
  }

  async getPatient(id: string) {
    return this.getOne<Patient>("patients", id);
  }
  async listPatients() {
    const ps = await this.all<Patient>(this.col("patients"));
    return ps.sort((a, b) => a.name.localeCompare(b.name));
  }
  async putPatient(p: Patient) {
    await this.put("patients", p.id, p);
  }

  async listFacts(patientId: string) {
    const fs = await this.all<Fact>(this.col("facts").where("patientId", "==", patientId));
    return fs.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  }
  async putFact(f: Fact) {
    await this.put("facts", f.id, f);
  }

  async nextCaseRef() {
    return caseRef(await this.nextCounter("case", 42));
  }
  async getCase(id: string) {
    return this.getOne<Case>("cases", id);
  }
  async putCase(c: Case) {
    await this.put("cases", c.id, c);
  }
  async listCases(filter?: { patientId?: string; status?: Case["status"][] }) {
    let q: Query<DocumentData> = this.col("cases");
    if (filter?.patientId) q = q.where("patientId", "==", filter.patientId);
    const cs = await this.all<Case>(q);
    return cs
      .filter((c) => !filter?.status || filter.status.includes(c.status))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getDocument(id: string) {
    return this.getOne<UploadedDocument>("documents", id);
  }
  async putDocument(d: UploadedDocument) {
    await this.put("documents", d.id, d);
  }

  async getMedication(id: string) {
    return this.getOne<ResolvedMedication>("medications", id);
  }
  async putMedication(m: ResolvedMedication) {
    await this.put("medications", m.id, m);
  }

  async listAppointments(filter?: { patientId?: string; caseId?: string; from?: string; to?: string }) {
    let q: Query<DocumentData> = this.col("appointments");
    if (filter?.patientId) q = q.where("patientId", "==", filter.patientId);
    else if (filter?.caseId) q = q.where("caseId", "==", filter.caseId);
    const as = await this.all<Appointment>(q);
    return as
      .filter((a) => !filter?.caseId || a.caseId === filter.caseId)
      .filter((a) => !filter?.from || a.end >= filter.from)
      .filter((a) => !filter?.to || a.start <= filter.to)
      .sort((a, b) => a.start.localeCompare(b.start));
  }
  async putAppointment(a: Appointment) {
    await this.put("appointments", a.id, a);
  }
  async listCareTasks(patientId: string) {
    return this.all<CarePlanTask>(this.col("careTasks").where("patientId", "==", patientId));
  }
  async putCareTask(t: CarePlanTask) {
    await this.put("careTasks", t.id, t);
  }

  async listCommunications(filter: { patientId?: string; caseId?: string }) {
    let q: Query<DocumentData> = this.col("communications");
    if (filter.caseId) q = q.where("caseId", "==", filter.caseId);
    else if (filter.patientId) q = q.where("patientId", "==", filter.patientId);
    const cs = await this.all<Communication>(q);
    return cs.sort((a, b) => a.at.localeCompare(b.at));
  }
  async putCommunication(c: Communication) {
    await this.put("communications", c.id, c);
  }

  async nextReviewRef() {
    return reviewRef(await this.nextCounter("review", 0));
  }
  async getReview(id: string) {
    return this.getOne<StaffReview>("reviews", id);
  }
  async putReview(r: StaffReview) {
    await this.put("reviews", r.id, r);
  }
  async listReviews(filter?: { status?: StaffReview["status"][]; caseId?: string }) {
    let q: Query<DocumentData> = this.col("reviews");
    if (filter?.caseId) q = q.where("caseId", "==", filter.caseId);
    const rs = await this.all<StaffReview>(q);
    return rs
      .filter((r) => !filter?.status || filter.status.includes(r.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async reset() {
    for (const name of ["patients", "facts", "cases", "documents", "medications", "appointments", "careTasks", "communications", "reviews", "counters"]) {
      const snap = await this.col(name).get();
      const batch = this.db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }
}
