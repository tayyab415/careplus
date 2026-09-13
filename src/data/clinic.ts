/**
 * Clinic-authored configuration. Everything in this file is *policy*, owned by
 * the clinic, not by a model. The agent reads it; it never rewrites it.
 *
 * All names, numbers and studies are fictional.
 */

export type AppointmentModeId = "in_person" | "video" | "phone";

export interface Location {
  id: string;
  name: string;
  address: string;
  wheelchairAccessible: boolean;
  hearingLoop: boolean;
  notes?: string;
}

export interface AppointmentType {
  id: string;
  title: string;
  durationMin: number;
  modes: AppointmentModeId[];
  /** Staff roles who can take this appointment. */
  roles: StaffRole[];
  locationIds: string[];
  description: string;
  /** Whether the agent may book this autonomously (green) or must hold pending staff (amber). */
  autonomy: "book" | "hold";
  /** For dependency-aware scheduling: minimum hours after a prerequisite appointment. */
  minHoursAfterPrerequisite?: number;
}

export type StaffRole = "gp" | "nurse" | "pharmacist" | "physio" | "phlebotomist" | "reception" | "research_coordinator";

export interface StaffMember {
  id: string;
  name: string;
  role: StaffRole;
  /** Weekly availability in clinic local time; 0 = Sunday. */
  hours: { days: number[]; start: string; end: string }[];
  locationIds: string[];
  modes: AppointmentModeId[];
}

export interface Accommodation {
  id: string;
  label: string;
  offered: boolean;
  requiresNoticeHours?: number;
  notes: string;
}

export interface ResearchStudy {
  id: string;
  title: string;
  coordinator: string;
  status: "recruiting" | "closed";
  summary: string;
  /** Plain-language screening criteria. The agent may *collect* answers; only the coordinator decides eligibility. */
  screeningQuestions: string[];
  topics: string[];
}

export interface RedFlagRule {
  id: string;
  label: string;
  /** Plain-language description used by the classifier. The classifier can only pick from this list. */
  description: string;
  examples: string[];
}

