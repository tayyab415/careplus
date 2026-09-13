import { env } from "@/config/env";
import { googleFetch } from "@/llm/google";
import type { TxGemmaSignal } from "@/core/types";
import { nowIso } from "@/core/ids";
import { promptFor, selectTasks, taskById, type TdcTask } from "./tasks";

export const TXGEMMA_DISCLAIMER =
  "TxGemma output is a molecular research signal from a model trained on public benchmark datasets. It is not a clinical assessment, does not establish causation, and must not be used for diagnosis, dosing or treatment decisions. Official label information and clinician judgement take precedence.";

export class TxGemmaUnavailable extends Error {}

function endpointUrl() {
  if (!env.txgemmaEndpointId) throw new TxGemmaUnavailable("TXGEMMA_ENDPOINT_ID not configured");
  const loc = env.txgemmaLocation;
  // Model Garden deployments use a *dedicated* endpoint with its own DNS name.
  const host = env.txgemmaDedicatedDns || `${loc}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${env.gcpProject}/locations/${loc}/endpoints/${env.txgemmaEndpointId}:predict`;
}

/** Raw call: one or more TDC prompts → model completions (usually "(A)" / "(B)" / "0xx"). */
export async function txgemmaPredictRaw(prompts: string[], maxTokens = 8): Promise<string[]> {
  const res = await googleFetch(endpointUrl(), {
    method: "POST",
    body: JSON.stringify({
      instances: prompts.map((prompt) => ({ prompt, max_tokens: maxTokens, temperature: 0 })),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new TxGemmaUnavailable(`TxGemma endpoint ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { predictions?: unknown[] };
  return (json.predictions ?? []).map((p) => {
    if (typeof p === "string") return p;
    if (p && typeof p === "object") {
      const o = p as Record<string, unknown>;
      // vLLM-serve variants return {"output": ...} or {"generated_text": ...}
      return String(o.output ?? o.generated_text ?? o.text ?? JSON.stringify(o));
    }
    return String(p);
  });
}

/**
 * vLLM echo behaviour: some containers return prompt + completion. Strip the prompt
 * and normalise to the answer portion.
 */
function extractAnswer(raw: string, prompt: string): string {
  // The container returns literal "\n" sequences rather than newlines.
  let s = raw.replace(/\\n/g, "\n");
  // pytorch-vllm-serve echoes: "Prompt:\n{prompt}\nOutput:\n{completion}"
  const out = s.lastIndexOf("Output:");
  if (out >= 0) s = s.slice(out + "Output:".length);
  else {
    if (s.startsWith(prompt)) s = s.slice(prompt.length);
    const idx = s.lastIndexOf("Answer:");
    if (idx >= 0) s = s.slice(idx + "Answer:".length);
  }
  const firstLine = s
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return (firstLine ?? "").replace(/["'\]\}]+$/g, "").trim();
}

export function parseSignal(task: TdcTask, ingredient: string, smiles: string, prompt: string, raw: string, latencyMs: number): TxGemmaSignal {
  const answer = extractAnswer(raw, prompt);
  const base = {
    task: task.id,
    taskLabel: task.label,
    ingredient,
    smiles,
    prompt,
    rawOutput: answer,
    model: "txgemma-2b-predict",
    latencyMs,
    at: nowIso(),
    disclaimer: TXGEMMA_DISCLAIMER,
  };
  if (task.kind === "classification") {
    const m = answer.match(/\(?\b([AB])\b\)?/);
    const choice = (m?.[1] as "A" | "B" | undefined) ?? undefined;
    return {
      ...base,
      kind: "classification",
      choice,
      meaning: choice && task.options ? task.options[choice] : `Unparsed model output: "${answer}"`,
    };
  }
  const num = answer.match(/\d{1,4}/);
  const value = num ? Number(num[0]) : undefined;
  return {
    ...base,
    kind: "regression",
    value,
    meaning: value !== undefined ? `${task.label}: ${value} (${task.regressionUnit ?? "normalised"})` : `Unparsed model output: "${answer}"`,
  };
}

/**
 * Run a set of TDC tasks for one molecule. This is *the* TxGemma specialist call.
 * The coordinator decides *when* to call it; this function decides *how*.
 */
export async function runTxGemma(input: {
  ingredient: string;
  smiles: string;
  /** Free text of what the patient reported — used to choose relevant tasks. */
  reportedThemes: string;
  /** Explicit task ids override theme selection. */
  taskIds?: string[];
  maxTasks?: number;
}): Promise<TxGemmaSignal[]> {
  const tasks = input.taskIds?.length
    ? (input.taskIds.map(taskById).filter(Boolean) as TdcTask[])
    : selectTasks(input.reportedThemes, { max: input.maxTasks ?? 4 });
  if (tasks.length === 0) return [];
  const prompts = tasks.map((t) => promptFor(t, input.smiles));
  const t0 = Date.now();
  const raws = await txgemmaPredictRaw(prompts);
  const latency = Date.now() - t0;
  return tasks.map((t, i) => parseSignal(t, input.ingredient, input.smiles, prompts[i], raws[i] ?? "", Math.round(latency / tasks.length)));
}
