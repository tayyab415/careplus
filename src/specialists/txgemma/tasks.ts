import prompts from "./tdc_prompts.json";

/**
 * Curated Therapeutics Data Commons tasks that TxGemma-predict was trained on and
 * that are meaningful as *research context* for a clinic case. The prompt text is the
 * official TDC template shipped by Google (gs://healthai-us/txgemma/templates); we only
 * substitute the SMILES. Never edit the template text.
 */

export type TaskKind = "classification" | "regression";

export interface TdcTask {
  id: keyof typeof prompts;
  label: string;
  kind: TaskKind;
  /** For classification: meaning of option A / B in plain language. */
  options?: { A: string; B: string };
  /** Which patient-reported themes make this task relevant. */
  themes: string[];
  regressionUnit?: string;
}

export const TASKS: TdcTask[] = [
  { id: "BBB_Martins", label: "Blood-brain barrier penetration", kind: "classification", options: { A: "predicted not to cross the blood-brain barrier", B: "predicted to cross the blood-brain barrier" }, themes: ["dizziness", "drowsiness", "sedation", "confusion", "headache", "cns", "sleep", "vertigo", "lethargy", "fatigue"] },
  { id: "ClinTox", label: "Clinical-trial toxicity", kind: "classification", options: { A: "predicted not toxic (ClinTox class)", B: "predicted toxic (ClinTox class)" }, themes: ["*"] },
  { id: "hERG", label: "hERG channel blockade (cardiac)", kind: "classification", options: { A: "predicted not to block hERG", B: "predicted to block hERG" }, themes: ["palpitations", "heart", "cardiac", "fainting", "arrhythmia", "syncope", "racing"] },
  { id: "DILI", label: "Drug-induced liver injury", kind: "classification", options: { A: "predicted not to cause DILI", B: "predicted able to cause DILI" }, themes: ["liver", "jaundice", "nausea", "abdominal", "yellow"] },
  { id: "Skin_Reaction", label: "Skin sensitisation", kind: "classification", options: { A: "predicted not to cause a skin reaction", B: "predicted to cause a skin reaction" }, themes: ["rash", "itch", "hives", "skin", "urticaria", "eczema"] },
  { id: "AMES", label: "Mutagenicity (Ames)", kind: "classification", options: { A: "predicted not mutagenic", B: "predicted mutagenic" }, themes: [] },
  { id: "CYP2D6_Veith", label: "CYP2D6 inhibition", kind: "classification", options: { A: "predicted not to inhibit CYP2D6", B: "predicted to inhibit CYP2D6" }, themes: ["interaction", "metoprolol", "codeine", "tramadol", "antidepressant", "multiple medicines"] },
  { id: "CYP3A4_Veith", label: "CYP3A4 inhibition", kind: "classification", options: { A: "predicted not to inhibit CYP3A4", B: "predicted to inhibit CYP3A4" }, themes: ["interaction", "statin", "atorvastatin", "warfarin", "multiple medicines"] },
  { id: "CYP2C9_Veith", label: "CYP2C9 inhibition", kind: "classification", options: { A: "predicted not to inhibit CYP2C9", B: "predicted to inhibit CYP2C9" }, themes: ["warfarin", "interaction", "anticoagulant"] },
  { id: "Pgp_Broccatelli", label: "P-glycoprotein inhibition", kind: "classification", options: { A: "predicted not a P-gp inhibitor", B: "predicted P-gp inhibitor" }, themes: ["interaction", "digoxin", "brain"] },
  { id: "Half_Life_Obach", label: "Half-life (normalised)", kind: "regression", themes: [], regressionUnit: "0–1000 normalised" },
  { id: "Bioavailability_Ma", label: "Oral bioavailability ≥ 20%", kind: "classification", options: { A: "predicted oral bioavailability < 20%", B: "predicted oral bioavailability ≥ 20%" }, themes: [] },
  { id: "HIA_Hou", label: "Human intestinal absorption", kind: "classification", options: { A: "predicted poorly absorbed", B: "predicted absorbed" }, themes: [] },
  { id: "PPBR_AZ", label: "Plasma protein binding (normalised)", kind: "regression", themes: [], regressionUnit: "0–1000 normalised" },
  { id: "LD50_Zhu", label: "Acute toxicity LD50 (normalised)", kind: "regression", themes: [], regressionUnit: "0–1000 normalised (higher = less lethal)" },
];

export function taskById(id: string): TdcTask | undefined {
  return TASKS.find((t) => t.id === id);
}

export function promptFor(task: TdcTask, smiles: string): string {
  const template = prompts[task.id] as string;
  return template.replace("{Drug SMILES}", smiles);
}

/**
 * Pick the TDC tasks that are relevant to what the patient reported.
 * Always includes ClinTox as a general marker; adds themed tasks; caps the count so a
 * turn stays fast on a single L4.
 */
export function selectTasks(themesText: string, opts: { max?: number; always?: string[] } = {}): TdcTask[] {
  const text = themesText.toLowerCase();
  const chosen = new Map<string, TdcTask>();
  for (const id of opts.always ?? ["ClinTox"]) {
    const t = taskById(id);
    if (t) chosen.set(t.id, t);
  }
  for (const t of TASKS) {
    if (t.themes.some((th) => th !== "*" && text.includes(th))) chosen.set(t.id, t);
  }
  return [...chosen.values()].slice(0, opts.max ?? 4);
}