export const clinic = {
  name: "Harbourside Family Clinic",
  shortName: "Harbourside",
  timezone: "Australia/Sydney",
  phone: "(02) 5550 0142",
  afterHoursLine: "1300 555 014",
  emergencyNumber: "000",
  triageSlackChannel: "#clinic-triage",
  hours: [
    { days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00" },
    { days: [6], start: "09:00", end: "13:00" },
  ],
  /** Hours after a pathology draw before results are typically available to the GP. */
  pathologyResultHours: 48,
  membership: {
    plans: ["Harbourside Care Membership"],
    description:
      "Members can use CarePlus, the clinic's coordination assistant, to arrange appointments, send documents and prepare for reviews.",
  },

  locations: [
    {
      id: "main",
      name: "Harbourside Main Clinic",
      address: "12 Quay Street, Level 1 (lift access)",
      wheelchairAccessible: true,
      hearingLoop: true,
    },
    {
      id: "annex",
      name: "Harbourside Annex",
      address: "3 Wharf Lane (stairs only)",
      wheelchairAccessible: false,
      hearingLoop: false,
      notes: "No lift. Not suitable for wheelchair users or patients who cannot manage two flights of stairs.",
    },
    {
      id: "pathology",
      name: "Harbourside Pathology Collection Centre",
      address: "12 Quay Street, Ground floor",
      wheelchairAccessible: true,
      hearingLoop: false,
    },
  ] as Location[],

  staff: [
    { id: "dr_raman", name: "Dr Priya Raman", role: "gp", hours: [{ days: [1, 2, 3, 4], start: "08:30", end: "17:00" }], locationIds: ["main"], modes: ["in_person", "video", "phone"] },
    { id: "dr_whitaker", name: "Dr Tom Whitaker", role: "gp", hours: [{ days: [2, 3, 4, 5], start: "09:00", end: "18:00" }, { days: [6], start: "09:00", end: "13:00" }], locationIds: ["main", "annex"], modes: ["in_person", "video"] },
    { id: "nurse_cho", name: "Ellen Cho (Practice Nurse)", role: "nurse", hours: [{ days: [1, 2, 3, 4, 5], start: "08:00", end: "16:00" }], locationIds: ["main"], modes: ["in_person", "phone"] },
    { id: "pharm_okafor", name: "Sam Okafor (Clinical Pharmacist)", role: "pharmacist", hours: [{ days: [1, 3, 5], start: "10:00", end: "16:00" }], locationIds: ["main"], modes: ["video", "phone", "in_person"] },
    { id: "physio_marsh", name: "Lena Marsh (Physiotherapist)", role: "physio", hours: [{ days: [1, 2, 4, 5], start: "08:00", end: "17:00" }], locationIds: ["main", "annex"], modes: ["in_person"] },
    { id: "phleb_team", name: "Pathology Collection Team", role: "phlebotomist", hours: [{ days: [1, 2, 3, 4, 5], start: "07:30", end: "14:00" }], locationIds: ["pathology"], modes: ["in_person"] },
    { id: "coord_bello", name: "Dr Aisha Bello (Research Coordinator)", role: "research_coordinator", hours: [{ days: [2, 4], start: "10:00", end: "15:00" }], locationIds: ["main"], modes: ["video", "phone"] },
  ] as StaffMember[],

  appointmentTypes: [
    {
      id: "gp_standard",
      title: "GP consultation (standard)",
      durationMin: 15,
      modes: ["in_person", "video", "phone"],
      roles: ["gp"],
      locationIds: ["main", "annex"],
      description: "Standard GP appointment for a single issue.",
      autonomy: "book",
    },
    {
      id: "gp_long",
      title: "GP consultation (long)",
      durationMin: 30,
      modes: ["in_person", "video"],
      roles: ["gp"],
      locationIds: ["main", "annex"],
      description: "Longer GP appointment for multiple issues, complex history, or when an interpreter is present.",
      autonomy: "book",
    },
    {
      id: "new_patient",
      title: "New patient consultation",
      durationMin: 30,
      modes: ["in_person", "video"],
      roles: ["gp"],
      locationIds: ["main"],
      description: "Initial consultation for patients joining the clinic. Intake forms are sent beforehand.",
      autonomy: "book",
    },
    {
      id: "medication_review",
      title: "Medication review",
      durationMin: 15,
      modes: ["video", "phone", "in_person"],
      roles: ["gp", "pharmacist"],
      locationIds: ["main"],
      description:
        "Review of current and past medications with a GP or clinical pharmacist. Used when a patient reports a prior adverse experience, uncertainty about a medicine, or a new prescription alongside existing ones.",
      autonomy: "hold",
    },
    {
      id: "pathology_draw",
      title: "Blood collection (pathology)",
      durationMin: 15,
      modes: ["in_person"],
      roles: ["phlebotomist"],
      locationIds: ["pathology"],
      description: "Blood test collection. Results are typically available to the GP within 48 hours.",
      autonomy: "book",
    },
    {
      id: "results_followup",
      title: "Results follow-up",
      durationMin: 15,
      modes: ["video", "phone", "in_person"],
      roles: ["gp"],
      locationIds: ["main"],
      description: "GP follow-up to discuss test results. Must be scheduled after results are expected.",
      autonomy: "book",
      minHoursAfterPrerequisite: 72,
    },
    {
      id: "physio_initial",
      title: "Physiotherapy initial assessment",
      durationMin: 45,
      modes: ["in_person"],
      roles: ["physio"],
      locationIds: ["main", "annex"],
      description: "First physiotherapy appointment. Wheelchair users must be booked at the Main Clinic.",
      autonomy: "book",
    },
    {
      id: "nurse_review",
      title: "Nurse review (asthma / chronic condition)",
      durationMin: 20,
      modes: ["in_person", "phone"],
      roles: ["nurse"],
      locationIds: ["main"],
      description: "Practice nurse review for chronic conditions such as asthma or diabetes.",
      autonomy: "book",
    },
    {
      id: "post_discharge_followup",
      title: "Post-hospital follow-up",
      durationMin: 30,
      modes: ["in_person", "video"],
      roles: ["gp"],
      locationIds: ["main"],
      description: "GP follow-up within 7 days of a hospital discharge, including medication reconciliation.",
      autonomy: "hold",
    },
  ] as AppointmentType[],

  accommodations: [
    { id: "wheelchair", label: "Wheelchair access", offered: true, notes: "Main Clinic and Pathology only. The Annex has stairs and no lift." },
    { id: "interpreter", label: "Interpreter", offered: true, requiresNoticeHours: 48, notes: "Booked through a national interpreting service. Book a long appointment when an interpreter is present." },
    { id: "hearing_loop", label: "Hearing loop", offered: true, notes: "Available at the Main Clinic." },
    { id: "large_print", label: "Large-print materials", offered: true, notes: "Intake forms available in large print on request." },
    { id: "extended_time", label: "Extended appointment time", offered: true, notes: "Use a long consultation type." },
    { id: "home_visit", label: "Home visit", offered: false, notes: "The clinic does not currently offer home visits. Staff can discuss alternatives." },
    { id: "support_animal", label: "Assistance animal", offered: true, notes: "Assistance animals are welcome at all locations." },
  ] as Accommodation[],

  researchStudies: [
    {
      id: "study_migraine_digital",
      title: "Digital headache diary and preventive-medicine adherence study",
      coordinator: "coord_bello",
      status: "recruiting",
      summary: "Observational study for adults with migraine who take a daily preventive medicine, using a phone-based diary for 12 weeks.",
      screeningQuestions: [
        "Have you been diagnosed with migraine by a clinician?",
        "Do you currently take a daily preventive medicine for migraine?",
        "Are you comfortable using a smartphone app for 12 weeks?",
      ],
      topics: ["migraine", "headache", "propranolol", "preventive"],
    },
    {
      id: "study_med_experience_registry",
      title: "Community medication-experience registry",
      coordinator: "coord_bello",
      status: "recruiting",
      summary: "Registry collecting de-identified patient-reported experiences with common medicines, including side effects such as dizziness or rash.",
      screeningQuestions: [
        "Have you experienced a side effect from a prescribed or over-the-counter medicine in the last two years?",
        "Are you willing for a de-identified summary to be shared with the registry?",
      ],
      topics: ["side effect", "adverse", "dizziness", "rash", "registry"],
    },
    {
      id: "study_bp_remote",
      title: "Remote blood-pressure monitoring pilot",
      coordinator: "coord_bello",
      status: "closed",
      summary: "Pilot of home blood-pressure cuffs with clinic review. Recruitment closed.",
      screeningQuestions: [],
      topics: ["blood pressure", "hypertension", "amlodipine"],
    },
  ] as ResearchStudy[],

  /**
   * Red-flag rules. These are the ONLY categories that can trigger the urgent path.
   * The classifier maps patient text onto this list; it cannot invent new categories.
   */
  redFlags: [
    { id: "chest_pain", label: "Chest pain or pressure", description: "New or severe chest pain, tightness or pressure, especially with sweating, nausea or pain spreading to the arm or jaw.", examples: ["crushing chest pain", "tight chest and sweating"] },
    { id: "breathing", label: "Severe difficulty breathing", description: "Struggling to breathe, cannot speak in full sentences, lips turning blue, asthma not relieved by reliever inhaler.", examples: ["can't breathe", "inhaler not working and gasping"] },
    { id: "anaphylaxis", label: "Signs of severe allergic reaction", description: "Swelling of the face, lips, tongue or throat, widespread hives with breathing difficulty, or collapse after taking a medicine or food.", examples: ["throat swelling after taking the tablet", "lips swelling and wheezing"] },
    { id: "stroke", label: "Possible stroke", description: "Sudden facial droop, arm weakness, slurred speech, sudden confusion or loss of vision.", examples: ["face drooping", "can't lift my arm and speech is slurred"] },
    { id: "bleeding", label: "Uncontrolled bleeding", description: "Bleeding that will not stop after 10 minutes of pressure, vomiting blood, or black tarry stools in someone on a blood thinner.", examples: ["bleeding won't stop", "vomiting blood"] },
    { id: "consciousness", label: "Loss of consciousness or seizure", description: "Fainting with no quick recovery, seizure, or someone who cannot be woken.", examples: ["passed out and won't wake", "having a seizure"] },
    { id: "overdose", label: "Overdose or poisoning", description: "Taking more of a medicine than prescribed, accidental ingestion by a child, or intentional overdose.", examples: ["took the whole bottle", "child swallowed my tablets"] },
    { id: "self_harm", label: "Thoughts of self-harm or suicide", description: "Expressing intent or thoughts of ending their life or harming themselves.", examples: ["I don't want to be here anymore", "thinking of hurting myself"] },
    { id: "severe_abdominal", label: "Severe abdominal pain", description: "Sudden severe abdominal pain, rigid abdomen, or abdominal pain with fainting.", examples: ["worst stomach pain of my life", "belly pain and fainted"] },
    { id: "pregnancy_bleeding", label: "Heavy bleeding or severe pain in pregnancy", description: "Heavy vaginal bleeding or severe abdominal pain during pregnancy.", examples: ["pregnant and bleeding heavily"] },
  ] as RedFlagRule[],

  /** Clinic-approved wording. The agent shows this verbatim on the red path. */
  urgentInstruction: {
    heading: "This needs urgent medical attention",
    body:
      "Based on what you've described, please do not wait for an appointment. Call 000 now, or go to your nearest emergency department. If you are with someone, ask them to stay with you. Harbourside's team has been alerted and will follow up, but emergency services are the fastest way to get help right now.",
    callNumber: "000",
  },

  /**
   * Amber triggers: situations where the agent completes reversible preparation
   * (reserve a slot, gather evidence) and then hands the decision to staff.
   */
  amberTriggers: [
    "Patient reports a previous adverse experience (dizziness, rash, fainting, etc.) with a medicine that is the same as, or related to, one they are about to take.",
    "A medication identity could not be confirmed to exact-match quality (approximate RxNorm match or unconfirmed extraction).",
    "A new medicine is being started while the patient is on an anticoagulant, insulin, lithium, or another medicine the clinic flags as high-monitoring.",
    "Uploaded document or patient statement conflicts with the clinic record.",
    "TxGemma research signal and the official label disagree materially about a safety property that is relevant to the patient's reported experience.",
    "Patient requests a hospital-discharge follow-up (medication reconciliation is required).",
    "Patient asks a clinical question that requires a clinician's judgement (dosing, whether to stop or switch a medicine, whether a symptom is caused by a medicine).",
    "Research pre-screen where a criterion cannot be answered from the record.",
  ],

  /** Medicines the clinic treats as high-monitoring when combined with something new. */
  highMonitoringMedicines: ["warfarin", "apixaban", "rivaroxaban", "dabigatran", "insulin", "lithium", "methotrexate", "clozapine", "digoxin"],
};

export type Clinic = typeof clinic;

export function getAppointmentType(id: string): AppointmentType | undefined {
  return clinic.appointmentTypes.find((t) => t.id === id);
}
export function getLocation(id: string): Location | undefined {
  return clinic.locations.find((l) => l.id === id);
}
export function getStaff(id: string): StaffMember | undefined {
  return clinic.staff.find((s) => s.id === id);
}
