import { clinic } from "@/data/clinic";
import type { ResolvedMedication, RoutingOutcome, Tier, TxGemmaSignal } from "@/core/types";

/**
 * Deterministic routing. The coordinator LLM gathers evidence and *describes* the
 * situation with the flags below; this engine decides the tier. The LLM cannot
 * override the tier — it can only gather more evidence and call again.
 */

export interface RoutingInput {
  redFlagRuleId?: string | null;
  /** Patient reports a past adverse experience relevant to the medicine at hand. */
  priorAdverseExperience: boolean;
  /** The medicine at hand is the same as / shares an ingredient with the one tied to the adverse experience. */
  adverseMedicineRelated: boolean;
  /** Resolved medications in play (may be empty). */
  medications: Pick<ResolvedMedication, "matchQuality" | "ingredients" | "label" | "labels">[];
  /** Names (lowercase) of the patient's current medicines from the record. */
  currentMedicineNames: string[];
  /** A new medicine is being started / considered. */
  startingNewMedicine: boolean;
  /** Document or statement conflicts with the clinic record. */
  recordConflict: boolean;
  /** Patient asked something only a clinician can answer (dosing, causation, stop/switch). */
  clinicalQuestion: boolean;
  /** Requested workflow needs medication reconciliation (post-discharge). */
  postDischarge: boolean;
  /** Research pre-screen with unanswerable criterion. */
  researchUnresolved: boolean;
  /** Extraction the patient has not confirmed yet is being relied upon. */
  unconfirmedExtraction: boolean;
  txgemmaSignals: TxGemmaSignal[];
  /** Symptom the patient reported historically, to compare with TxGemma. */
  reportedSymptom?: string;
  /** Requested appointment type ID, if any. */
  requestedAppointmentTypeId?: string;
}

export interface RoutingDecision {
  tier: Tier;
  outcome: RoutingOutcome;
  reasons: string[];
  /** Appointment type the clinic policy wants for this situation, if any. */
  appointmentTypeId?: string;
  /** Whether the agent may confirm the booking itself, or must hold it for staff. */
  bookingAuthority: "book" | "hold" | "none";
  staffReviewRequired: boolean;
  urgent?: { heading: string; body: string; callNumber: string };
}

const SYMPTOM_TASK_LINK: Record<string, string[]> = {
  dizziness: ["BBB_Martins"],
  drowsiness: ["BBB_Martins"],
  sedation: ["BBB_Martins"],
  rash: ["Skin_Reaction"],
  itch: ["Skin_Reaction"],
  palpitations: ["hERG"],
  fainting: ["hERG"],
};

