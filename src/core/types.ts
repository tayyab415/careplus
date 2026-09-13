import { z } from "zod";

/* -------------------------------------------------------------------------- */
/*  Provenance — every fact the system holds says where it came from.          */
/* -------------------------------------------------------------------------- */

export const Provenance = z.enum([
  "patient_reported", // said by the patient in conversation / intake
  "document_extracted", // pulled from an uploaded image or document by the vision model
  "database_verified", // matched against an authoritative source (RxNorm, PubChem, openFDA, clinic record)
  "model_predicted", // TxGemma or other model output. Research signal only.
  "staff_confirmed", // a clinician / staff member confirmed it
  "clinic_policy", // comes from clinic-authored rules or configuration
]);
export type Provenance = z.infer<typeof Provenance>;

export const FactKind = z.enum([
  "medication",
  "adverse_experience",
  "symptom",
  "allergy",
  "condition",
  "accessibility",
  "care_plan_instruction",
  "appointment_history",
  "contact_preference",
  "research_interest",
  "document",
  "note",
]);
export type FactKind = z.infer<typeof FactKind>;

export const Fact = z.object({
  id: z.string(),
  patientId: z.string(),
  caseId: z.string().optional(),
  kind: FactKind,
  statement: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
  provenance: Provenance,
  /** Human readable pointer: "Clinician note 2025-06-12", "Upload doc_ab12", "PubChem CID 4927" */
  source: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  recordedAt: z.string(),
  recordedBy: z.enum(["agent", "staff", "system", "patient"]),
  /** Facts can be superseded when the patient or staff corrects them. */
  supersededBy: z.string().optional(),
});
export type Fact = z.infer<typeof Fact>;

/* -------------------------------------------------------------------------- */
/*  Patients                                                                    */
/* -------------------------------------------------------------------------- */

export const Patient = z.object({
  id: z.string(), // PT-8821
  kind: z.enum(["existing", "prospective"]),
  name: z.string(),
  preferredName: z.string().optional(),
  dateOfBirth: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  preferredContact: z.enum(["sms", "email", "portal"]).default("sms"),
  preferredAppointmentMode: z.enum(["in_person", "video", "phone"]).optional(),
  accessibility: z.array(z.string()).default([]),
  languages: z.array(z.string()).default(["English"]),
  membership: z
    .object({ plan: z.string(), since: z.string(), status: z.enum(["active", "lapsed"]) })
    .optional(),
  primaryClinician: z.string().optional(),
  /** Free-text persona blurb shown on the demo persona picker. Never sent to the model. */
  demoBlurb: z.string().optional(),
  createdAt: z.string(),
});
export type Patient = z.infer<typeof Patient>;

/* -------------------------------------------------------------------------- */
/*  Medications, extraction, resolution                                        */
/* -------------------------------------------------------------------------- */

export const LabelExtraction = z.object({
  documentKind: z.enum(["pharmacy_label", "bottle", "blister_pack", "prescription", "discharge_summary", "other"]),
  productName: z.string().nullable(),
  activeIngredients: z.array(z.string()),
  strength: z.string().nullable(),
  dosageForm: z.string().nullable(),
  directions: z.string().nullable(),
  prescriptionDate: z.string().nullable(),
  prescriber: z.string().nullable(),
  pharmacy: z.string().nullable(),
  patientNameOnLabel: z.string().nullable(),
  ndc: z.string().nullable(),
  rawText: z.string(),
  /** 0-1. The agent must ask the patient to confirm before treating this as fact. */
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()),
});
export type LabelExtraction = z.infer<typeof LabelExtraction>;

export const PubChemRecord = z.object({
  cid: z.number(),
  canonicalSmiles: z.string(),
  molecularFormula: z.string().optional(),
  molecularWeight: z.number().optional(),
  iupacName: z.string().optional(),
  title: z.string().optional(),
});
export type PubChemRecord = z.infer<typeof PubChemRecord>;

export const OfficialLabel = z.object({
  source: z.literal("openFDA"),
  setId: z.string().optional(),
  effectiveTime: z.string().optional(),
  brandName: z.string().optional(),
  genericName: z.string().optional(),
  boxedWarning: z.string().optional(),
  warnings: z.string().optional(),
  contraindications: z.string().optional(),
  adverseReactions: z.string().optional(),
  drugInteractions: z.string().optional(),
  warningsAndCautions: z.string().optional(),
  indicationsAndUsage: z.string().optional(),
});
export type OfficialLabel = z.infer<typeof OfficialLabel>;

