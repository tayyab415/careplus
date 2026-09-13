import { getStore } from "@/core/store";
import { ensureSeeded, errorResponse, json } from "@/server/bootstrap";
import { integrationStatus } from "@/config/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Exception console data: open + recent reviews, and a compact case list. */
export async function GET() {
  try {
    await ensureSeeded();
    const store = getStore();
    const [reviews, cases, patients] = await Promise.all([store.listReviews(), store.listCases(), store.listPatients()]);
    const names = new Map(patients.map((p) => [p.id, p.name]));
    return json({
      reviews: reviews
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((r) => ({ ...r, patientName: names.get(r.patientId) ?? r.patientId })),
      cases: cases
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((c) => ({
          id: c.id,
          patientId: c.patientId,
          patientName: names.get(c.patientId) ?? c.patientId,
          title: c.title,
          status: c.status,
          tier: c.tier,
          outcome: c.outcome,
          updatedAt: c.updatedAt,
          createdAt: c.createdAt,
          pendingStaffQuestions: c.pendingStaffQuestions.length,
          txgemmaSignals: c.txgemmaSignals.length,
        })),
      integrations: integrationStatus(),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
