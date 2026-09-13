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

/**
 * The canonical application database. Everything the agent knows, did, or was told
 * goes through here — including the provenance split (patient_reported vs
 * document_extracted vs database_verified vs model_predicted vs staff_confirmed).
 */
export interface CaseStore {
  // patients
  getPatient(id: string): Promise<Patient | null>;
  listPatients(): Promise<Patient[]>;
  putPatient(p: Patient): Promise<void>;

  // facts (longitudinal record)
  listFacts(patientId: string): Promise<Fact[]>;
  putFact(f: Fact): Promise<void>;

  // cases
  nextCaseRef(): Promise<string>;
  getCase(id: string): Promise<Case | null>;
  putCase(c: Case): Promise<void>;
  listCases(filter?: { patientId?: string; status?: Case["status"][] }): Promise<Case[]>;

  // documents
  getDocument(id: string): Promise<UploadedDocument | null>;
  putDocument(d: UploadedDocument): Promise<void>;

  // medications resolved
  getMedication(id: string): Promise<ResolvedMedication | null>;
  putMedication(m: ResolvedMedication): Promise<void>;

  // appointments & tasks
  listAppointments(filter?: { patientId?: string; caseId?: string; from?: string; to?: string }): Promise<Appointment[]>;
  putAppointment(a: Appointment): Promise<void>;
  listCareTasks(patientId: string): Promise<CarePlanTask[]>;
  putCareTask(t: CarePlanTask): Promise<void>;

  // communications
  listCommunications(filter: { patientId?: string; caseId?: string }): Promise<Communication[]>;
  putCommunication(c: Communication): Promise<void>;

  // staff reviews / exceptions
  nextReviewRef(): Promise<string>;
  getReview(id: string): Promise<StaffReview | null>;
  putReview(r: StaffReview): Promise<void>;
  listReviews(filter?: { status?: StaffReview["status"][]; caseId?: string }): Promise<StaffReview[]>;

  /** Danger: wipes everything. Used by seed scripts / tests. */
  reset(): Promise<void>;
}
