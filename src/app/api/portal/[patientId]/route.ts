import { getStore } from "@/core/store";
import { ensureSeeded, errorResponse, json } from "@/server/bootstrap";
import { clinic } from "@/data/clinic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Everything the patient portal needs to render the record panel and case list. */
export async function GET(_req: Request, ctx: { params: Promise<{ patientId: string }> }) {
  try {
    await ensureSeeded();
    const { patientId } = await ctx.params;
    const store = getStore();
    if (patientId === "prospective") {
      return json({ patient: null, facts: [], appointments: [], careTasks: [], cases: [], communications: [], clinic: { name: clinic.name, phone: clinic.phone } });
    }
    const patient = await store.getPatient(patientId);
    if (!patient) return json({ error: "Unknown patient" }, { status: 404 });
    const [facts, appointments, careTasks, cases, communications] = await Promise.all([
      store.listFacts(patientId),
      store.listAppointments({ patientId }),
      store.listCareTasks(patientId),
      store.listCases({ patientId }),
      store.listCommunications({ patientId }),
    ]);
    return json({
      patient,
      facts: facts.filter((f) => !f.supersededBy).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)),
      appointments: appointments.sort((a, b) => a.start.localeCompare(b.start)),
      careTasks,
      cases: cases
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((c) => ({ id: c.id, title: c.title, status: c.status, tier: c.tier, updatedAt: c.updatedAt, messageCount: c.messages.length })),
      communications: communications.sort((a, b) => a.at.localeCompare(b.at)),
      clinic: { name: clinic.name, phone: clinic.phone },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
