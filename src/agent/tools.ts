import type { Appointment, Card, Case, Communication, Fact, Patient, StaffReview, TraceEntry } from "@/core/types";
import type { CaseContext } from "./context";
import { getStore } from "@/core/store";
import { nowIso, shortId } from "@/core/ids";
import { resolveMedication } from "@/specialists/medication/resolver";
import { runTxGemma, TxGemmaUnavailable } from "@/specialists/txgemma/client";
import { TASKS } from "@/specialists/txgemma/tasks";
import { evaluateRouting, type RoutingDecision } from "@/core/policy/policyEngine";
import { bookAppointment, cancelAppointment, findSlots, type Slot } from "@/actions/scheduler";
import { sendPatientMessage } from "@/actions/messaging";
import { createStaffReview, genericReviewActions, medicationReviewActions } from "@/actions/staffReview";
import { postThreadReply, updateReviewInSlack } from "@/actions/slack";
import { clinic, getAppointmentType } from "@/data/clinic";
import { formatLocal } from "@/core/time";

/* -------------------------------------------------------------------------- */
/*  Turn state shared between the coordinator loop and tool handlers            */
/* -------------------------------------------------------------------------- */

export class TurnState {
  cards: Card[] = [];
  communications: Communication[] = [];
  reviews: StaffReview[] = [];
  appointments: Appointment[] = [];
  routing: RoutingDecision | null = null;
  redFlagRuleId: string | null = null;
  constructor(
    public c: Case,
    public ctx: CaseContext,
  ) {}

  trace(kind: TraceEntry["kind"], step: string, summary: string, data?: Record<string, unknown>) {
    this.c.trace.push({ at: nowIso(), kind, step, summary, data });
  }

  get patient(): Patient | null {
    return this.ctx.patient;
  }

  requirePatient(): Patient {
    if (!this.ctx.patient) throw new Error("No patient record yet. Use record_intake first for prospective patients.");
    return this.ctx.patient;
  }
}

/* -------------------------------------------------------------------------- */
/*  Tool definitions (OpenAI Responses API function tools)                      */
/* -------------------------------------------------------------------------- */

type Schema = Record<string, unknown>;
const str = (description: string): Schema => ({ type: "string", description });
const bool = (description: string): Schema => ({ type: "boolean", description });
const arr = (items: Schema, description: string): Schema => ({ type: "array", items, description });
const obj = (properties: Record<string, Schema>, required: string[], description?: string): Schema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
  ...(description ? { description } : {}),
});

