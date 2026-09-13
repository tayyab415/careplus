import { z } from "zod";
import { env } from "@/config/env";
import { googleFetch } from "./google";

/**
 * Minimal Gemini-on-Vertex client (REST). Used for the *fast* specialist jobs:
 * vision extraction, red-flag classification, transcription, summaries.
 * The coordinator LLM lives in ./openai.ts.
 */

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { mimeType: string; fileUri: string } };

export interface GeminiMessage {
  role: "user" | "model";
  parts: GeminiPart[];
}

export interface GeminiOptions {
  model?: string;
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** When provided, forces JSON output conforming to the schema. */
  responseSchema?: Record<string, unknown>;
  thinkingBudget?: number;
}

function endpointFor(model: string) {
  // Gemini 3.x models are served from the global endpoint; older ones are regional.
  const isGlobal = model.startsWith("gemini-3");
  const host = isGlobal ? "aiplatform.googleapis.com" : `${env.gcpLocation}-aiplatform.googleapis.com`;
  const loc = isGlobal ? "global" : env.gcpLocation;
  return `https://${host}/v1/projects/${env.gcpProject}/locations/${loc}/publishers/google/models/${model}:generateContent`;
}

export async function geminiGenerate(messages: GeminiMessage[], opts: GeminiOptions = {}): Promise<string> {
  const model = opts.model ?? env.fastModel;
  const body: Record<string, unknown> = {
    contents: messages,
    generationConfig: {
      temperature: opts.temperature ?? 0.2,
      maxOutputTokens: opts.maxOutputTokens ?? 2048,
      ...(opts.responseSchema
        ? { responseMimeType: "application/json", responseSchema: opts.responseSchema }
        : {}),
      ...(opts.thinkingBudget !== undefined ? { thinkingConfig: { thinkingBudget: opts.thinkingBudget } } : {}),
    },
  };
  if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };

  // Vertex quota is bursty (429/503 during a multi-tool turn); back off and retry.
  let res: Response | null = null;
  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await googleFetch(endpointFor(model), { method: "POST", body: JSON.stringify(body) });
    if (res.ok) break;
    lastErr = `Gemini ${model} failed (${res.status}): ${(await res.text()).slice(0, 500)}`;
    if (![429, 500, 503].includes(res.status) || attempt === 3) throw new Error(lastErr);
    await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt + Math.random() * 500));
  }
  if (!res || !res.ok) throw new Error(lastErr || "Gemini request failed");
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? "").join("");
}

/** Generate and parse JSON validated against a zod schema. Retries once on parse failure. */
export async function geminiJson<T>(
  schema: z.ZodType<T>,
  messages: GeminiMessage[],
  opts: GeminiOptions & { jsonSchema: Record<string, unknown> },
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await geminiGenerate(messages, { ...opts, responseSchema: opts.jsonSchema, temperature: 0.1 });
    try {
      const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      return schema.parse(JSON.parse(cleaned));
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Gemini JSON parse failed: ${String(lastErr)}`);
}
