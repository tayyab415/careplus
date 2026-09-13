import type { Appointment, CarePlanTask, Case, Fact, Patient, ResolvedMedication, UploadedDocument } from "@/core/types";
import { getStore } from "@/core/store";
import { formatLocal } from "@/core/time";
import { getAppointmentType, getLocation, getStaff } from "@/data/clinic";

export interface CaseContext {
  patient: Patient | null;
  facts: Fact[];
  careTasks: CarePlanTask[];
  appointments: Appointment[];
  medications: ResolvedMedication[];
  documents: UploadedDocument[];
  priorCases: Case[];
}

export async function loadContext(c: Case): Promise<CaseContext> {
  const store = getStore();
  const patient = await store.getPatient(c.patientId);
  const [facts, careTasks, appointments, priorCases] = patient
    ? await Promise.all([
        store.listFacts(patient.id),
        store.listCareTasks(patient.id),
        store.listAppointments({ patientId: patient.id }),
        store.listCases({ patientId: patient.id }),
      ])
    : [[], [], [], []];
  const medications = (await Promise.all(c.medicationIds.map((id) => store.getMedication(id)))).filter(Boolean) as ResolvedMedication[];
  const docIds = new Set<string>();
  for (const m of c.messages) for (const a of m.attachments) docIds.add(a.documentId);
  const documents = (await Promise.all([...docIds].map((id) => store.getDocument(id)))).filter(Boolean) as UploadedDocument[];
  return { patient, facts, careTasks, appointments, medications, documents, priorCases: priorCases.filter((p) => p.id !== c.id) };
}

function apptLine(a: Appointment) {
  const type = getAppointmentType(a.appointmentTypeId);
  const loc = a.location ? getLocation(a.location)?.name : undefined;
  const who = a.clinician ? getStaff(a.clinician)?.name : undefined;
  return `  - [${a.status}] ${type?.title ?? a.appointmentTypeId} — ${formatLocal(a.start)} (${a.mode}${loc ? ", " + loc : ""}${who ? ", " + who : ""}) id=${a.id}${a.dependsOn.length ? ` dependsOn=${a.dependsOn.join(",")}` : ""}`;
}

