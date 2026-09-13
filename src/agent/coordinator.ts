import type OpenAI from "openai";
import { openai } from "@/llm/openai";
import { env } from "@/config/env";
import { getStore } from "@/core/store";
import { nowIso, shortId } from "@/core/ids";
import type { Attachment, Case, ChatMessage, TurnResult, UploadedDocument } from "@/core/types";
import { screenRedFlags } from "@/core/policy/redFlags";
import { evaluateRouting } from "@/core/policy/policyEngine";
import { createStaffReview, urgentActions } from "@/actions/staffReview";
import { extractLabel } from "@/specialists/vision/labelExtractor";
import { loadContext, renderContext } from "./context";
import { systemPrompt } from "./prompts";
import { executeTool, toolDefinitions, TurnState } from "./tools";
import { clinic } from "@/data/clinic";

const MAX_TOOL_ROUNDS = 14;

function res_text(r: OpenAI.Responses.Response): string {
  return (r.output_text ?? "").trim();
}

/* -------------------------------------------------------------------------- */
/*  Case lifecycle                                                              */
/* -------------------------------------------------------------------------- */

export async function openCase(patientId: string, title?: string): Promise<Case> {
  const store = getStore();
  const id = await store.nextCaseRef();
  const c: Case = {
    id,
    patientId,
    status: "open",
    title,
    messages: [],
    trace: [{ at: nowIso(), kind: "observation", step: "open_case", summary: `Case opened for ${patientId}` }],
    medicationIds: [],
    txgemmaSignals: [],
    pendingStaffQuestions: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await store.putCase(c);
  return c;
}

/** Accept an upload, store it, and run the vision extractor. */
export async function ingestDocument(input: {
  caseId: string;
  patientId: string;
  name: string;
  mimeType: string;
  base64: string;
  hint?: string;
}): Promise<UploadedDocument> {
  const store = getStore();
  const doc: UploadedDocument = {
    id: shortId("doc"),
    patientId: input.patientId,
    caseId: input.caseId,
    name: input.name,
    mimeType: input.mimeType,
    uri: `data:${input.mimeType};base64,${input.base64}`,
    sizeBytes: Math.round((input.base64.length * 3) / 4),
    confirmedByPatient: false,
    uploadedAt: nowIso(),
  };
  try {
    doc.extraction = await extractLabel({ mimeType: input.mimeType, base64: input.base64, hint: input.hint });
  } catch (e) {
    console.warn("[vision] extraction failed:", (e as Error).message);
  }
  await store.putDocument(doc);
  const c = await store.getCase(input.caseId);
  if (c) {
    c.trace.push({
      at: nowIso(),
      kind: "observation",
      step: "ingest_document",
      summary: doc.extraction
        ? `Upload ${doc.id}: read "${doc.extraction.productName ?? "?"}" [${doc.extraction.activeIngredients.join("; ")}] at ${Math.round(doc.extraction.confidence * 100)}% confidence — unconfirmed`
        : `Upload ${doc.id}: extraction failed`,
      data: { documentId: doc.id },
    });
    await store.putCase(c);
  }
  return doc;
}

/* -------------------------------------------------------------------------- */
/*  The turn                                                                    */
/* -------------------------------------------------------------------------- */

export interface TurnInput {
  caseId?: string;
  /** Existing patient id, or "prospective" for a new patient. */
  patientId: string;
  text: string;
  attachments?: Attachment[];
  /** Called with progress notes for streaming UIs. */
  onProgress?: (note: string) => void;
}

export async function runTurn(input: TurnInput): Promise<TurnResult> {
  const store = getStore();
  const progress = input.onProgress ?? (() => undefined);

  let c = input.caseId ? await store.getCase(input.caseId) : null;
  if (!c) c = await openCase(input.patientId);

  const patientMsg: ChatMessage = { id: shortId("m"), role: "patient", text: input.text, attachments: input.attachments ?? [], cards: [], at: nowIso() };
  c.messages.push(patientMsg);
  if (!c.title) c.title = input.text.slice(0, 80);

  const ctx = await loadContext(c);
  const t = new TurnState(c, ctx);

  // ---- 1. Red-flag screen (deterministic + bounded classifier) ------------------
  progress("Screening for urgent warning signs");
  const red = input.text.trim() ? await screenRedFlags(input.text).catch(() => ({ flagged: false as const })) : { flagged: false as const };
  if (red.flagged) {
    t.redFlagRuleId = red.ruleId ?? null;
    t.trace("policy", "red_flag", `Red flag "${red.ruleLabel}" matched by ${red.by}: "${red.evidence}"`, { ruleId: red.ruleId });
    const decision = evaluateRouting({
      redFlagRuleId: red.ruleId,
      priorAdverseExperience: false,
      adverseMedicineRelated: false,
      medications: [],
      currentMedicineNames: [],
      startingNewMedicine: false,
      recordConflict: false,
      clinicalQuestion: false,
      postDischarge: false,
      researchUnresolved: false,
      unconfirmedExtraction: false,
      txgemmaSignals: [],
    });
    c.tier = "red";
    c.outcome = decision.outcome;
    c.status = "urgent";
    t.trace("routing", "evaluate_routing", "RED → show_urgent_instructions", { reasons: decision.reasons });
    const review = await createStaffReview({
      c,
      tier: "red",
      title: `Urgent: ${red.ruleLabel}`,
      reason: `Patient message matched the clinic red-flag rule "${red.ruleLabel}" (${red.by}). Evidence: "${red.evidence}". Clinic urgent instruction shown; routine coordination halted.`,
      completed: ["Urgent instruction displayed to patient", "Routine workflow halted"],
      unresolved: ["Staff to call the patient now"],
      actions: urgentActions(),
    });
    t.reviews.push(review);
    const urgent = clinic.urgentInstruction;
    const reply: ChatMessage = {
      id: shortId("m"),
      role: "agent",
      text: `I'm stopping the usual process because what you've described needs urgent help. ${urgent.body} I've alerted the clinic team (reference ${c.id}).`,
      attachments: [],
      cards: [{ type: "urgent", heading: urgent.heading, instructions: urgent.body, callNumber: urgent.callNumber }],
      at: nowIso(),
    };
    c.messages.push(reply);
    c.updatedAt = nowIso();
    await store.putCase(c);
    return { caseId: c.id, message: reply, case: c, communications: [], reviews: t.reviews, appointments: [] };
  }

  // ---- 2. Coordinator loop ---------------------------------------------------------
  progress("Reading the record");
  const contextBlock = renderContext(c, ctx, nowIso());
  const attachmentsNote = input.attachments?.length
    ? `\n\n[The patient attached ${input.attachments.length} document(s) this turn: ${input.attachments.map((a) => a.documentId).join(", ")}. Their extractions are in the context block.]`
    : "";

  const history: OpenAI.Responses.ResponseInputItem[] = c.messages.slice(0, -1).slice(-16).map((m) => ({
    role: m.role === "patient" ? ("user" as const) : ("assistant" as const),
    content: m.role === "staff" ? `[Message from clinic staff relayed to patient] ${m.text}` : m.text + (m.cards.length ? `\n[cards shown: ${m.cards.map((k) => k.type).join(", ")}]` : ""),
  }));

  const inputItems: OpenAI.Responses.ResponseInputItem[] = [
    { role: "developer", content: `CONTEXT BLOCK\n${contextBlock}` },
    ...history,
    { role: "user", content: input.text + attachmentsNote },
  ];

  const client = openai();
  let finalText = "";
  let rounds = 0;
  let previousResponseId: string | undefined;
  let pending: OpenAI.Responses.ResponseInputItem[] = inputItems;

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;
    const req: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
      model: env.coordinatorModel,
      instructions: systemPrompt(),
      input: pending,
      tools: toolDefinitions.map((d) => ({ type: "function" as const, name: d.name, description: d.description, parameters: d.parameters as Record<string, unknown>, strict: false })),
      tool_choice: "auto",
      parallel_tool_calls: false,
      store: true,
      ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
      ...(env.coordinatorModel.startsWith("gpt-5") ? { reasoning: { effort: env.coordinatorReasoning } } : {}),
    };
    const res = await client.responses.create(req);
    previousResponseId = res.id;

    const calls = res.output.filter((o): o is OpenAI.Responses.ResponseFunctionToolCall => o.type === "function_call");
    const text = res.output_text?.trim();
    if (calls.length === 0) {
      finalText = text || "";
      break;
    }

    pending = [];
    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.arguments || "{}");
      } catch {
        /* keep empty */
      }
      progress(describeCall(call.name, args));
      if (env.debugAgent) console.log(`[agent] → ${call.name}`, JSON.stringify(args).slice(0, 300));
      let result: unknown;
      try {
        result = await executeTool(call.name, args, t);
      } catch (e) {
        result = { error: (e as Error).message };
        t.trace("error", call.name, (e as Error).message);
      }
      if (env.debugAgent) console.log(`[agent] ← ${call.name}`, JSON.stringify(result).slice(0, 300));
      pending.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) });
    }
  }

  // Tool budget exhausted without a patient-facing reply: one more call, tools off, to
  // summarise what was actually done (never a canned placeholder).
  if (!finalText) {
    try {
      const wrap = await client.responses.create({
        model: env.coordinatorModel,
        instructions: systemPrompt(),
        input: [...pending, { role: "developer", content: "You have used your tool budget for this turn. Write the patient-facing reply now, in the patient's language: what you did, what is reserved/booked, what is pending staff, and any question that is still open. No further tool calls." }],
        tool_choice: "none",
        store: true,
        ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
        ...(env.coordinatorModel.startsWith("gpt-5") ? { reasoning: { effort: env.coordinatorReasoning } } : {}),
      });
      finalText = res_text(wrap);
    } catch (e) {
      t.trace("error", "wrap_up", (e as Error).message);
    }
  }
  if (!finalText) finalText = "I've made progress on this — let me know if you'd like me to continue.";

  const reply: ChatMessage = { id: shortId("m"), role: "agent", text: finalText, attachments: [], cards: t.cards, at: nowIso() };
  c.messages.push(reply);
  t.trace("message", "reply", finalText.slice(0, 200), { cards: t.cards.map((k) => k.type), rounds });
  if (c.status === "open" && t.cards.length === 0 && finalText.trim().endsWith("?")) c.status = "awaiting_patient";
  c.updatedAt = nowIso();
  await store.putCase(c);

  return { caseId: c.id, message: reply, case: c, communications: t.communications, reviews: t.reviews, appointments: t.appointments };
}