export const ResolvedMedication = z.object({
  id: z.string(),
  queryName: z.string(),
  rxcui: z.string().optional(),
  rxnormName: z.string().optional(),
  termType: z.string().optional(),
  ingredients: z.array(z.object({ name: z.string(), rxcui: z.string().optional() })),
  brandNames: z.array(z.string()),
  dosageForm: z.string().optional(),
  strength: z.string().optional(),
  /** One PubChem record per active ingredient (when resolvable). */
  molecules: z.array(z.object({ ingredient: z.string(), pubchem: PubChemRecord })),
  /** Official label per ingredient. */
  labels: z.array(z.object({ ingredient: z.string(), label: OfficialLabel })).default([]),
  /** Convenience: first label (kept for older call sites). */
  label: OfficialLabel.optional(),
  matchQuality: z.enum(["exact", "approximate", "unresolved"]),
  resolvedAt: z.string(),
});
export type ResolvedMedication = z.infer<typeof ResolvedMedication>;

export const TxGemmaSignal = z.object({
  task: z.string(),
  taskLabel: z.string(),
  ingredient: z.string(),
  smiles: z.string(),
  prompt: z.string(),
  rawOutput: z.string(),
  kind: z.enum(["classification", "regression"]),
  /** For classification tasks: which option the model chose and what it means. */
  choice: z.enum(["A", "B"]).optional(),
  meaning: z.string(),
  /** For regression tasks: normalised 0-1000 value as emitted by the model. */
  value: z.number().optional(),
  model: z.string(),
  latencyMs: z.number(),
  at: z.string(),
  /** Always present. This is a research signal, not clinical guidance. */
  disclaimer: z.string(),
});
export type TxGemmaSignal = z.infer<typeof TxGemmaSignal>;

/* -------------------------------------------------------------------------- */
/*  Appointments, care tasks, communications                                   */
/* -------------------------------------------------------------------------- */

export const AppointmentMode = z.enum(["in_person", "video", "phone"]);
export type AppointmentMode = z.infer<typeof AppointmentMode>;

export const Appointment = z.object({
  id: z.string(),
  patientId: z.string(),
  caseId: z.string(),
  appointmentTypeId: z.string(),
  title: z.string(),
  start: z.string(),
  end: z.string(),
  mode: AppointmentMode,
  location: z.string().optional(),
  clinician: z.string().optional(),
  status: z.enum(["held", "confirmed", "cancelled"]),
  /** IDs of appointments that must happen first (e.g. lab draw before follow-up). */
  dependsOn: z.array(z.string()).default([]),
  calendarEventId: z.string().optional(),
  calendarLink: z.string().optional(),
  notes: z.string().optional(),
  createdAt: z.string(),
});
export type Appointment = z.infer<typeof Appointment>;

export const CarePlanTask = z.object({
  id: z.string(),
  patientId: z.string(),
  caseId: z.string().optional(),
  description: z.string(),
  status: z.enum(["open", "scheduled", "done", "cancelled"]),
  dueBy: z.string().optional(),
  appointmentId: z.string().optional(),
  source: z.string(),
  createdAt: z.string(),
});
export type CarePlanTask = z.infer<typeof CarePlanTask>;

export const Communication = z.object({
  id: z.string(),
  patientId: z.string(),
  caseId: z.string(),
  channel: z.enum(["sms", "email", "portal"]),
  direction: z.enum(["outbound", "inbound"]),
  to: z.string().optional(),
  body: z.string(),
  status: z.enum(["sent", "simulated", "failed"]),
  providerId: z.string().optional(),
  at: z.string(),
});
export type Communication = z.infer<typeof Communication>;

export const UploadedDocument = z.object({
  id: z.string(),
  patientId: z.string(),
  caseId: z.string(),
  name: z.string(),
  mimeType: z.string(),
  /** gs:// URI when stored in GCS, otherwise a data: URL (dev) */
  uri: z.string(),
  sizeBytes: z.number().optional(),
  extraction: LabelExtraction.optional(),
  confirmedByPatient: z.boolean().default(false),
  uploadedAt: z.string(),
});
export type UploadedDocument = z.infer<typeof UploadedDocument>;

/* -------------------------------------------------------------------------- */
/*  Routing, staff reviews, decision trace                                     */
/* -------------------------------------------------------------------------- */

export const Tier = z.enum(["green", "amber", "red"]);
export type Tier = z.infer<typeof Tier>;

export const RoutingOutcome = z.enum([
  "complete_automatically", // A
  "ask_patient", // B
  "book_medication_review", // C
  "route_to_staff", // D
  "show_urgent_instructions", // E
]);
export type RoutingOutcome = z.infer<typeof RoutingOutcome>;

