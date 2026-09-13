import type { Appointment, CarePlanTask, Fact, Patient } from "@/core/types";
import { daysAgoIso, daysAheadDate } from "@/core/time";

// Recent events are expressed relative to "now" so the demo never goes stale.
const ago = (d: number) => daysAgoIso(d);
const agoDate = (d: number) => daysAgoIso(d).slice(0, 10);
const ahead = (d: number) => daysAheadDate(d);

/**
 * Synthetic patients. Entirely fictional people and histories.
 * Each fact carries provenance so the agent (and staff) can tell what the clinic
 * verified versus what a patient once said.
 */

const T = "2026-01-15T00:00:00.000Z";

function fact(
  patientId: string,
  id: string,
  kind: Fact["kind"],
  statement: string,
  provenance: Fact["provenance"],
  source: string,
  recordedAt: string,
  data?: Record<string, unknown>,
): Fact {
  return { id, patientId, kind, statement, provenance, source, recordedAt, recordedBy: "staff", data };
}

export const patients: Patient[] = [
  {
    id: "PT-8821",
    kind: "existing",
    name: "Maya Lin",
    preferredName: "Maya",
    dateOfBirth: "1991-03-22",
    phone: "+61 400 111 221",
    email: "maya.lin@example.test",
    preferredContact: "sms",
    preferredAppointmentMode: "video",
    accessibility: [],
    languages: ["English", "Mandarin"],
    membership: { plan: "Harbourside Care Membership", since: "2024-02-01", status: "active" },
    primaryClinician: "dr_raman",
    demoBlurb: "Recommended a cough medicine; had dizziness last year from something similar but can't remember what. Has an old bottle to photograph.",
    createdAt: T,
  },
  {
    id: "PT-4410",
    kind: "existing",
    name: "Arjun Mehta",
    preferredName: "Arjun",
    dateOfBirth: "1978-11-02",
    phone: "+61 400 111 410",
    email: "arjun.mehta@example.test",
    preferredContact: "sms",
    preferredAppointmentMode: "in_person",
    accessibility: ["Wheelchair user — needs step-free access and an accessible consulting room"],
    languages: ["English", "Hindi"],
    membership: { plan: "Harbourside Care Membership", since: "2023-06-10", status: "active" },
    primaryClinician: "dr_whitaker",
    demoBlurb: "GP told him: physio for lower back, blood tests, return in four weeks. Wheelchair user — physio must be at an accessible location.",
    createdAt: T,
  },
  {
    id: "PT-2207",
    kind: "existing",
    name: "Grace Okonkwo",
    preferredName: "Grace",
    dateOfBirth: "1985-07-14",
    phone: "+61 400 111 207",
    email: "grace.okonkwo@example.test",
    preferredContact: "email",
    preferredAppointmentMode: "in_person",
    accessibility: ["Hard of hearing — prefers text/portal; hearing loop when in person"],
    languages: ["English"],
    membership: { plan: "Harbourside Care Membership", since: "2022-09-05", status: "active" },
    primaryClinician: "dr_raman",
    demoBlurb: "Has migraine on a daily preventive. Wants to know whether a research study is relevant and needs to send records from her previous clinic.",
    createdAt: T,
  },
  {
    id: "PT-6633",
    kind: "existing",
    name: "Tom Reilly",
    preferredName: "Tom",
    dateOfBirth: "1957-01-30",
    phone: "+61 400 111 633",
    email: "tom.reilly@example.test",
    preferredContact: "sms",
    preferredAppointmentMode: "in_person",
    accessibility: ["Large-print materials"],
    languages: ["English"],
    membership: { plan: "Harbourside Care Membership", since: "2021-03-18", status: "active" },
    primaryClinician: "dr_whitaker",
    demoBlurb: "On warfarin. Just discharged from hospital with a new medicine and a discharge summary. Needs a follow-up but doesn't know which appointment to book.",
    createdAt: T,
  },
  {
    id: "PT-9012",
    kind: "existing",
    name: "Lucia Fernandes",
    preferredName: "Lucia",
    dateOfBirth: "1969-05-09",
    phone: "+61 400 111 912",
    email: "lucia.fernandes@example.test",
    preferredContact: "sms",
    preferredAppointmentMode: "in_person",
    accessibility: ["Interpreter required (Portuguese)"],
    languages: ["Portuguese", "English (basic)"],
    membership: { plan: "Harbourside Care Membership", since: "2024-08-20", status: "active" },
    primaryClinician: "dr_raman",
    demoBlurb: "Asthma on two inhalers; needs a Portuguese interpreter. Had a rash from an antibiotic last year and has the blister pack.",
    createdAt: T,
  },
];

