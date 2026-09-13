import type { Case, StaffAction, StaffReview } from "@/core/types";
import { getStore } from "@/core/store";
import { nowIso } from "@/core/ids";
import { postReviewToSlack } from "./slack";

/**
 * Create a staff exception. Called by the coordinator for amber/red outcomes.
 * Persists first, then posts to Slack (if live) and stores the message coordinates so
 * later staff actions can update the same card.
 */
export async function createStaffReview(input: {
  c: Case;
  tier: "amber" | "red";
  title: string;
  reason: string;
  completed: string[];
  unresolved: string[];
  actions: StaffAction[];
}): Promise<StaffReview> {
  const store = getStore();
  const id = await store.nextReviewRef();
  const review: StaffReview = {
    id,
    caseId: input.c.id,
    patientId: input.c.patientId,
    tier: input.tier,
    title: input.title,
    reason: input.reason,
    completed: input.completed,
    unresolved: input.unresolved,
    actions: input.actions,
    status: "open",
    createdAt: nowIso(),
  };
  await store.putReview(review);
  try {
    const posted = await postReviewToSlack(review, input.c);
    if (posted) {
      review.slackChannel = posted.channel;
      review.slackTs = posted.ts;
      await store.putReview(review);
    }
  } catch (e) {
    console.warn("[slack] post failed:", (e as Error).message);
  }
  return review;
}

/** Default action set for a medication-review hold. */
export function medicationReviewActions(appointmentId?: string): StaffAction[] {
  return [
    { id: "confirm", label: "Confirm appointment", kind: "confirm_appointment", payload: appointmentId ? { appointmentId } : undefined },
    { id: "ask_last_dose", label: "Ask patient: date of last dose", kind: "ask_patient", payload: { question: "When did you last take this medicine (date and roughly what time)?" } },
    { id: "assign_pharmacist", label: "Assign pharmacist", kind: "assign", payload: { staffId: "pharm_okafor" } },
    { id: "dismiss", label: "Dismiss", kind: "dismiss" },
  ];
}

export function genericReviewActions(): StaffAction[] {
  return [
    { id: "ask_patient", label: "Ask patient a question", kind: "ask_patient", payload: {} },
    { id: "assign_gp", label: "Assign GP", kind: "assign", payload: { staffId: "dr_raman" } },
    { id: "dismiss", label: "Dismiss", kind: "dismiss" },
  ];
}

export function urgentActions(): StaffAction[] {
  return [
    { id: "acknowledge", label: "Acknowledge — staff calling patient", kind: "custom", payload: { action: "acknowledge" } },
    { id: "dismiss", label: "Resolved", kind: "dismiss" },
  ];
}
