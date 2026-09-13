import { LabelExtraction } from "@/core/types";
import { geminiJson } from "@/llm/gemini";
import { env } from "@/config/env";

const SYSTEM = `You are a careful pharmacy-label reader for a clinic's coordination assistant.
You extract what is *printed* on a medicine bottle, pharmacy label, blister pack, prescription or discharge document.

Rules:
- Only report text you can actually read. Never guess a drug name from the shape or colour of a product.
- If a field is not visible, return null for it.
- activeIngredients: list each active ingredient exactly as printed (e.g. "Promethazine Hydrochloride", "Dextromethorphan Hydrobromide"). Do not add ingredients that are not printed.
- strength: as printed (e.g. "6.25 mg / 15 mg per 5 mL").
- confidence: your honest 0-1 estimate that productName and activeIngredients are read correctly. Blurry, partial, or handwritten text lowers confidence.
- warnings: anything the clinic should know about the *reading* — glare, cut-off text, multiple products in frame, label appears to belong to a different person, expired date, etc.
- rawText: the full text you can read, line by line.
- You are not assessing safety or suitability. You are reading a label.`;

const JSON_SCHEMA = {
  type: "object",
  properties: {
    documentKind: { type: "string", enum: ["pharmacy_label", "bottle", "blister_pack", "prescription", "discharge_summary", "other"] },
    productName: { type: "string", nullable: true },
    activeIngredients: { type: "array", items: { type: "string" } },
    strength: { type: "string", nullable: true },
    dosageForm: { type: "string", nullable: true },
    directions: { type: "string", nullable: true },
    prescriptionDate: { type: "string", nullable: true },
    prescriber: { type: "string", nullable: true },
    pharmacy: { type: "string", nullable: true },
    patientNameOnLabel: { type: "string", nullable: true },
    ndc: { type: "string", nullable: true },
    rawText: { type: "string" },
    confidence: { type: "number" },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["documentKind", "productName", "activeIngredients", "strength", "dosageForm", "directions", "prescriptionDate", "prescriber", "pharmacy", "patientNameOnLabel", "ndc", "rawText", "confidence", "warnings"],
};

/** Extract structured medication details from an uploaded image (base64) or PDF. */
export async function extractLabel(input: { mimeType: string; base64: string; hint?: string }) {
  const extraction = await geminiJson(
    LabelExtraction,
    [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: input.mimeType, data: input.base64 } },
          {
            text:
              (input.hint ? `Context from the patient: ${input.hint}\n\n` : "") +
              "Read this document and return the JSON described. Return null for anything you cannot read.",
          },
        ],
      },
    ],
    { model: env.visionModel, system: SYSTEM, jsonSchema: JSON_SCHEMA, maxOutputTokens: 2048 },
  );
  // Clamp confidence defensively.
  extraction.confidence = Math.max(0, Math.min(1, extraction.confidence));
  return extraction;
}