export function evaluateRouting(input: RoutingInput): RoutingDecision {
  const reasons: string[] = [];

  // ---- RED: deterministic, clinic-authored ---------------------------------
  if (input.redFlagRuleId) {
    const rule = clinic.redFlags.find((r) => r.id === input.redFlagRuleId);
    reasons.push(`Red-flag rule matched: ${rule?.label ?? input.redFlagRuleId}.`);
    return {
      tier: "red",
      outcome: "show_urgent_instructions",
      reasons,
      bookingAuthority: "none",
      staffReviewRequired: true,
      urgent: clinic.urgentInstruction,
    };
  }

  // ---- AMBER triggers ------------------------------------------------------
  let amber = false;
  let wantsMedReview = false;

  if (input.priorAdverseExperience && (input.adverseMedicineRelated || input.startingNewMedicine)) {
    amber = true;
    wantsMedReview = true;
    reasons.push("Patient reported a previous adverse experience with a related or newly recommended medicine.");
  }
  for (const m of input.medications) {
    if (m.matchQuality !== "exact") {
      amber = true;
      reasons.push(`Medication identity is ${m.matchQuality} — not confirmed to exact-match quality.`);
    }
  }
  if (input.unconfirmedExtraction) {
    amber = true;
    reasons.push("Relying on a document extraction the patient has not confirmed.");
  }
  if (input.startingNewMedicine) {
    const high = input.currentMedicineNames.filter((n) => clinic.highMonitoringMedicines.includes(n.toLowerCase()));
    if (high.length) {
      amber = true;
      wantsMedReview = true;
      reasons.push(`New medicine alongside high-monitoring medicine(s): ${high.join(", ")}.`);
    }
  }
  if (input.recordConflict) {
    amber = true;
    reasons.push("Patient statement or document conflicts with the clinic record.");
  }
  if (input.clinicalQuestion) {
    amber = true;
    reasons.push("Question requires clinician judgement (dosing, causation, or whether to stop/switch).");
  }
  if (input.postDischarge) {
    amber = true;
    reasons.push("Post-hospital follow-up requires medication reconciliation by a clinician.");
  }
  if (input.researchUnresolved) {
    amber = true;
    reasons.push("Research pre-screen has a criterion that cannot be answered from the record.");
  }

  // TxGemma vs label disagreement — research signal only, but a disagreement is a reason to look.
  if (input.reportedSymptom && input.txgemmaSignals.length) {
    const sym = input.reportedSymptom.toLowerCase();
    const linked = Object.entries(SYMPTOM_TASK_LINK).find(([k]) => sym.includes(k))?.[1] ?? [];
    for (const s of input.txgemmaSignals) {
      if (!linked.includes(s.task)) continue;
      const label =
        input.medications.flatMap((m) => m.labels ?? []).find((l) => l.ingredient.toLowerCase().includes(s.ingredient.toLowerCase()) || s.ingredient.toLowerCase().includes(l.ingredient.toLowerCase()))?.label ??
        input.medications.find((m) => m.label)?.label;
      // Only compare against a label that actually has an adverse-reactions section for
      // this ingredient (OTC combination labels often lack one → nothing to compare).
      if (!label?.adverseReactions) continue;
      const labelText = `${label.adverseReactions} ${label.warnings ?? ""} ${label.warningsAndCautions ?? ""} ${label.boxedWarning ?? ""}`.toLowerCase();
      // Any meaningful symptom word (rash, itch, dizz…) appearing in the label counts as a mention.
      const symWords = sym.split(/[^a-z]+/).filter((w) => w.length >= 4).map((w) => w.replace(/(ing|ness|es|s)$/, ""));
      const labelMentions = symWords.some((w) => labelText.includes(w));
      if (s.choice === "B" && labelMentions) {
        reasons.push(`TxGemma ${s.taskLabel} signal is consistent with the official label mentioning "${input.reportedSymptom}". Recorded as corroborating research context.`);
      } else if (s.choice === "B" && !labelMentions) {
        amber = true;
        reasons.push(`TxGemma ${s.taskLabel} signal (B) but the official label does not mention "${input.reportedSymptom}" — disagreement flagged for staff.`);
      } else if (s.choice === "A" && labelMentions) {
        amber = true;
        reasons.push(`Official label mentions "${input.reportedSymptom}" but TxGemma ${s.taskLabel} signal is (A) — disagreement flagged for staff.`);
      }
    }
  }

  // ---- Decide -----------------------------------------------------------------
  const requested = input.requestedAppointmentTypeId ? clinic.appointmentTypes.find((t) => t.id === input.requestedAppointmentTypeId) : undefined;

  if (amber) {
    const reviewType = wantsMedReview ? "medication_review" : input.postDischarge ? "post_discharge_followup" : undefined;
    // A routine appointment (asthma nurse review, physio, pathology…) requested alongside an
    // amber medicine question is still routine: it may be booked, while the review is held.
    if (requested && requested.id !== reviewType && requested.autonomy === "book") {
      reasons.push(`Routine ${requested.title} may be booked alongside the held review.`);
      return {
        tier: "amber",
        outcome: reviewType ? "book_medication_review" : "route_to_staff",
        reasons,
        appointmentTypeId: requested.id,
        bookingAuthority: "book",
        staffReviewRequired: true,
      };
    }
    const apptId = reviewType ?? requested?.id;
    return {
      tier: "amber",
      outcome: wantsMedReview ? "book_medication_review" : "route_to_staff",
      reasons,
      appointmentTypeId: apptId,
      bookingAuthority: apptId ? "hold" : "none",
      staffReviewRequired: true,
    };
  }

  // GREEN
  reasons.push("No amber or red triggers. Routine coordination.");
  if (requested) {
    return {
      tier: "green",
      outcome: "complete_automatically",
      reasons,
      appointmentTypeId: requested.id,
      bookingAuthority: requested.autonomy,
      staffReviewRequired: requested.autonomy === "hold",
    };
  }
  return { tier: "green", outcome: "complete_automatically", reasons, bookingAuthority: "book", staffReviewRequired: false };
}
