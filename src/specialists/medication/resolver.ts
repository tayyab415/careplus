import type { ResolvedMedication } from "@/core/types";
import { nowIso, shortId } from "@/core/ids";
import { rxApproximate, rxProperties, rxRelated } from "./rxnorm";
import { pubchemForIngredient, stripSalt } from "./pubchem";
import { officialLabelForIngredient } from "./openfda";

/**
 * Medication identity service.
 *   name / label text  →  RxNorm concept (brand, generic, ingredients, dose form)
 *                      →  PubChem molecule per ingredient (CID, SMILES)
 *                      →  openFDA official label for the primary ingredient
 *
 * Everything here is `database_verified` provenance. Nothing is predicted.
 */
export async function resolveMedication(input: {
  name: string;
  /** Extra hints from a label: ingredients, strength, form. */
  ingredients?: string[];
  strength?: string | null;
  dosageForm?: string | null;
}): Promise<ResolvedMedication> {
  const query = input.name.trim();
  const resolved: ResolvedMedication = {
    id: shortId("med"),
    queryName: query,
    ingredients: [],
    brandNames: [],
    molecules: [],
    labels: [],
    matchQuality: "unresolved",
    resolvedAt: nowIso(),
    strength: input.strength ?? undefined,
    dosageForm: input.dosageForm ?? undefined,
  };

  // 1. RxNorm — try the full label text first, then the ingredient list.
  const candidates = await rxApproximate(query, 5).catch(() => []);
  let best = candidates[0];
  if (!best && input.ingredients?.length) {
    const alt = await rxApproximate(input.ingredients.join(" / "), 5).catch(() => []);
    best = alt[0];
  }

  if (best) {
    const props = await rxProperties(best.rxcui).catch(() => null);
    resolved.rxcui = best.rxcui;
    resolved.rxnormName = props?.name ?? best.name;
    resolved.termType = props?.tty;
    // Score heuristics from RxNav: high score & rank 1 → exact-ish.
    resolved.matchQuality = best.score >= 15 || best.rank === 1 ? "exact" : "approximate";
    if (best.score < 8) resolved.matchQuality = "approximate";

    const related = await rxRelated(best.rxcui, ["IN", "BN", "DF"]).catch(() => ({}) as Record<string, { name: string; rxcui: string }[]>);
    resolved.ingredients = (related.IN ?? []).map((c) => ({ name: c.name, rxcui: c.rxcui }));
    resolved.brandNames = (related.BN ?? []).map((c) => c.name).slice(0, 6);
    // Only trust RxNorm's dose form when the match is a specific product; an ingredient
    // concept (e.g. "ibuprofen") relates to every form, and the first one is arbitrary.
    const productTtys = ["SCD", "SBD", "GPCK", "BPCK", "SCDF", "SBDF", "SCDG", "SBDG"];
    if (!resolved.dosageForm && related.DF?.[0] && props?.tty && productTtys.includes(props.tty)) resolved.dosageForm = related.DF[0].name;
    // If the concept itself is an ingredient, use it.
    if (resolved.ingredients.length === 0 && props?.tty === "IN") {
      resolved.ingredients = [{ name: props.name, rxcui: props.rxcui }];
    }
  }

  // Fall back to label-provided ingredients when RxNorm gave none — but normalise each
  // one to its RxNorm ingredient concept ("Promethazine HCl" → "promethazine").
  if (resolved.ingredients.length === 0 && input.ingredients?.length) {
    for (const raw of input.ingredients) {
      const cands = await rxApproximate(stripSalt(raw), 3).catch(() => []);
      let normalised: { name: string; rxcui?: string } = { name: raw };
      for (const c of cands) {
        const props = await rxProperties(c.rxcui).catch(() => null);
        if (props?.tty === "IN" || props?.tty === "PIN") {
          normalised = { name: props.name, rxcui: props.rxcui };
          break;
        }
        const rel = await rxRelated(c.rxcui, ["IN"]).catch(() => ({}) as Record<string, { name: string; rxcui: string }[]>);
        if (rel.IN?.[0]) {
          normalised = { name: rel.IN[0].name, rxcui: rel.IN[0].rxcui };
          break;
        }
      }
      resolved.ingredients.push(normalised);
    }
    if (resolved.matchQuality === "unresolved") resolved.matchQuality = "approximate";
  }

  // 2. PubChem per ingredient.
  for (const ing of resolved.ingredients.slice(0, 3)) {
    const rec = await pubchemForIngredient(ing.name).catch(() => null);
    if (rec) resolved.molecules.push({ ingredient: ing.name, pubchem: rec });
  }

  // 3. Official label(s) — one per ingredient so a combination product still yields the
  //    single-agent label for whichever ingredient matters to the case.
  resolved.labels = [];
  for (const ing of resolved.ingredients.slice(0, 3)) {
    const label = await officialLabelForIngredient(ing.name).catch(() => null);
    if (label) resolved.labels.push({ ingredient: ing.name, label });
  }
  resolved.label = resolved.labels[0]?.label;

  return resolved;
}