export const facts: Fact[] = [
  /* ---------------------------- Maya Lin PT-8821 --------------------------- */
  fact("PT-8821", "f_8821_01", "condition", "Mild hypertension, diagnosed 2023.", "staff_confirmed", "Clinician record — Dr Raman, 2023-11-08", "2023-11-08T02:00:00.000Z"),
  fact("PT-8821", "f_8821_02", "medication", "Amlodipine 5 mg tablet, one daily (current, prescribed by Dr Raman).", "staff_confirmed", "Prescription record 2025-12-02", "2025-12-02T03:00:00.000Z", { name: "amlodipine", strength: "5 mg", form: "tablet", status: "current" }),
  fact("PT-8821", "f_8821_03", "medication", "Magnesium supplement, over the counter, most evenings.", "patient_reported", "Patient statement at consult 2025-12-02", "2025-12-02T03:05:00.000Z", { name: "magnesium", status: "current", otc: true }),
  fact("PT-8821", "f_8821_04", "adverse_experience", "Patient reported dizziness after starting a medication in June 2025. Medication name was not confirmed at the time.", "patient_reported", "Clinician note — Dr Raman, 2025-06-12: 'Pt reports post-administration dizziness; active drug name unrecorded.'", "2025-06-12T04:00:00.000Z", { symptom: "dizziness", medicationName: null, confirmed: false }),
  fact("PT-8821", "f_8821_05", "allergy", "No known drug allergies.", "staff_confirmed", "Intake record 2024-02-01", "2024-02-01T00:00:00.000Z"),
  fact("PT-8821", "f_8821_06", "contact_preference", "Prefers video consultations and SMS reminders.", "staff_confirmed", "Preferences 2024-02-01", "2024-02-01T00:00:00.000Z"),
  fact("PT-8821", "f_8821_07", "appointment_history", "GP consultation with Dr Raman 2025-12-02 — blood pressure review, amlodipine continued.", "database_verified", "Appointment record", "2025-12-02T03:00:00.000Z"),
  fact("PT-8821", "f_8821_08", "care_plan_instruction", `GP recommended an over-the-counter cough medicine for a lingering cough (${agoDate(2)}, phone consult). Patient to check with clinic before starting given prior dizziness episode.`, "staff_confirmed", `Clinician note — Dr Raman, ${agoDate(2)}`, ago(2)),

  /* --------------------------- Arjun Mehta PT-4410 ------------------------- */
  fact("PT-4410", "f_4410_01", "condition", "Type 2 diabetes (2019). Chronic lower back pain.", "staff_confirmed", "Clinician record — Dr Whitaker", "2019-05-02T00:00:00.000Z"),
  fact("PT-4410", "f_4410_02", "medication", "Metformin 500 mg tablet, twice daily (current).", "staff_confirmed", "Prescription record 2025-11-20", "2025-11-20T00:00:00.000Z", { name: "metformin", strength: "500 mg", status: "current" }),
  fact("PT-4410", "f_4410_03", "medication", "Atorvastatin 20 mg tablet, nightly (current).", "staff_confirmed", "Prescription record 2025-11-20", "2025-11-20T00:00:00.000Z", { name: "atorvastatin", strength: "20 mg", status: "current" }),
  fact("PT-4410", "f_4410_04", "accessibility", "Wheelchair user. Requires step-free access and an accessible consulting room. Do not book at the Annex.", "staff_confirmed", "Accessibility record 2023-06-10", "2023-06-10T00:00:00.000Z"),
  fact("PT-4410", "f_4410_05", "care_plan_instruction", `Plan from consult ${agoDate(1)} (Dr Whitaker): (1) refer to physiotherapy for lower back; (2) fasting bloods — lipids and HbA1c; (3) review with GP in about four weeks to go over results.`, "staff_confirmed", `Clinician note — Dr Whitaker, ${agoDate(1)}`, ago(1), { tasks: ["physiotherapy referral", "fasting bloods: lipids, HbA1c", "GP review ~4 weeks"] }),
  fact("PT-4410", "f_4410_06", "allergy", "Penicillin — rash (childhood). Recorded allergy.", "staff_confirmed", "Intake record", "2023-06-10T00:00:00.000Z", { allergen: "penicillin", reaction: "rash" }),
  fact("PT-4410", "f_4410_07", "appointment_history", `GP consultation with Dr Whitaker ${agoDate(1)} — back pain and diabetes review.`, "database_verified", "Appointment record", ago(1)),

  /* -------------------------- Grace Okonkwo PT-2207 ------------------------ */
  fact("PT-2207", "f_2207_01", "condition", "Migraine with aura, diagnosed 2020 (neurologist letter on file).", "staff_confirmed", "Specialist letter 2020-10-03", "2020-10-03T00:00:00.000Z"),
  fact("PT-2207", "f_2207_02", "medication", "Propranolol 40 mg tablet, twice daily, as migraine preventive (current).", "staff_confirmed", "Prescription record 2025-10-15", "2025-10-15T00:00:00.000Z", { name: "propranolol", strength: "40 mg", status: "current" }),
  fact("PT-2207", "f_2207_03", "medication", "Sumatriptan 50 mg tablet, as needed for attacks (current).", "staff_confirmed", "Prescription record 2025-10-15", "2025-10-15T00:00:00.000Z", { name: "sumatriptan", strength: "50 mg", status: "current", prn: true }),
  fact("PT-2207", "f_2207_04", "accessibility", "Hard of hearing. Prefers written communication; hearing loop when attending in person.", "staff_confirmed", "Accessibility record", "2022-09-05T00:00:00.000Z"),
  fact("PT-2207", "f_2207_05", "note", "Patient moved from Northgate Medical Centre in 2022; previous records not yet received.", "staff_confirmed", "Reception note 2022-09-05", "2022-09-05T00:00:00.000Z"),
  fact("PT-2207", "f_2207_06", "research_interest", "Patient asked at last visit whether any migraine studies were running.", "patient_reported", "Clinician note — Dr Raman, 2025-10-15", "2025-10-15T00:00:00.000Z"),
  fact("PT-2207", "f_2207_07", "allergy", "No known drug allergies.", "staff_confirmed", "Intake record", "2022-09-05T00:00:00.000Z"),

  /* ---------------------------- Tom Reilly PT-6633 ------------------------- */
  fact("PT-6633", "f_6633_01", "condition", "Atrial fibrillation (2018). Chronic kidney disease stage 3a. Osteoarthritis.", "staff_confirmed", "Clinician record — Dr Whitaker", "2018-04-11T00:00:00.000Z"),
  fact("PT-6633", "f_6633_02", "medication", "Warfarin 3 mg tablet, dose per INR clinic (current). High-monitoring medicine.", "staff_confirmed", "Prescription record 2025-12-18", "2025-12-18T00:00:00.000Z", { name: "warfarin", strength: "3 mg", status: "current", highMonitoring: true }),
  fact("PT-6633", "f_6633_03", "medication", "Metoprolol 50 mg tablet, twice daily (current).", "staff_confirmed", "Prescription record 2025-12-18", "2025-12-18T00:00:00.000Z", { name: "metoprolol", strength: "50 mg", status: "current" }),
  fact("PT-6633", "f_6633_04", "medication", "Paracetamol 500 mg, as needed for joint pain.", "patient_reported", "Patient statement 2025-12-18", "2025-12-18T00:00:00.000Z", { name: "paracetamol", status: "current", prn: true }),
  fact("PT-6633", "f_6633_05", "appointment_history", "INR clinic visit 2025-12-18 — INR 2.6, warfarin unchanged.", "database_verified", "Appointment record", "2025-12-18T00:00:00.000Z"),
  fact("PT-6633", "f_6633_06", "note", `Hospital notification received: admitted ${agoDate(5)} to ${agoDate(2)} (Harbour City Hospital) for a chest infection. Discharge summary not yet received by the clinic.`, "staff_confirmed", `Reception note ${agoDate(2)}`, ago(2)),
  fact("PT-6633", "f_6633_07", "accessibility", "Large-print materials requested.", "staff_confirmed", "Preferences", "2021-03-18T00:00:00.000Z"),
  fact("PT-6633", "f_6633_08", "allergy", "Sulfonamide antibiotics — severe rash (recorded 2010).", "staff_confirmed", "Intake record", "2021-03-18T00:00:00.000Z", { allergen: "sulfonamides", reaction: "severe rash" }),

  /* ------------------------- Lucia Fernandes PT-9012 ----------------------- */
  fact("PT-9012", "f_9012_01", "condition", "Asthma, moderate persistent (2015).", "staff_confirmed", "Clinician record — Dr Raman", "2024-08-20T00:00:00.000Z"),
  fact("PT-9012", "f_9012_02", "medication", "Salbutamol 100 mcg inhaler, as needed (current).", "staff_confirmed", "Prescription record 2025-11-03", "2025-11-03T00:00:00.000Z", { name: "salbutamol", status: "current", prn: true }),
  fact("PT-9012", "f_9012_03", "medication", "Fluticasone propionate 250 mcg inhaler, twice daily (current).", "staff_confirmed", "Prescription record 2025-11-03", "2025-11-03T00:00:00.000Z", { name: "fluticasone", status: "current" }),
  fact("PT-9012", "f_9012_04", "adverse_experience", "Patient reported an itchy rash after a course of antibiotics in 2025 (prescribed elsewhere). Antibiotic name not confirmed; patient believes it was for a tooth infection.", "patient_reported", "Clinician note — Dr Raman, 2025-11-03", "2025-11-03T00:00:00.000Z", { symptom: "rash", medicationName: null, confirmed: false }),
  fact("PT-9012", "f_9012_05", "accessibility", "Portuguese interpreter required for consultations. Book long appointments when an interpreter attends.", "staff_confirmed", "Accessibility record", "2024-08-20T00:00:00.000Z"),
  fact("PT-9012", "f_9012_06", "care_plan_instruction", "Asthma review with practice nurse due in the coming weeks.", "staff_confirmed", "Care plan 2025-11-03", "2025-11-03T00:00:00.000Z"),
  fact("PT-9012", "f_9012_07", "allergy", "No formally recorded drug allergies (see unconfirmed antibiotic rash above).", "staff_confirmed", "Intake record", "2024-08-20T00:00:00.000Z"),
];

