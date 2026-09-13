import type { PubChemRecord } from "@/core/types";

/**
 * NIH PubChem PUG REST — the molecular identity behind an ingredient name.
 * Gives us the canonical SMILES that TxGemma consumes.
 */

const BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug";

export async function pubchemByName(name: string): Promise<PubChemRecord | null> {
  const props = "SMILES,ConnectivitySMILES,MolecularFormula,MolecularWeight,IUPACName,Title";
  const url = `${BASE}/compound/name/${encodeURIComponent(name)}/property/${props}/JSON`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`PubChem ${res.status} for ${name}`);
  const json = (await res.json()) as {
    PropertyTable?: { Properties?: Record<string, string | number>[] };
  };
  const p = json.PropertyTable?.Properties?.[0];
  if (!p) return null;
  const smiles = (p.SMILES ?? p.ConnectivitySMILES ?? p.CanonicalSMILES) as string | undefined;
  if (!smiles) return null;
  return {
    cid: Number(p.CID),
    canonicalSmiles: smiles,
    molecularFormula: p.MolecularFormula as string | undefined,
    molecularWeight: p.MolecularWeight !== undefined ? Number(p.MolecularWeight) : undefined,
    iupacName: p.IUPACName as string | undefined,
    title: p.Title as string | undefined,
  };
}

/**
 * Salt forms ("promethazine hydrochloride") resolve in PubChem to the salt, whose SMILES
 * includes the counter-ion. For molecular-property prediction we want the parent compound,
 * so try the base name first when the ingredient looks like a salt.
 */
export async function pubchemForIngredient(ingredient: string): Promise<PubChemRecord | null> {
  const base = stripSalt(ingredient);
  const tries = base !== ingredient ? [base, ingredient] : [ingredient];
  for (const t of tries) {
    const rec = await pubchemByName(t);
    if (rec) return rec;
  }
  return null;
}

const SALTS = [
  "hydrochloride", "hcl", "hydrobromide", "hbr", "sulfate", "sulphate", "sodium", "potassium", "calcium",
  "maleate", "tartrate", "citrate", "mesylate", "besylate", "acetate", "phosphate", "succinate", "fumarate",
  "propionate", "trihydrate", "monohydrate", "dihydrate", "anhydrous", "hemihydrate",
];

export function stripSalt(name: string): string {
  const words = name.toLowerCase().replace(/[(),]/g, " ").split(/\s+/).filter(Boolean);
  const kept = words.filter((w) => !SALTS.includes(w));
  return kept.join(" ").trim() || name;
}
