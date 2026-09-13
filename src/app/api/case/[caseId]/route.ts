import { getStore } from "@/core/store";
import { ensureSeeded, errorResponse, json } from "@/server/bootstrap";
import { evidencePreviewUrl } from "@/actions/evidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Full case view: conversation, trace, side effects. Used by the portal (polling) and staff console. */
export async function GET(_req: Request, ctx: { params: Promise<{ caseId: string }> }) {
  try {
    await ensureSeeded();
    const { caseId } = await ctx.params;
    const store = getStore();
    const c = await store.getCase(caseId);
    if (!c) return json({ error: "Unknown case" }, { status: 404 });
    const [communications, appointments, reviews, patient, medications] = await Promise.all([
      store.listCommunications({ caseId }),
      store.listAppointments({ caseId }),
      store.listReviews({ caseId }),
      store.getPatient(c.patientId),
      Promise.all(c.medicationIds.map((id) => store.getMedication(id))),
    ]);
    const documents = await Promise.all(
      Array.from(new Set(c.messages.flatMap((m) => m.attachments.map((a) => a.documentId)))).map((id) => store.getDocument(id)),
    );
    // Evidence lives in Cloud Storage; hand the UI a short-lived signed URL, never the gs:// path.
    const previews = new Map<string, string | undefined>();
    for (const d of documents) if (d) previews.set(d.id, await evidencePreviewUrl(d.uri));
    const withPreviews = { ...c, messages: c.messages.map((m) => ({ ...m, attachments: m.attachments.map((a) => ({ ...a, previewUrl: a.previewUrl ?? previews.get(a.documentId) })) })) };
    return json({
      case: withPreviews,
      patient,
      communications: communications.sort((a, b) => a.at.localeCompare(b.at)),
      appointments: appointments.sort((a, b) => a.start.localeCompare(b.start)),
      reviews,
      medications: medications.filter(Boolean),
      documents: documents.filter(Boolean).map((d) => ({ ...d!, uri: undefined, previewUrl: previews.get(d!.id) })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