export const careTasks: CarePlanTask[] = [
  { id: "ct_4410_physio", patientId: "PT-4410", description: "Physiotherapy initial assessment for lower back pain", status: "open", source: `Dr Whitaker consult ${agoDate(1)}`, createdAt: ago(1) },
  { id: "ct_4410_bloods", patientId: "PT-4410", description: "Fasting bloods: lipids and HbA1c", status: "open", source: `Dr Whitaker consult ${agoDate(1)}`, createdAt: ago(1) },
  { id: "ct_4410_review", patientId: "PT-4410", description: "GP review of results in about four weeks", status: "open", dueBy: ahead(28), source: `Dr Whitaker consult ${agoDate(1)}`, createdAt: ago(1) },
  { id: "ct_9012_asthma", patientId: "PT-9012", description: "Asthma review with practice nurse", status: "open", dueBy: ahead(45), source: "Care plan 2025-11-03", createdAt: "2025-11-03T00:00:00.000Z" },
  { id: "ct_6633_discharge", patientId: "PT-6633", description: `Post-hospital follow-up within 7 days of discharge (${agoDate(2)}), including medication reconciliation`, status: "open", dueBy: ahead(5), source: `Hospital notification ${agoDate(2)}`, createdAt: ago(2) },
];

/** Historical appointments (already happened). */
export const pastAppointments: Appointment[] = [
  { id: "ap_8821_h1", patientId: "PT-8821", caseId: "historical", appointmentTypeId: "gp_standard", title: "GP consultation — Dr Raman", start: "2025-12-02T03:00:00.000Z", end: "2025-12-02T03:15:00.000Z", mode: "video", clinician: "dr_raman", status: "confirmed", dependsOn: [], createdAt: "2025-11-25T00:00:00.000Z" },
  { id: "ap_4410_h1", patientId: "PT-4410", caseId: "historical", appointmentTypeId: "gp_long", title: "GP consultation (long) — Dr Whitaker", start: ago(1), end: new Date(Date.parse(ago(1)) + 30 * 60000).toISOString(), mode: "in_person", location: "main", clinician: "dr_whitaker", status: "confirmed", dependsOn: [], createdAt: "2026-01-05T00:00:00.000Z" },
  { id: "ap_2207_h1", patientId: "PT-2207", caseId: "historical", appointmentTypeId: "gp_standard", title: "GP consultation — Dr Raman", start: "2025-10-15T02:00:00.000Z", end: "2025-10-15T02:15:00.000Z", mode: "in_person", location: "main", clinician: "dr_raman", status: "confirmed", dependsOn: [], createdAt: "2025-10-01T00:00:00.000Z" },
  { id: "ap_6633_h1", patientId: "PT-6633", caseId: "historical", appointmentTypeId: "nurse_review", title: "INR clinic — Ellen Cho", start: "2025-12-18T00:00:00.000Z", end: "2025-12-18T00:20:00.000Z", mode: "in_person", location: "main", clinician: "nurse_cho", status: "confirmed", dependsOn: [], createdAt: "2025-12-10T00:00:00.000Z" },
  { id: "ap_9012_h1", patientId: "PT-9012", caseId: "historical", appointmentTypeId: "gp_long", title: "GP consultation (long, interpreter) — Dr Raman", start: "2025-11-03T00:00:00.000Z", end: "2025-11-03T00:30:00.000Z", mode: "in_person", location: "main", clinician: "dr_raman", status: "confirmed", dependsOn: [], createdAt: "2025-10-20T00:00:00.000Z" },
];
