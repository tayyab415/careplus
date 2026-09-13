import { getStore } from "@/core/store";
import { ensureSeeded, errorResponse, json } from "@/server/bootstrap";
import { clinic } from "@/data/clinic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Research-coordinator view. Deliberately de-identified: study interest, pre-screen
 * answers and the case reference only — no names, no conversation, no clinical queue.
 */
export async function GET() {
  try {
    await ensureSeeded();
    const store = getStore();
    const cases = await store.listCases();
    const prescreens = cases
      .filter((c) => c.researchPrescreen)
      .map((c) => {
        let parsed: { answers?: unknown; notes?: string | null } = {};
        try {
          parsed = JSON.parse(c.researchPrescreen!.notes ?? "{}");
        } catch {
          /* ignore */
        }
        return {
          caseId: c.id,
          patientRef: `${c.patientId.slice(0, 3)}-•••${c.patientId.slice(-2)}`,
          topic: c.researchPrescreen!.topic,
          status: c.researchPrescreen!.status,
          consented: c.researchPrescreen!.consented,
          answers: parsed.answers ?? null,
          notes: parsed.notes ?? null,
          updatedAt: c.updatedAt,
        };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    // Recurring, de-identified medication concerns across all cases (counts only).
    const concernCounts = new Map<string, number>();
    for (const c of cases) {
      for (const s of c.txgemmaSignals) {
        const key = `${s.ingredient} · ${s.taskLabel}`;
        concernCounts.set(key, (concernCounts.get(key) ?? 0) + 1);
      }
    }
    const signals = Array.from(concernCounts.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    return json({ studies: clinic.researchStudies, prescreens, signals });
  } catch (e) {
    return errorResponse(e);
  }
}
