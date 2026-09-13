import type { OfficialLabel } from "@/core/types";

/**
 * openFDA drug label API — the *official* source for established warnings,
 * contraindications, adverse reactions and interactions. This is what the agent
 * quotes to staff. TxGemma never replaces this.
 */

const BASE = "https://api.fda.gov/drug/label.json";

type Raw = Record<string, unknown> & {
  openfda?: { brand_name?: string[]; generic_name?: string[]; substance_name?: string[]; route?: string[] };
  set_id?: string;
  effective_time?: string;
};

function first(v: unknown, max = 1800): string | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  const s = String(v[0]).replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max) + " …" : s;
}

async function search(query: string, limit = 10): Promise<Raw[]> {
  const url = `${BASE}?search=${encodeURIComponent(query)}&limit=${limit}`;
  const res = await fetch(url);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`openFDA ${res.status}`);
  const json = (await res.json()) as { results?: Raw[] };
  return json.results ?? [];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const STOP = new Set(["hydrochloride", "hcl", "hydrobromide", "hbr", "sodium", "sulfate", "trihydrate", "and", "as"]);
const words = (s: string) => new Set(norm(s).split(" ").filter((w) => w && !STOP.has(w)));

/**
 * Score a label for how well it represents *this* ingredient: it must contain the
 * ingredient, and we prefer labels with the fewest *other* ingredients (a single-agent
 * promethazine label beats a 3-in-1 cold remedy), with prescription-grade sections present.
 */
function score(raw: Raw, ingredient: string): number {
  const generic = (raw.openfda?.generic_name ?? []).join(" ");
  const substance = (raw.openfda?.substance_name ?? []).join(" ");
  const g = words(generic);
  const ing = words(ingredient);
  const containsAll = [...ing].every((w) => g.has(w) || words(substance).has(w));
  if (!containsAll) return -1;
  let s = 100 - Math.max(0, g.size - ing.size) * 20; // penalise extra ingredients
  if (raw.adverse_reactions) s += 15;
  if (raw.drug_interactions) s += 10;
  if (raw.contraindications) s += 5;
  if (raw.boxed_warning) s += 3;
  if (raw.warnings || raw.warnings_and_cautions) s += 3;
  return s;
}

function toLabel(raw: Raw): OfficialLabel {
  return {
    source: "openFDA",
    setId: raw.set_id,
    effectiveTime: raw.effective_time,
    brandName: raw.openfda?.brand_name?.[0],
    genericName: raw.openfda?.generic_name?.[0],
    boxedWarning: first(raw.boxed_warning),
    warnings: first(raw.warnings),
    warningsAndCautions: first(raw.warnings_and_cautions),
    contraindications: first(raw.contraindications),
    adverseReactions: first(raw.adverse_reactions),
    drugInteractions: first(raw.drug_interactions),
    indicationsAndUsage: first(raw.indications_and_usage, 600),
  };
}

export async function officialLabelForIngredient(ingredient: string, brand?: string): Promise<OfficialLabel | null> {
  const base = ingredient.split(" ")[0];
  const queries = [
    `openfda.generic_name:"${ingredient}"`,
    `openfda.substance_name:"${ingredient}"`,
    ...(base !== ingredient ? [`openfda.generic_name:"${base}"`] : []),
    ...(brand ? [`openfda.brand_name:"${brand}"`] : []),
  ];
  const seen = new Set<string>();
  let best: { raw: Raw; s: number } | null = null;
  for (const q of queries) {
    const results = await search(q).catch(() => []);
    for (const raw of results) {
      if (raw.set_id && seen.has(raw.set_id)) continue;
      if (raw.set_id) seen.add(raw.set_id);
      const s = score(raw, ingredient);
      if (s > (best?.s ?? -1)) best = { raw, s };
    }
    if (best && best.s >= 110) break; // good single-agent label with full sections
  }
  return best ? toLabel(best.raw) : null;
}