function describeCall(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "resolve_medication":
      return `Resolving "${args.name}" against RxNorm, PubChem and the official label`;
    case "run_txgemma":
      return "Running TxGemma molecular research signals";
    case "evaluate_routing":
      return "Checking clinic routing policy";
    case "find_slots":
      return "Finding appointment times";
    case "book_appointment":
      return "Booking the appointment";
    case "create_staff_review":
      return "Preparing the staff review";
    case "send_patient_message":
      return "Sending confirmation";
    case "confirm_extraction":
      return "Reading the uploaded label";
    default:
      return name.replace(/_/g, " ");
  }
}

/* -------------------------------------------------------------------------- */
/*  Staff-side operations                                                       */
/* -------------------------------------------------------------------------- */

export async function performStaffAction(input: { reviewId: string; actionId: string; staffName: string; freeText?: string }) {
  const store = getStore();
  const review = await store.getReview(input.reviewId);
  if (!review) throw new Error(`Unknown review ${input.reviewId}`);
  const c = await store.getCase(review.caseId);
  if (!c) throw new Error(`Unknown case ${review.caseId}`);
  const patient = await store.getPatient(c.patientId);
  const action = review.actions.find((a) => a.id === input.actionId);
  if (!action) throw new Error(`Unknown action ${input.actionId}`);

  const { confirmAppointment } = await import("@/actions/scheduler");
  const { sendPatientMessage } = await import("@/actions/messaging");
  const { updateReviewInSlack } = await import("@/actions/slack");
  const { formatLocal } = await import("@/core/time");

  let note = "";
  switch (action.kind) {
    case "confirm_appointment": {
      const held = (await store.listAppointments({ caseId: c.id })).filter((a) => a.status === "held");
      const target = (action.payload?.appointmentId as string | undefined) ?? held[0]?.id;
      const appt = target ? await confirmAppointment(target) : null;
      review.status = "resolved";
      review.resolution = `Appointment confirmed by ${input.staffName}`;
      review.resolvedAt = nowIso();
      c.status = "completed";
      note = appt ? `Appointment confirmed for ${formatLocal(appt.start)}` : "No held appointment found";
      const staffMsg: ChatMessage = { id: shortId("m"), role: "staff", text: appt ? `Your ${appt.title.split(" — ")[0].toLowerCase()} for ${formatLocal(appt.start)} has been confirmed by the clinic team.` : "The clinic team has reviewed your case.", attachments: [], cards: [], at: nowIso() };
      c.messages.push(staffMsg);
      if (patient) await sendPatientMessage({ patient, caseId: c.id, body: `${clinic.shortName}: your appointment${appt ? ` on ${formatLocal(appt.start)}` : ""} is confirmed. Ref ${c.id}.` });
      break;
    }
    case "ask_patient": {
      const question = input.freeText || (action.payload?.question as string | undefined) || "The clinic team has a quick question for you — could you reply here?";
      const qid = shortId("q");
      c.pendingStaffQuestions.push({ id: qid, question, askedBy: input.staffName, at: nowIso(), reviewId: review.id });
      c.status = "awaiting_patient";
      review.unresolved.push(`Awaiting patient answer: ${question}`);
      const staffMsg: ChatMessage = { id: shortId("m"), role: "staff", text: question, attachments: [], cards: [{ type: "staff_question", reviewId: review.id, question }], at: nowIso() };
      c.messages.push(staffMsg);
      if (patient) await sendPatientMessage({ patient, caseId: c.id, body: `${clinic.shortName}: the clinic team has a quick question about ref ${c.id}. Please open your CarePlus portal to reply.` });
      note = `Question sent to patient by ${input.staffName}`;
      break;
    }
    case "assign": {
      review.assignedTo = (action.payload?.staffId as string | undefined) ?? input.staffName;
      review.status = "in_progress";
      note = `Assigned to ${review.assignedTo}`;
      break;
    }
    case "dismiss": {
      review.status = "dismissed";
      review.resolvedAt = nowIso();
      review.resolution = `Dismissed by ${input.staffName}`;
      if (c.status === "awaiting_staff" || c.status === "urgent") c.status = "completed";
      note = `Dismissed by ${input.staffName}`;
      break;
    }
    case "reclassify":
    case "custom": {
      review.status = "in_progress";
      review.completed.push(`${input.staffName}: ${action.label}`);
      note = `${action.label} — ${input.staffName}`;
      break;
    }
  }

  c.trace.push({ at: nowIso(), kind: "staff", step: `staff_action:${action.kind}`, summary: `${input.staffName} → ${action.label}. ${note}`, data: { reviewId: review.id } });
  c.updatedAt = nowIso();
  await store.putReview(review);
  await store.putCase(c);
  await updateReviewInSlack(review, c, `_${note}_`).catch(() => undefined);
  return { review, case: c, note };
}

