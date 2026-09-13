/**
 * RxNorm (US National Library of Medicine) — authoritative medication terminology.
 * Free, no key. Used to normalise brand / generic / ingredient / dose form.
 */

const BASE = "https://rxnav.nlm.nih.gov/REST";

export interface RxCandidate {
  rxcui: string;
  name: string;
  score: number;
  rank: number;
  source: string;
}

export interface RxConcept {
  rxcui: string;
  name: string;
  tty: string;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`RxNorm ${res.status} for ${url}`);
  return (await res.json()) as T;
}

export async function rxApproximate(term: string, maxEntries = 5): Promise<RxCandidate[]> {
  const url = `${BASE}/approximateTerm.json?term=${encodeURIComponent(term)}&maxEntries=${maxEntries}`;
  const json = await getJson<{ approximateGroup?: { candidate?: Record<string, string>[] } }>(url);
  const cands = json.approximateGroup?.candidate ?? [];
  // De-duplicate on rxcui, keep the best-scoring.
  const seen = new Map<string, RxCandidate>();
  for (const c of cands) {
    const rxcui = c.rxcui;
    if (!rxcui) continue;
    const cand: RxCandidate = {
      rxcui,
      name: c.name ?? "",
      score: Number(c.score ?? 0),
      rank: Number(c.rank ?? 99),
      source: c.source ?? "",
    };
    if (!seen.has(rxcui) || seen.get(rxcui)!.score < cand.score) seen.set(rxcui, cand);
  }
  return [...seen.values()].sort((a, b) => b.score - a.score);
}

export async function rxProperties(rxcui: string): Promise<RxConcept | null> {
  const json = await getJson<{ properties?: { rxcui: string; name: string; tty: string } }>(
    `${BASE}/rxcui/${rxcui}/properties.json`,
  );
  return json.properties ? { rxcui: json.properties.rxcui, name: json.properties.name, tty: json.properties.tty } : null;
}

/** Related concepts by term type. IN = ingredient, BN = brand name, DF = dose form, SCD = clinical drug, PIN = precise ingredient. */
export async function rxRelated(rxcui: string, ttys: string[]): Promise<Record<string, RxConcept[]>> {
  const json = await getJson<{
    relatedGroup?: { conceptGroup?: { tty: string; conceptProperties?: { rxcui: string; name: string; tty: string }[] }[] };
  }>(`${BASE}/rxcui/${rxcui}/related.json?tty=${ttys.join("+")}`);
  const out: Record<string, RxConcept[]> = {};
  for (const g of json.relatedGroup?.conceptGroup ?? []) {
    out[g.tty] = (g.conceptProperties ?? []).map((c) => ({ rxcui: c.rxcui, name: c.name, tty: c.tty }));
  }
  return out;
}