/** Render everything the coordinator should know about this case as one text block. */
export function renderContext(c: Case, ctx: CaseContext, nowIso: string): string {
  const p = ctx.patient;
  const out: string[] = [];
  out.push(`NOW: ${nowIso} (${formatLocal(nowIso)} clinic time). CASE: ${c.id} status=${c.status}${c.tier ? ` tier=${c.tier}` : ""}${c.outcome ? ` outcome=${c.outcome}` : ""}.`);

  if (!p || p.kind === "prospective") {
    out.push(
      p
        ? `PATIENT: PROSPECTIVE — ${p.name} (${p.id}). Only self-reported information exists; nothing has been verified by the clinic. Phone ${p.phone ?? "unknown"}, DOB ${p.dateOfBirth ?? "unknown"}, accessibility: ${p.accessibility.join("; ") || "none stated"}, languages: ${p.languages.join(", ")}.`
        : "PATIENT: PROSPECTIVE, not yet identified. No record exists. Collect intake before booking.",
    );
  } else {
    out.push(
      `PATIENT: EXISTING MEMBER — ${p.name} (${p.id}), DOB ${p.dateOfBirth}, prefers ${p.preferredContact} contact and ${p.preferredAppointmentMode ?? "any"} appointments. Languages: ${p.languages.join(", ")}. Accessibility: ${p.accessibility.join("; ") || "none recorded"}. Primary clinician: ${p.primaryClinician ? getStaff(p.primaryClinician)?.name : "—"}. Membership ${p.membership?.status ?? "—"}.`,
    );
  }

  if (ctx.facts.length) {
    const groups: Record<string, Fact[]> = {};
    for (const f of ctx.facts.filter((f) => !f.supersededBy)) (groups[f.provenance] ??= []).push(f);
    const order = ["staff_confirmed", "database_verified", "clinic_policy", "document_extracted", "patient_reported", "model_predicted"];
    out.push("RECORD (grouped by provenance — cite the source when you use one):");
    for (const prov of order) {
      const fs = groups[prov];
      if (!fs?.length) continue;
      out.push(`  [${prov}]`);
      for (const f of fs) out.push(`    - (${f.kind}) ${f.statement} — source: ${f.source}${f.confidence !== undefined ? ` (confidence ${Math.round(f.confidence * 100)}%)` : ""} id=${f.id}`);
    }
  }

  const openTasks = ctx.careTasks.filter((t) => t.status !== "done" && t.status !== "cancelled");
  if (openTasks.length) {
    out.push("OPEN CARE-PLAN TASKS:");
    for (const t of openTasks) out.push(`  - [${t.status}] ${t.description}${t.dueBy ? ` (due ${t.dueBy})` : ""} — from ${t.source} id=${t.id}`);
  }

  const upcoming = ctx.appointments.filter((a) => a.end >= nowIso && a.status !== "cancelled");
  const past = ctx.appointments.filter((a) => a.end < nowIso).slice(-3);
  if (upcoming.length) {
    out.push("UPCOMING / HELD APPOINTMENTS:");
    upcoming.forEach((a) => out.push(apptLine(a)));
  }
  if (past.length) {
    out.push("RECENT PAST APPOINTMENTS:");
    past.forEach((a) => out.push(apptLine(a)));
  }

  if (ctx.documents.length) {
    out.push("UPLOADED DOCUMENTS IN THIS CASE:");
    for (const d of ctx.documents) {
      const e = d.extraction;
      out.push(
        `  - ${d.id} "${d.name}" ${e ? `→ extraction (${d.confirmedByPatient ? "CONFIRMED by patient" : "NOT yet confirmed"}, confidence ${Math.round(e.confidence * 100)}%): product="${e.productName ?? "?"}", ingredients=[${e.activeIngredients.join("; ")}], strength=${e.strength ?? "?"}, form=${e.dosageForm ?? "?"}, date=${e.prescriptionDate ?? "?"}, pharmacy=${e.pharmacy ?? "?"}, nameOnLabel=${e.patientNameOnLabel ?? "?"}${e.warnings.length ? `, warnings=[${e.warnings.join("; ")}]` : ""}` : "(no extraction yet)"}`,
      );
    }
  }

  if (ctx.medications.length) {
    out.push("MEDICINES RESOLVED IN THIS CASE (database_verified):");
    for (const m of ctx.medications) {
      out.push(
        `  - ${m.id}: query="${m.queryName}" → RxNorm ${m.rxnormName ?? "—"} [${m.matchQuality}] ingredients=[${m.ingredients.map((i) => i.name).join("; ")}] brands=[${m.brandNames.slice(0, 3).join(", ")}] molecules=[${m.molecules.map((x) => `${x.ingredient}: CID ${x.pubchem.cid} SMILES ${x.pubchem.canonicalSmiles}`).join(" | ")}] labels=${m.labels.length}`,
      );
      for (const { ingredient, label: l } of m.labels) {
        const snip = (s?: string) => (s ? s.slice(0, 350) + (s.length > 350 ? "…" : "") : "—");
        out.push(`      official label for ${ingredient} (openFDA ${l.genericName ?? l.brandName ?? ""}) — warnings: ${snip(l.boxedWarning ?? l.warnings ?? l.warningsAndCautions)}`);
        out.push(`        adverse reactions: ${snip(l.adverseReactions)}`);
        out.push(`        interactions: ${snip(l.drugInteractions)}`);
      }
    }
  }

  if (c.txgemmaSignals.length) {
    out.push("TXGEMMA RESEARCH SIGNALS (model_predicted — for staff context, never clinical fact):");
    for (const s of c.txgemmaSignals) out.push(`  - ${s.ingredient} · ${s.taskLabel}: ${s.meaning} (raw "${s.rawOutput}")`);
  }

  if (c.pendingStaffQuestions.length) {
    out.push("PENDING QUESTIONS FROM STAFF TO THE PATIENT (relay the patient's answer with answer_staff_question):");
    for (const q of c.pendingStaffQuestions) out.push(`  - ${q.id} (${q.askedBy}, review ${q.reviewId}): "${q.question}"`);
  }

  if (ctx.priorCases.length) {
    out.push("PRIOR CASES:");
    for (const pc of ctx.priorCases.slice(0, 5)) out.push(`  - ${pc.id} [${pc.status}${pc.tier ? ", " + pc.tier : ""}] ${pc.title ?? pc.intent ?? ""}`);
  }

  if (c.researchPrescreen) out.push(`RESEARCH PRE-SCREEN: ${JSON.stringify(c.researchPrescreen)}`);

  return out.join("\n");
}