export const toolDefinitions = [
  {
    name: "record_fact",
    description: "Record something the patient said (patient_reported) or that a confirmed document shows (document_extracted) into the patient's record with provenance. Use for medications, symptoms/adverse experiences, accessibility needs, contact preferences, care-plan instructions the GP gave.",
    parameters: obj(
      {
        kind: { type: "string", enum: ["medication", "adverse_experience", "symptom", "allergy", "condition", "accessibility", "care_plan_instruction", "contact_preference", "research_interest", "note"] },
        statement: str("One clear sentence, in the clinic's voice, e.g. 'Patient reports dizziness after a cough syrup in June 2025.'"),
        provenance: { type: "string", enum: ["patient_reported", "document_extracted"] },
        source: str("Where it came from: 'Patient message in CP-1042' or 'Upload doc_x (confirmed by patient)'."),
      },
      ["kind", "statement", "provenance", "source"],
    ),
  },
  {
    name: "request_evidence",
    description: "Ask the patient to upload physical evidence (photo of bottle, pharmacy label, prescription slip, discharge summary). Shows an upload card. Use when a medicine or event cannot be confirmed from the record.",
    parameters: obj({ prompt: str("The question to show above the upload control."), accepted: arr({ type: "string" }, "Kinds accepted, e.g. ['bottle','pharmacy label','prescription','discharge summary']") }, ["prompt", "accepted"]),
  },
  {
    name: "confirm_extraction",
    description: "Show the patient what was read from an uploaded document and ask them to confirm or correct it. Must be called before relying on an extraction.",
    parameters: obj({ documentId: str("The document id from context.") }, ["documentId"]),
  },
  {
    name: "mark_extraction_confirmed",
    description: "Call after the patient confirms (or corrects) an extraction. Records the medication as document_extracted with confirmation, applying any corrections the patient gave.",
    parameters: obj(
      {
        documentId: str("Document id."),
        correctedProductName: { type: ["string", "null"], description: "If the patient corrected the product name; else null." },
        correctedIngredients: { type: ["array", "null"], items: { type: "string" }, description: "If corrected; else null." },
      },
      ["documentId", "correctedProductName", "correctedIngredients"],
    ),
  },
  {
    name: "resolve_medication",
    description: "Resolve a medicine name (from a confirmed label or a clear patient statement) to RxNorm identity, PubChem molecule (SMILES) and the official openFDA label. Returns match quality, ingredients, brand names and label excerpts. Database-verified provenance.",
    parameters: obj(
      {
        name: str("Product or generic name as written."),
        ingredients: { type: ["array", "null"], items: { type: "string" }, description: "Active ingredients if known; else null." },
        strength: { type: ["string", "null"], description: "Strength if known; else null." },
        dosageForm: { type: ["string", "null"], description: "Form if known (tablet, oral solution); else null." },
        role: { type: "string", enum: ["prior_adverse", "newly_recommended", "current", "other"], description: "What this medicine is in the story." },
      },
      ["name", "ingredients", "strength", "dosageForm", "role"],
    ),
  },
  {
    name: "run_txgemma",
    description: `Run Google TxGemma (therapeutics foundation model on Vertex AI) on a resolved medicine's molecule to get bounded research signals from Therapeutics Data Commons tasks. Only call after resolve_medication returned a molecule with SMILES, and only when there is a patient-reported experience or clinician-relevant question to contextualise. Available tasks: ${TASKS.map((t) => t.id).join(", ")}. Output is a research signal for staff, never a clinical conclusion.`,
    parameters: obj(
      {
        medicationId: str("Id of the resolved medication (med_...)."),
        reportedThemes: str("What the patient reported, IN ENGLISH, a few words, e.g. 'dizziness after a cough syrup', 'itchy rash after antibiotic' — used to select relevant tasks (dizziness/drowsiness→BBB, rash/itch→skin, palpitations/fainting→hERG, interaction→CYP)."),
        taskIds: { type: ["array", "null"], items: { type: "string" }, description: "Explicit task ids to run instead of automatic selection; else null." },
      },
      ["medicationId", "reportedThemes", "taskIds"],
    ),
  },
  {
    name: "evaluate_routing",
    description: "Ask the clinic's deterministic policy engine for the routing tier (green/amber/red), the outcome, the appointment type it wants, and whether you may book or must hold. Call this before booking anything and whenever the picture changes. Answer the flags honestly from the evidence.",
    parameters: obj(
      {
        priorAdverseExperience: bool("Patient reports a past adverse experience relevant to the medicine at hand."),
        adverseMedicineRelated: bool("The medicine at hand is the same as / shares an ingredient with the one from the adverse experience."),
        startingNewMedicine: bool("A new medicine is being started or considered."),
        recordConflict: bool("A statement or document conflicts with the clinic record."),
        clinicalQuestion: bool("The patient asked something only a clinician can answer (dosing, causation, stop/switch, is it safe)."),
        postDischarge: bool("Request involves follow-up after a hospital discharge."),
        researchUnresolved: bool("A research screening criterion cannot be answered from the record."),
        unconfirmedExtraction: bool("You are relying on a document extraction the patient has not confirmed."),
        reportedSymptom: { type: ["string", "null"], description: "The symptom the patient reported historically (e.g. 'dizziness'), else null." },
        requestedAppointmentTypeId: { type: ["string", "null"], description: "Appointment type you intend to book, else null." },
      },
      ["priorAdverseExperience", "adverseMedicineRelated", "startingNewMedicine", "recordConflict", "clinicalQuestion", "postDischarge", "researchUnresolved", "unconfirmedExtraction", "reportedSymptom", "requestedAppointmentTypeId"],
    ),
  },
  {
    name: "find_slots",
    description: "Find available appointment slots honouring rosters, existing bookings, calendar busy time, accessibility (wheelchair → accessible locations only) and interpreter notice. For dependent appointments pass notBefore (e.g. 72h after a pathology draw).",
    parameters: obj(
      {
        appointmentTypeId: str("Appointment type id."),
        mode: { type: ["string", "null"], enum: ["in_person", "video", "phone", null], description: "Preferred mode or null for any." },
        notBefore: { type: ["string", "null"], description: "ISO datetime; earliest acceptable start. Null = soonest." },
        requireWheelchair: bool("Only wheelchair-accessible locations."),
        requireInterpreter: bool("An interpreter will attend (longer slot, 48h notice)."),
        preferredClinicianId: { type: ["string", "null"], description: "Staff id to prefer (e.g. the patient's usual GP) or null." },
        limit: { type: "integer", description: "How many slots to return (2-6)." },
      },
      ["appointmentTypeId", "mode", "notBefore", "requireWheelchair", "requireInterpreter", "preferredClinicianId", "limit"],
    ),
  },
  {
    name: "offer_slots",
    description: "Show the patient 2–3 slot options to choose from (from a find_slots result).",
    parameters: obj(
      {
        appointmentTypeId: str("Appointment type id."),
        slots: arr(obj({ start: str("ISO"), end: str("ISO"), mode: { type: "string", enum: ["in_person", "video", "phone"] }, location: { type: ["string", "null"] }, clinicianId: str("staff id"), clinician: str("staff name") }, ["start", "end", "mode", "location", "clinicianId", "clinician"]), "Slots to offer"),
      },
      ["appointmentTypeId", "slots"],
    ),
  },
  {
    name: "book_appointment",
    description: "Book (or hold) an appointment in a slot returned by find_slots. Requires evaluate_routing to have been called in this case. Booking status follows the routing engine's bookingAuthority: 'book' → confirmed, 'hold' → held for staff confirmation.",
    parameters: obj(
      {
        appointmentTypeId: str("Appointment type id."),
        slot: obj({ start: str("ISO"), end: str("ISO"), mode: { type: "string", enum: ["in_person", "video", "phone"] }, location: { type: ["string", "null"] }, clinicianId: str("staff id"), clinician: str("staff name") }, ["start", "end", "mode", "location", "clinicianId", "clinician"]),
        dependsOnAppointmentIds: arr({ type: "string" }, "Appointment ids that must occur first (may be empty)."),
        careTaskId: { type: ["string", "null"], description: "Care task this appointment fulfils, else null." },
        notes: { type: ["string", "null"], description: "Short administrative note for the calendar (no clinical detail), else null." },
      },
      ["appointmentTypeId", "slot", "dependsOnAppointmentIds", "careTaskId", "notes"],
    ),
  },
  {
    name: "create_care_tasks",
    description: "Record care-plan tasks from the GP's instructions the patient relays (e.g. 'physio, bloods, return in 4 weeks'). Skip tasks that already exist in context.",
    parameters: obj({ tasks: arr(obj({ description: str("Task"), dueBy: { type: ["string", "null"], description: "YYYY-MM-DD or null" } }, ["description", "dueBy"]), "Tasks"), source: str("e.g. 'Patient relaying Dr Whitaker's instructions, CP-1043'") }, ["tasks", "source"]),
  },
  {
    name: "send_patient_message",
    description: "Send the patient an SMS/email/portal message. Confirmations, follow-up links, reminders. NO medicine names, symptoms or clinical detail — references, times and the portal link only.",
    parameters: obj({ body: str("Message text."), channel: { type: ["string", "null"], enum: ["sms", "email", "portal", null], description: "Channel or null for the patient's preference." } }, ["body", "channel"]),
  },
  {
    name: "create_staff_review",
    description: "Create a staff exception (posted to the clinic's Slack triage channel and staff console). Use for amber outcomes after preparation is done, or when a request needs a clinician's judgement. Be precise: reason, what you completed, what remains unresolved.",
    parameters: obj(
      {
        title: str("Short title, e.g. 'Medication review required'."),
        reason: str("Why staff need to look. Cite provenance (record vs patient vs label vs TxGemma)."),
        completed: arr({ type: "string" }, "What the agent already did."),
        unresolved: arr({ type: "string" }, "What only staff can decide."),
        actionSet: { type: "string", enum: ["medication_review", "generic"] },
        appointmentId: { type: ["string", "null"], description: "Held appointment id, if any." },
      },
      ["title", "reason", "completed", "unresolved", "actionSet", "appointmentId"],
    ),
  },
  {
    name: "start_research_prescreen",
    description: "With the patient's consent, record their screening answers for a recruiting study and queue the case for the research coordinator. You do not decide eligibility.",
    parameters: obj({ studyId: str("Study id."), consented: bool("Patient agreed to be contacted by the coordinator."), answers: arr(obj({ question: str("q"), answer: str("a") }, ["question", "answer"]), "Screening Q&A"), notes: { type: ["string", "null"] } }, ["studyId", "consented", "answers", "notes"]),
  },
  {
    name: "record_intake",
    description: "Create or update a provisional record for a prospective patient from self-reported details. Call once the essentials are known (name, DOB or approximate age, phone, reason).",
    parameters: obj(
      {
        name: str("Full name"),
        dateOfBirth: { type: ["string", "null"], description: "YYYY-MM-DD or null" },
        phone: { type: ["string", "null"] },
        email: { type: ["string", "null"] },
        reason: str("Reason for contacting the clinic, in the patient's words."),
        accessibility: arr({ type: "string" }, "Accessibility or language needs (may be empty)."),
        languages: arr({ type: "string" }, "Languages (may be empty → English)."),
        preferredContact: { type: "string", enum: ["sms", "email", "portal"] },
      },
      ["name", "dateOfBirth", "phone", "email", "reason", "accessibility", "languages", "preferredContact"],
    ),
  },
  {
    name: "answer_staff_question",
    description: "Relay the patient's answer to a pending staff question back to staff (Slack thread + review), and clear it.",
    parameters: obj({ questionId: str("Pending question id from context."), answerSummary: str("The patient's answer, verbatim or lightly cleaned.") }, ["questionId", "answerSummary"]),
  },
  {
    name: "show_receipt",
    description: "Show the patient a completion receipt with the case reference and what was done. Call when the workflow for this request is complete (or complete pending staff confirmation).",
    parameters: obj({ items: arr({ type: "string" }, "Completed items, e.g. 'Video medication-review appointment reserved for Tue 2:30 pm'") }, ["items"]),
  },
] as const;