/**
 * "Why was CP-1042 routed for review?" — answered strictly from the stored decision
 * trace, facts and reviews. Used by the Slack bot and the staff console.
 */
export async function answerStaffQuestion(question: string, caseIdHint?: string): Promise<{ answer: string; caseId?: string }> {
  const store = getStore();
  const refMatch = question.match(/\bCP-\d{3,6}\b/i)?.[0]?.toUpperCase();
  const caseId = caseIdHint ?? refMatch;

  // Queue-level questions (no case ref).
  if (!caseId) {
    const open = await store.listReviews({ status: ["open", "in_progress"] });
    const waitingLong = open.filter((r) => Date.now() - Date.parse(r.createdAt) > 2 * 3600_000);
    if (/wait|longer than|queue|open cases|pending/i.test(question)) {
      if (!open.length) return { answer: "No open staff reviews right now." };
      return {
        answer:
          `${open.length} open review(s)` +
          (waitingLong.length ? `, ${waitingLong.length} waiting more than two hours` : "") +
          ":\n" +
          open.map((r) => `• ${r.id} · ${r.caseId} · ${r.tier.toUpperCase()} · ${r.title} · opened ${Math.round((Date.now() - Date.parse(r.createdAt)) / 60000)} min ago${r.assignedTo ? ` · ${r.assignedTo}` : ""}`).join("\n"),
      };
    }
    return { answer: "Which case? Include the reference (e.g. CP-1042), or ask about the queue (\"show cases waiting longer than two hours\")." };
  }

  const c = await store.getCase(caseId);
  if (!c) return { answer: `I can't find case ${caseId}.`, caseId };
  const ctx = await loadContext(c);
  const reviews = await store.listReviews({ caseId });
  const traceText = c.trace.map((e) => `${e.at.slice(11, 19)} [${e.kind}/${e.step}] ${e.summary}${e.data?.reasons ? " reasons=" + JSON.stringify(e.data.reasons) : ""}`).join("\n");
  const contextBlock = renderContext(c, ctx, nowIso());
  const reviewText = reviews.map((r) => `${r.id} (${r.tier}, ${r.status}): ${r.title}\nReason: ${r.reason}\nCompleted: ${r.completed.join("; ")}\nUnresolved: ${r.unresolved.join("; ")}`).join("\n\n");

  const client = openai();
  const ask = async (effort: "low" | "medium") => {
    const res = await client.responses.create({
      model: env.coordinatorModel,
      instructions: `You are CarePlus answering a clinic STAFF member in the clinic's private Slack. Answer ONLY from the decision trace, record and reviews provided. Be concrete and short (under 120 words unless listing a timeline). Never add clinical interpretation of your own.
Provenance labels are exact and matter: "patient reported", "document showed (patient-confirmed)", "database-verified (RxNorm / PubChem / official label)", "TxGemma predicted (research signal, not clinical)", "routing engine rule", "staff confirmed". Do not call something "staff confirmed" unless a staff member did it.
"Why was this routed/escalated?" → list the routing engine's reasons (the evaluate_routing trace entries) first, then the evidence behind each with its provenance, then what the agent did instead of giving advice (e.g. held an appointment).
"Which facts came from a document vs the patient?" → two short lists.
Medication timeline → dated list, each line tagged with provenance.`,
      input: [
        { role: "developer", content: `CASE CONTEXT\n${contextBlock}\n\nDECISION TRACE\n${traceText}\n\nSTAFF REVIEWS\n${reviewText || "(none)"}` },
        { role: "user", content: question },
      ],
      ...(env.coordinatorModel.startsWith("gpt-5") ? { reasoning: { effort } } : {}),
    });
    return res.output_text.trim();
  };
  let answer = await ask("medium");
  if (!answer) answer = await ask("medium");
  return { answer: answer || "I couldn't produce an answer from the case record just now — please try again.", caseId };
}