export const StaffAction = z.object({
  id: z.string(),
  label: z.string(),
  /** What happens when staff click it. */
  kind: z.enum(["confirm_appointment", "ask_patient", "assign", "reclassify", "dismiss", "custom"]),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type StaffAction = z.infer<typeof StaffAction>;

export const StaffReview = z.object({
  id: z.string(), // SR-...
  caseId: z.string(),
  patientId: z.string(),
  tier: z.enum(["amber", "red"]),
  title: z.string(),
  reason: z.string(),
  completed: z.array(z.string()),
  unresolved: z.array(z.string()),
  actions: z.array(StaffAction),
  status: z.enum(["open", "in_progress", "resolved", "dismissed"]),
  assignedTo: z.string().optional(),
  slackChannel: z.string().optional(),
  slackTs: z.string().optional(),
  createdAt: z.string(),
  resolvedAt: z.string().optional(),
  resolution: z.string().optional(),
});
export type StaffReview = z.infer<typeof StaffReview>;

export const TraceKind = z.enum([
  "observation",
  "tool_call",
  "tool_result",
  "policy",
  "routing",
  "action",
  "message",
  "staff",
  "error",
]);

export const TraceEntry = z.object({
  at: z.string(),
  kind: TraceKind,
  step: z.string(),
  summary: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type TraceEntry = z.infer<typeof TraceEntry>;

/* -------------------------------------------------------------------------- */
/*  Conversation                                                                */
/* -------------------------------------------------------------------------- */

export const Attachment = z.object({
  documentId: z.string(),
  name: z.string(),
  mimeType: z.string(),
  /** Browser-displayable URL (data URL or signed URL). */
  previewUrl: z.string().optional(),
});
export type Attachment = z.infer<typeof Attachment>;

export const Card = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("evidence_request"),
    prompt: z.string(),
    accepted: z.array(z.string()),
  }),
  z.object({
    type: z.literal("extraction_confirm"),
    documentId: z.string(),
    extraction: LabelExtraction,
  }),
  z.object({
    type: z.literal("medication"),
    medication: ResolvedMedication,
  }),
  z.object({
    type: z.literal("research_signal"),
    signals: z.array(TxGemmaSignal),
  }),
  z.object({
    type: z.literal("slot_options"),
    appointmentTypeId: z.string(),
    title: z.string(),
    slots: z.array(
      z.object({ start: z.string(), end: z.string(), mode: AppointmentMode, location: z.string().optional(), clinician: z.string().optional() }),
    ),
  }),
  z.object({
    type: z.literal("receipt"),
    reference: z.string(),
    items: z.array(z.string()),
  }),
  z.object({
    type: z.literal("urgent"),
    heading: z.string(),
    instructions: z.string(),
    callNumber: z.string(),
  }),
  z.object({
    type: z.literal("staff_question"),
    reviewId: z.string(),
    question: z.string(),
  }),
]);
export type Card = z.infer<typeof Card>;

export const ChatMessage = z.object({
  id: z.string(),
  role: z.enum(["patient", "agent", "staff", "system"]),
  text: z.string(),
  attachments: z.array(Attachment).default([]),
  cards: z.array(Card).default([]),
  at: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const CaseStatus = z.enum([
  "open",
  "awaiting_patient",
  "awaiting_staff",
  "completed",
  "urgent",
]);
export type CaseStatus = z.infer<typeof CaseStatus>;

export const Case = z.object({
  id: z.string(), // CP-1042
  patientId: z.string(),
  status: CaseStatus,
  tier: Tier.optional(),
  outcome: RoutingOutcome.optional(),
  intent: z.string().optional(),
  title: z.string().optional(),
  messages: z.array(ChatMessage),
  trace: z.array(TraceEntry),
  /** IDs of medications resolved during this case. */
  medicationIds: z.array(z.string()).default([]),
  txgemmaSignals: z.array(TxGemmaSignal).default([]),
  /** Questions staff pushed to the patient that have not been answered yet. */
  pendingStaffQuestions: z.array(z.object({ id: z.string(), question: z.string(), askedBy: z.string(), at: z.string(), reviewId: z.string() })).default([]),
  researchPrescreen: z
    .object({ consented: z.boolean(), topic: z.string().optional(), notes: z.string().optional(), status: z.enum(["pending_coordinator", "not_applicable", "declined"]) })
    .optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Case = z.infer<typeof Case>;

/* -------------------------------------------------------------------------- */
/*  Agent turn result                                                          */
/* -------------------------------------------------------------------------- */

export interface TurnResult {
  caseId: string;
  message: ChatMessage;
  case: Case;
  /** New outbound communications produced this turn (drives the virtual phone). */
  communications: Communication[];
  reviews: StaffReview[];
  appointments: Appointment[];
}