export type ToolName = (typeof toolDefinitions)[number]["name"];

/* -------------------------------------------------------------------------- */
/*  Handlers                                                                    */
/* -------------------------------------------------------------------------- */

type Args = Record<string, unknown>;

async function putFact(t: TurnState, f: Omit<Fact, "id" | "recordedAt" | "recordedBy">): Promise<Fact> {
  const fact: Fact = { ...f, id: shortId("f"), recordedAt: nowIso(), recordedBy: "agent" };
  await getStore().putFact(fact);
  t.ctx.facts.push(fact);
  return fact;
}

export async function executeTool(name: string, args: Args, t: TurnState): Promise<unknown> {
  const store = getStore();
  switch (name as ToolName) {
    case "record_fact": {
      const p = t.requirePatient();
      const f = await putFact(t, {
        patientId: p.id,
        caseId: t.c.id,
        kind: args.kind as Fact["kind"],
        statement: String(args.statement),
        provenance: args.provenance as Fact["provenance"],
        source: String(args.source),
      });
      t.trace("action", "record_fact", `${f.kind}: ${f.statement} [${f.provenance}]`);
      return { ok: true, factId: f.id };
    }

    case "request_evidence": {
      t.cards.push({ type: "evidence_request", prompt: String(args.prompt), accepted: (args.accepted as string[]) ?? [] });
      t.c.status = "awaiting_patient";
      t.trace("message", "request_evidence", String(args.prompt));
      return { ok: true };
    }

    case "confirm_extraction": {
      const doc = await store.getDocument(String(args.documentId));
      if (!doc?.extraction) return { error: "No extraction for that document." };
      t.cards.push({ type: "extraction_confirm", documentId: doc.id, extraction: doc.extraction });
      t.c.status = "awaiting_patient";
      t.trace("message", "confirm_extraction", `Asked patient to confirm extraction of ${doc.id} (confidence ${Math.round(doc.extraction.confidence * 100)}%)`);
      return { ok: true, extraction: doc.extraction };
    }

    case "mark_extraction_confirmed": {
      const doc = await store.getDocument(String(args.documentId));
      if (!doc?.extraction) return { error: "No extraction for that document." };
      const p = t.requirePatient();
      if (args.correctedProductName) doc.extraction.productName = String(args.correctedProductName);
      if (Array.isArray(args.correctedIngredients) && args.correctedIngredients.length) doc.extraction.activeIngredients = args.correctedIngredients as string[];
      doc.confirmedByPatient = true;
      await store.putDocument(doc);
      const e = doc.extraction;
      await putFact(t, {
        patientId: p.id,
        caseId: t.c.id,
        kind: "medication",
        statement: `${e.productName ?? e.activeIngredients.join(" / ")}${e.strength ? ` ${e.strength}` : ""}${e.dosageForm ? ` (${e.dosageForm})` : ""}${e.prescriptionDate ? `, dispensed ${e.prescriptionDate}` : ""} — from uploaded ${e.documentKind.replace("_", " ")}, confirmed by patient.`,
        data: { productName: e.productName, ingredients: e.activeIngredients, strength: e.strength, form: e.dosageForm, date: e.prescriptionDate },
        provenance: "document_extracted",
        source: `Upload ${doc.id} (confirmed by patient)`,
        confidence: e.confidence,
      });
      t.trace("observation", "extraction_confirmed", `Patient confirmed ${doc.id}: ${e.productName ?? "?"} [${e.activeIngredients.join("; ")}]`);
      return { ok: true, productName: e.productName, ingredients: e.activeIngredients, strength: e.strength, dosageForm: e.dosageForm };
    }

    case "resolve_medication": {
      t.trace("tool_call", "resolve_medication", `Resolving "${args.name}"`);
      const med = await resolveMedication({
        name: String(args.name),
        ingredients: (args.ingredients as string[] | null) ?? undefined,
        strength: (args.strength as string | null) ?? undefined,
        dosageForm: (args.dosageForm as string | null) ?? undefined,
      });
      await store.putMedication(med);
      t.c.medicationIds.push(med.id);
      t.ctx.medications.push(med);
      t.cards.push({ type: "medication", medication: med });
      const summary = `${med.queryName} → ${med.rxnormName ?? "unresolved"} [${med.matchQuality}]; ingredients ${med.ingredients.map((i) => i.name).join(", ") || "—"}; molecules ${med.molecules.map((m) => `${m.ingredient} CID ${m.pubchem.cid}`).join(", ") || "—"}; label ${med.label ? "found" : "not found"}`;
      t.trace("tool_result", "resolve_medication", summary, { medicationId: med.id, role: args.role });
      const snip = (s?: string, n = 700) => (s ? s.slice(0, n) + (s.length > n ? "…" : "") : null);
      return {
        medicationId: med.id,
        matchQuality: med.matchQuality,
        rxnormName: med.rxnormName,
        rxcui: med.rxcui,
        ingredients: med.ingredients.map((i) => i.name),
        brandNames: med.brandNames,
        dosageForm: med.dosageForm,
        molecules: med.molecules.map((m) => ({ ingredient: m.ingredient, cid: m.pubchem.cid, smiles: m.pubchem.canonicalSmiles, formula: m.pubchem.molecularFormula })),
        officialLabels: med.labels.map(({ ingredient, label: l }) => ({
          ingredient,
          source: "openFDA",
          generic: l.genericName,
          brand: l.brandName,
          boxedWarning: snip(l.boxedWarning, 400),
          warnings: snip(l.warnings ?? l.warningsAndCautions, 600),
          adverseReactions: snip(l.adverseReactions, 700),
          drugInteractions: snip(l.drugInteractions, 500),
          contraindications: snip(l.contraindications, 300),
        })),
      };
    }

    case "run_txgemma": {
      const med = t.ctx.medications.find((m) => m.id === args.medicationId) ?? (await store.getMedication(String(args.medicationId)));
      if (!med) return { error: "Unknown medicationId." };
      if (!med.molecules.length) return { error: "No molecule (SMILES) resolved for this medicine; TxGemma needs a SMILES string." };
      const themes = String(args.reportedThemes ?? "");
      const taskIds = (args.taskIds as string[] | null) ?? undefined;
      const all = [];
      t.trace("tool_call", "run_txgemma", `TxGemma on ${med.molecules.map((m) => m.ingredient).join(", ")} for themes "${themes}"`);
      try {
        for (const mol of med.molecules.slice(0, 2)) {
          const signals = await runTxGemma({ ingredient: mol.ingredient, smiles: mol.pubchem.canonicalSmiles, reportedThemes: themes, taskIds, maxTasks: 4 });
          all.push(...signals);
        }
      } catch (e) {
        if (e instanceof TxGemmaUnavailable) {
          t.trace("error", "run_txgemma", `TxGemma unavailable: ${e.message}`);
          return { error: `TxGemma endpoint unavailable (${e.message}). Continue without a research signal and say so in the staff review.` };
        }
        throw e;
      }
      t.c.txgemmaSignals.push(...all);
      if (all.length) t.cards.push({ type: "research_signal", signals: all });
      t.trace("tool_result", "run_txgemma", all.map((s) => `${s.ingredient}·${s.task}=${s.rawOutput} → ${s.meaning}`).join(" | "), { count: all.length });
      return {
        signals: all.map((s) => ({ ingredient: s.ingredient, task: s.task, taskLabel: s.taskLabel, output: s.rawOutput, meaning: s.meaning })),
        disclaimer: all[0]?.disclaimer,
      };
    }

    case "evaluate_routing": {
      const p = t.patient;
      const currentMeds = t.ctx.facts
        .filter((f) => f.kind === "medication" && (f.data?.status === "current" || /current/i.test(f.statement)))
        .map((f) => String(f.data?.name ?? f.statement.split(" ")[0]).toLowerCase());
      const decision = evaluateRouting({
        redFlagRuleId: t.redFlagRuleId,
        priorAdverseExperience: Boolean(args.priorAdverseExperience),
        adverseMedicineRelated: Boolean(args.adverseMedicineRelated),
        medications: t.ctx.medications,
        currentMedicineNames: currentMeds,
        startingNewMedicine: Boolean(args.startingNewMedicine),
        recordConflict: Boolean(args.recordConflict),
        clinicalQuestion: Boolean(args.clinicalQuestion),
        postDischarge: Boolean(args.postDischarge),
        researchUnresolved: Boolean(args.researchUnresolved),
        unconfirmedExtraction: Boolean(args.unconfirmedExtraction),
        txgemmaSignals: t.c.txgemmaSignals,
        reportedSymptom: (args.reportedSymptom as string | null) ?? undefined,
        requestedAppointmentTypeId: (args.requestedAppointmentTypeId as string | null) ?? undefined,
      });
      t.routing = decision;
      t.c.tier = decision.tier;
      t.c.outcome = decision.outcome;
      t.trace("routing", "evaluate_routing", `${decision.tier.toUpperCase()} → ${decision.outcome}; booking authority: ${decision.bookingAuthority}${decision.appointmentTypeId ? ` (${decision.appointmentTypeId})` : ""}`, { reasons: decision.reasons, input: args, patient: p?.id });
      return decision;
    }

    case "find_slots": {
      const p = t.patient ?? undefined;
      const slots = await findSlots({
        appointmentTypeId: String(args.appointmentTypeId),
        mode: (args.mode as Slot["mode"] | null) ?? undefined,
        notBefore: (args.notBefore as string | null) ?? undefined,
        patient: p,
        requireWheelchair: Boolean(args.requireWheelchair),
        requireInterpreter: Boolean(args.requireInterpreter),
        preferredClinicianId: (args.preferredClinicianId as string | null) ?? undefined,
        limit: Math.min(6, Math.max(2, Number(args.limit ?? 4))),
      });
      t.trace("tool_result", "find_slots", `${slots.length} slots for ${args.appointmentTypeId}`, { first: slots[0]?.start });
      return { slots: slots.map((s) => ({ ...s, label: formatLocal(s.start) })) };
    }

    case "offer_slots": {
      const type = getAppointmentType(String(args.appointmentTypeId));
      const slots = (args.slots as Slot[]).map((s) => ({ start: s.start, end: s.end, mode: s.mode, location: s.location ?? undefined, clinician: s.clinician }));
      t.cards.push({ type: "slot_options", appointmentTypeId: String(args.appointmentTypeId), title: type?.title ?? String(args.appointmentTypeId), slots });
      t.c.status = "awaiting_patient";
      t.trace("message", "offer_slots", `Offered ${slots.length} ${type?.title} slots`);
      return { ok: true };
    }

    case "book_appointment": {
      const p = t.requirePatient();
      if (!t.routing && !t.c.tier) return { error: "Call evaluate_routing before booking." };
      const authority = t.routing?.bookingAuthority ?? (t.c.tier === "green" ? "book" : t.c.tier === "amber" ? "hold" : "none");
      if (authority === "none") return { error: "Routing engine does not permit booking in this situation. Route to staff instead." };
      const typeId = String(args.appointmentTypeId);
      const type = getAppointmentType(typeId);
      if (!type) return { error: `Unknown appointment type ${typeId}` };
      // Type-level autonomy also applies (medication_review is hold-only regardless).
      const status: "held" | "confirmed" = authority === "hold" || type.autonomy === "hold" ? "held" : "confirmed";
      const slot = args.slot as Slot;
      // One live appointment per type per case: a second booking of the same type is a
      // reschedule, not an addition. Cancel the previous hold/booking first.
      const priorSameType = (await store.listAppointments({ caseId: t.c.id })).filter((a) => a.appointmentTypeId === typeId && (a.status === "held" || a.status === "confirmed"));
      let replaced: string | undefined;
      for (const prior of priorSameType) {
        if (prior.start === slot.start) {
          return { ok: true, appointmentId: prior.id, status: prior.status, start: prior.start, end: prior.end, label: formatLocal(prior.start), clinician: prior.clinician, mode: prior.mode, location: prior.location, note: "This appointment already exists for the case; nothing new was booked." };
        }
        await cancelAppointment(prior.id);
        replaced = prior.id;
        t.trace("action", "book_appointment", `Cancelled earlier ${type.title} ${formatLocal(prior.start)} (rescheduling)`, { appointmentId: prior.id });
      }
      const appt = await bookAppointment({
        patient: p,
        caseId: t.c.id,
        appointmentTypeId: typeId,
        slot: { ...slot, location: slot.location ?? undefined },
        status,
        dependsOn: (args.dependsOnAppointmentIds as string[]) ?? [],
        notes: (args.notes as string | null) ?? undefined,
      });
      t.appointments.push(appt);
      t.ctx.appointments.push(appt);
      if (args.careTaskId) {
        const task = t.ctx.careTasks.find((x) => x.id === args.careTaskId);
        if (task) {
          task.status = "scheduled";
          task.appointmentId = appt.id;
          await store.putCareTask(task);
        }
      }
      if (status === "held") t.c.status = "awaiting_staff";
      t.trace("action", "book_appointment", `${status.toUpperCase()} ${type.title} ${formatLocal(appt.start)} with ${slot.clinician}${appt.calendarEventId ? " (calendar event created)" : " (calendar not live)"}`, { appointmentId: appt.id });
      return { ok: true, appointmentId: appt.id, status, start: appt.start, end: appt.end, label: formatLocal(appt.start), clinician: slot.clinician, mode: appt.mode, location: appt.location, calendarLink: appt.calendarLink ?? null, ...(replaced ? { replacedAppointmentId: replaced, note: "The earlier appointment of this type was cancelled and replaced." } : {}) };
    }

    case "create_care_tasks": {
      const p = t.requirePatient();
      const created = [];
      for (const task of args.tasks as { description: string; dueBy: string | null }[]) {
        const ct = { id: shortId("ct"), patientId: p.id, caseId: t.c.id, description: task.description, status: "open" as const, dueBy: task.dueBy ?? undefined, source: String(args.source), createdAt: nowIso() };
        await store.putCareTask(ct);
        t.ctx.careTasks.push(ct);
        created.push({ id: ct.id, description: ct.description });
      }
      t.trace("action", "create_care_tasks", created.map((c) => c.description).join("; "));
      return { ok: true, tasks: created };
    }

    case "send_patient_message": {
      const p = t.requirePatient();
      // The model must not invent links: strip any URL and append the real portal link.
      const portal = `${process.env.PUBLIC_BASE_URL || "http://localhost:3000"}/portal/${p.id}?case=${t.c.id}`;
      const body = String(args.body).replace(/https?:\/\/\S+/g, "").replace(/\s{2,}/g, " ").trim() + `\n${portal}`;
      const comm = await sendPatientMessage({ patient: p, caseId: t.c.id, body, channel: (args.channel as "sms" | "email" | "portal" | null) ?? undefined });
      t.communications.push(comm);
      t.trace("action", "send_patient_message", `${comm.channel} ${comm.status}: ${comm.body.slice(0, 120)}`);
      return { ok: true, channel: comm.channel, status: comm.status };
    }

    case "create_staff_review": {
      const tier: "amber" | "red" = t.c.tier === "red" ? "red" : "amber";
      // One open review per case: later calls enrich the existing card instead of
      // spamming the staff channel with duplicates.
      const existing = (await store.listReviews({ caseId: t.c.id, status: ["open", "in_progress"] }))[0];
      if (existing) {
        const merge = (a: string[], b: unknown) => Array.from(new Set([...a, ...(((b as string[]) ?? []).filter(Boolean))]));
        existing.title = String(args.title) || existing.title;
        existing.reason = String(args.reason) || existing.reason;
        existing.completed = merge(existing.completed, args.completed);
        existing.unresolved = merge(existing.unresolved, args.unresolved);
        if (args.actionSet === "medication_review" && args.appointmentId) existing.actions = medicationReviewActions(String(args.appointmentId));
        await store.putReview(existing);
        await updateReviewInSlack(existing, t.c, `Updated ${new Date().toLocaleTimeString("en-AU", { timeZone: clinic.timezone, hour: "2-digit", minute: "2-digit" })}`).catch(() => undefined);
        if (!t.reviews.some((r) => r.id === existing.id)) t.reviews.push(existing);
        t.c.status = "awaiting_staff";
        t.trace("staff", "create_staff_review", `${existing.id} updated (already open) "${existing.title}"`, { reviewId: existing.id });
        return { ok: true, reviewId: existing.id, updated: true, note: "An open review already existed for this case; it was updated rather than duplicated." };
      }
      const review = await createStaffReview({
        c: t.c,
        tier,
        title: String(args.title),
        reason: String(args.reason),
        completed: (args.completed as string[]) ?? [],
        unresolved: (args.unresolved as string[]) ?? [],
        actions: args.actionSet === "medication_review" ? medicationReviewActions((args.appointmentId as string | null) ?? undefined) : genericReviewActions(),
      });
      t.reviews.push(review);
      t.c.status = "awaiting_staff";
      t.trace("staff", "create_staff_review", `${review.id} (${tier}) "${review.title}"${review.slackTs ? " → posted to Slack" : " → staff console (Slack not live)"}`, { reviewId: review.id });
      return { ok: true, reviewId: review.id, postedToSlack: Boolean(review.slackTs), channel: clinic.triageSlackChannel };
    }

    case "start_research_prescreen": {
      const study = clinic.researchStudies.find((s) => s.id === args.studyId);
      if (!study) return { error: "Unknown study." };
      t.c.researchPrescreen = {
        consented: Boolean(args.consented),
        topic: study.title,
        notes: JSON.stringify({ answers: args.answers, notes: args.notes ?? null }),
        status: args.consented ? "pending_coordinator" : "declined",
      };
      if (t.patient) {
        await putFact(t, { patientId: t.patient.id, caseId: t.c.id, kind: "research_interest", statement: `Patient ${args.consented ? "consented to" : "declined"} research coordinator contact regarding "${study.title}".`, provenance: "patient_reported", source: `Case ${t.c.id}` });
      }
      t.trace("action", "start_research_prescreen", `${study.id} consented=${args.consented}`);
      return { ok: true, coordinator: "Dr Aisha Bello", status: t.c.researchPrescreen.status };
    }

    case "record_intake": {
      const existing = t.patient;
      const id = existing?.id ?? `PT-N${String(Date.now()).slice(-4)}`;
      const patient: Patient = {
        id,
        kind: "prospective",
        name: String(args.name),
        dateOfBirth: (args.dateOfBirth as string | null) ?? undefined,
        phone: (args.phone as string | null) ?? undefined,
        email: (args.email as string | null) ?? undefined,
        preferredContact: (args.preferredContact as Patient["preferredContact"]) ?? "sms",
        accessibility: (args.accessibility as string[]) ?? [],
        languages: (args.languages as string[])?.length ? (args.languages as string[]) : ["English"],
        createdAt: existing?.createdAt ?? nowIso(),
      };
      await store.putPatient(patient);
      t.ctx.patient = patient;
      t.c.patientId = patient.id;
      await putFact(t, { patientId: patient.id, caseId: t.c.id, kind: "note", statement: `Reason for contact (self-reported): ${args.reason}`, provenance: "patient_reported", source: `Intake conversation ${t.c.id}` });
      for (const a of patient.accessibility) {
        await putFact(t, { patientId: patient.id, caseId: t.c.id, kind: "accessibility", statement: a, provenance: "patient_reported", source: `Intake conversation ${t.c.id}` });
      }
      t.trace("action", "record_intake", `Provisional record ${patient.id} for ${patient.name}`);
      return { ok: true, patientId: patient.id };
    }

    case "answer_staff_question": {
      const q = t.c.pendingStaffQuestions.find((x) => x.id === args.questionId);
      if (!q) return { error: "Unknown question id." };
      const review = await store.getReview(q.reviewId);
      const answer = String(args.answerSummary);
      if (review) {
        review.unresolved = review.unresolved.filter((u) => !u.includes(q.question));
        review.completed.push(`Patient answered "${q.question}": ${answer}`);
        await store.putReview(review);
        await postThreadReply(review, `Patient's answer to "${q.question}":\n> ${answer}`).catch(() => undefined);
      }
      if (t.patient) {
        await putFact(t, { patientId: t.patient.id, caseId: t.c.id, kind: "note", statement: `Answer to staff question "${q.question}": ${answer}`, provenance: "patient_reported", source: `Case ${t.c.id}` });
      }
      t.c.pendingStaffQuestions = t.c.pendingStaffQuestions.filter((x) => x.id !== q.id);
      if (t.c.pendingStaffQuestions.length === 0 && review && review.status !== "resolved" && review.status !== "dismissed") t.c.status = "awaiting_staff";
      t.trace("staff", "answer_staff_question", `Relayed answer to ${q.askedBy}: ${answer.slice(0, 120)}`);
      return { ok: true };
    }

    case "show_receipt": {
      t.cards.push({ type: "receipt", reference: t.c.id, items: (args.items as string[]) ?? [] });
      if (t.c.status !== "awaiting_staff") t.c.status = "completed";
      t.trace("message", "show_receipt", `${(args.items as string[])?.length ?? 0} items`);
      return { ok: true };
    }

    default:
      return { error: `Unknown tool ${name}` };
  }
}
