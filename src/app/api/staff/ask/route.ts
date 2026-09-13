import { answerStaffQuestion } from "@/agent/coordinator";
import { ensureSeeded, errorResponse, json } from "@/server/bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    await ensureSeeded();
    const body = (await req.json()) as { question: string; caseId?: string };
    if (!body.question?.trim()) return json({ error: "question is required" }, { status: 400 });
    const res = await answerStaffQuestion(body.question, body.caseId || undefined);
    return json(res);
  } catch (e) {
    return errorResponse(e);
  }
}
