import { ingestDocument, openCase } from "@/agent/coordinator";
import { ensureSeeded, errorResponse, json } from "@/server/bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Upload a photo / document for a case. Runs the vision extractor immediately so the
 * next chat turn already has the structured extraction in context.
 */
export async function POST(req: Request) {
  try {
    await ensureSeeded();
    const body = (await req.json()) as { patientId: string; caseId?: string; name: string; mimeType: string; base64: string; hint?: string };
    if (!body.base64 || !body.patientId) return json({ error: "patientId and base64 are required" }, { status: 400 });
    let caseId = body.caseId;
    if (!caseId) caseId = (await openCase(body.patientId)).id;
    const doc = await ingestDocument({ caseId, patientId: body.patientId, name: body.name, mimeType: body.mimeType, base64: body.base64, hint: body.hint });
    return json({
      caseId,
      attachment: { documentId: doc.id, name: doc.name, mimeType: doc.mimeType },
      extraction: doc.extraction ?? null,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
