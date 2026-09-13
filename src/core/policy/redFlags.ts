import { z } from "zod";
import { clinic } from "@/data/clinic";
import { geminiJson } from "@/llm/gemini";

export interface RedFlagResult {
  flagged: boolean;
  ruleId?: string;
  ruleLabel?: string;
  /** Which layer caught it. */
  by?: "keyword" | "classifier";
  evidence?: string;
}

/**
 * Deterministic keyword pass. Fast and auditable. Conservative on purpose: it only
 * fires on phrases that almost always mean an emergency.
 */
const KEYWORDS: { ruleId: string; patterns: RegExp[] }[] = [
  { ruleId: "chest_pain", patterns: [/\bcrushing chest\b/i, /\bchest (pain|pressure|tightness)\b.*\b(sweat|arm|jaw|now|right now)\b/i, /\bheart attack\b/i] },
  { ruleId: "breathing", patterns: [/\bcan(?:'|no)?t breathe\b/i, /\bgasping\b/i, /\blips (are )?(blue|turning blue)\b/i, /\bstruggling to breathe\b/i] },
  { ruleId: "anaphylaxis", patterns: [/\b(throat|tongue|face|lips?) (is |are )?swelling\b/i, /\bswelling (of )?(my )?(throat|tongue|face|lips)\b/i, /\banaphyla/i] },
  { ruleId: "stroke", patterns: [/\bface (is )?droop/i, /\bslurred speech\b/i, /\bcan(?:'|no)?t (lift|move) (my )?arm\b/i, /\bstroke\b/i] },
  { ruleId: "bleeding", patterns: [/\bbleeding (that )?(won(?:'|no)?t|will not|doesn(?:'|no)?t) stop\b/i, /\bvomit(ing|ed)? blood\b/i, /\bblack (tarry )?stools?\b/i] },
  { ruleId: "consciousness", patterns: [/\bpassed out\b/i, /\bunconscious\b/i, /\bseizure\b/i, /\bwon(?:'|no)?t wake\b/i] },
  { ruleId: "overdose", patterns: [/\boverdose/i, /\btook (the )?(whole|entire) (bottle|pack|box)\b/i, /\b(child|kid|toddler|baby) (swallowed|ate|took) /i] },
  { ruleId: "self_harm", patterns: [/\b(kill|hurt|harm) myself\b/i, /\bend (my|it all)\b/i, /\bsuicid/i, /\bdon(?:'|no)?t want to (be here|live)\b/i] },
  { ruleId: "severe_abdominal", patterns: [/\bworst (stomach|belly|abdominal) pain\b/i, /\brigid (abdomen|belly)\b/i] },
  { ruleId: "pregnancy_bleeding", patterns: [/\bpregnan\w*\b.*\b(bleeding heavily|heavy bleeding|severe pain)\b/i, /\b(bleeding heavily|heavy bleeding)\b.*\bpregnan/i] },
];

export function keywordRedFlag(text: string): RedFlagResult {
  for (const k of KEYWORDS) {
    for (const p of k.patterns) {
      const m = text.match(p);
      if (m) {
        const rule = clinic.redFlags.find((r) => r.id === k.ruleId)!;
        return { flagged: true, ruleId: rule.id, ruleLabel: rule.label, by: "keyword", evidence: m[0] };
      }
    }
  }
  return { flagged: false };
}

const ClassifierOut = z.object({
  ruleId: z.string().nullable(),
  isCurrentEmergency: z.boolean(),
  evidence: z.string(),
});

/**
 * Classifier pass. The model may ONLY choose from the clinic's rule list, and must
 * distinguish a *current* emergency from a *historical* mention ("last year I fainted").
 * Historical mentions are not red; they are amber material for the coordinator.
 */
export async function classifyRedFlag(text: string): Promise<RedFlagResult> {
  const rules = clinic.redFlags.map((r) => `- ${r.id}: ${r.label}. ${r.description}`).join("\n");
  const out = await geminiJson(
    ClassifierOut,
    [
      {
        role: "user",
        parts: [
          {
            text: `Patient message to a clinic assistant:\n"""${text}"""\n\nClinic red-flag rules (the ONLY allowed categories):\n${rules}\n\nDecide: does this message describe a CURRENT emergency matching one of these rules? Historical events ("last year", "once", "in June") are NOT current. Questions about a medicine are NOT emergencies. Return ruleId (or null), isCurrentEmergency, and the exact phrase that is the evidence.`,
          },
        ],
      },
    ],
    {
      jsonSchema: {
        type: "object",
        properties: {
          ruleId: { type: "string", nullable: true },
          isCurrentEmergency: { type: "boolean" },
          evidence: { type: "string" },
        },
        required: ["ruleId", "isCurrentEmergency", "evidence"],
      },
      maxOutputTokens: 200,
      thinkingBudget: 0,
    },
  ).catch(() => null);

  if (!out || !out.isCurrentEmergency || !out.ruleId) return { flagged: false };
  const rule = clinic.redFlags.find((r) => r.id === out.ruleId);
  if (!rule) return { flagged: false }; // model invented a category → ignore
  return { flagged: true, ruleId: rule.id, ruleLabel: rule.label, by: "classifier", evidence: out.evidence };
}

/** Full screen: keywords first (deterministic), then classifier for nuance. */
export async function screenRedFlags(text: string): Promise<RedFlagResult> {
  const kw = keywordRedFlag(text);
  if (kw.flagged) {
    // Keywords can misfire on historical mentions ("I passed out last year"). Let the
    // classifier confirm currency when the text clearly references the past.
    if (/\b(last (year|month|week|time)|ago|once|previously|in (january|february|march|april|may|june|july|august|september|october|november|december) \d{4}|back in)\b/i.test(text)) {
      const c = await classifyRedFlag(text);
      return c.flagged ? c : { flagged: false };
    }
    return kw;
  }
  return classifyRedFlag(text);
}
