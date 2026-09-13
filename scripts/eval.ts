/**
 * Scenario harness — runs scripted patient journeys through the real coordinator and
 * prints an audit (reply, cards, tool trace, routing) so prompt/routing behaviour can be
 * inspected and tuned.
 *
 *   npx tsx scripts/eval.ts                 # all scenarios, dry-run integrations
 *   npx tsx scripts/eval.ts maya            # one scenario
 *   npx tsx scripts/eval.ts maya --live     # real calendar/slack/sms
 */
import fs from "node:fs";
import path from "node:path";

if (!process.argv.includes("--live")) process.env.CAREPLUS_DRY_RUN = "true";
process.env.STORE_BACKEND = "memory";
process.env.MEMORY_STORE_PATH = path.join(process.cwd(), ".careplus", "eval-store.json");
process.env.CAREPLUS_DEBUG = process.env.CAREPLUS_DEBUG ?? "false";

import { MemoryStore, setStore } from "@/core/store";
import { seedStore } from "@/data/seed";
import { answerStaffQuestion, ingestDocument, openCase, performStaffAction, runTurn } from "@/agent/coordinator";
import type { Case, TurnResult } from "@/core/types";

type Step =
  | { say: string; upload?: string }
  | { staffAsk: string }
  | { staffAction: { actionId: string } }
  | { expect: (r: TurnResult) => string[] };

interface Scenario {
  name: string;
  patientId: string;
  steps: Step[];
}

const scenarios: Scenario[] = [
  {
    name: "maya",
    patientId: "PT-8821",
    steps: [
      { say: "My doctor recommended this cough medicine, but I took something similar last year and became dizzy. I cannot remember exactly what it was. Can you help me arrange a medication review?" },
      { expect: (r) => [r.message.cards.some((c) => c.type === "evidence_request") ? "" : "expected evidence_request card"] },
      { say: "Found the old bottle in the cupboard, here's a photo.", upload: "public/demo/promethazine-bottle.png" },
      { expect: (r) => [r.message.cards.some((c) => c.type === "extraction_confirm") ? "" : "expected extraction_confirm card"] },
      { say: "Yes, that's exactly it." },
      {
        expect: (r) => [
          r.case.tier === "amber" ? "" : `expected amber tier, got ${r.case.tier}`,
          r.case.txgemmaSignals.length ? "" : "expected TxGemma signals",
          r.appointments.some((a) => a.appointmentTypeId === "medication_review" && a.status === "held") ? "" : "expected held medication_review",
          r.reviews.length ? "" : "expected staff review",
          r.communications.length ? "" : "expected patient SMS",
        ],
      },
      { staffAsk: "Why was this case routed for review?" },
      { staffAsk: "Which facts came from a document, and which came from the patient?" },
      { staffAction: { actionId: "ask_last_dose" } },
      { say: "I think the last time I took it was the evening of 11 June last year." },
      { expect: (r) => [r.case.pendingStaffQuestions.length === 0 ? "" : "expected staff question to be answered/cleared"] },
    ],
  },
  {
    name: "arjun",
    patientId: "PT-4410",
    steps: [
      { say: "The doctor told me to book physiotherapy, get blood work and return in four weeks. Can you sort all of that out for me? Just pick the earliest times that work." },
      {
        expect: (r) => [
          r.case.tier === "green" ? "" : `expected green, got ${r.case.tier}`,
          r.appointments.some((a) => a.appointmentTypeId === "pathology_draw") ? "" : "expected pathology booking",
          r.appointments.some((a) => a.appointmentTypeId === "results_followup") ? "" : "expected results follow-up",
          r.appointments.some((a) => a.appointmentTypeId === "physio_initial" && a.location === "main") ? "" : "expected physio at accessible Main clinic",
          (() => {
            const draw = r.appointments.find((a) => a.appointmentTypeId === "pathology_draw");
            const fu = r.appointments.find((a) => a.appointmentTypeId === "results_followup");
            if (!draw || !fu) return "";
            return Date.parse(fu.start) - Date.parse(draw.end) >= 72 * 3600_000 ? "" : "results follow-up is < 72h after draw";
          })(),
        ],
      },
    ],
  },
  {
    name: "tom",
    patientId: "PT-6633",
    steps: [
      { say: "I got out of hospital a couple of days ago and they started me on a new tablet. I need a follow-up but I don't know which appointment to book." },
      { expect: (r) => [r.case.tier === "amber" || r.message.cards.some((c) => c.type === "evidence_request") ? "" : `expected amber or evidence request, got ${r.case.tier}`] },
    ],
  },
  {
    name: "lucia",
    patientId: "PT-9012",
    steps: [
      { say: "Olá, preciso marcar a revisão da asma e preciso de um intérprete de português. Também tive uma reação na pele com um antibiótico no ano passado e ainda tenho a caixa." },
      { say: "Aqui está a foto da caixa.", upload: "public/demo/amoxicillin-blister.png" },
      { say: "Sim, está correto." },
      { say: "A primeira opção para a asma, por favor. E para a revisão dos medicamentos, pode reservar com a Dra Raman." },
      { expect: (r) => [r.appointments.length >= 1 ? "" : "expected bookings after slot choice", r.case.txgemmaSignals.some((s) => s.task === "Skin_Reaction") ? "" : "expected Skin_Reaction TxGemma task", r.reviews.length || r.case.status === "awaiting_staff" || r.message.cards.some((c) => c.type === "slot_options") ? "" : "expected staff review or slot options for prior adverse experience"] },
    ],
  },
  {
    name: "grace",
    patientId: "PT-2207",
    steps: [
      { say: "Two things: I want to ask whether a research study might be relevant for my migraines, and I need to send my previous records from Northgate to the clinic." },
      { say: "Yes to all three — diagnosed migraine, I take propranolol every day, and I'm fine with an app. Happy for the coordinator to contact me by email." },
      { expect: (r) => [r.case.researchPrescreen?.status === "pending_coordinator" ? "" : "expected research prescreen pending coordinator"] },
    ],
  },
  {
    name: "red",
    patientId: "PT-6633",
    steps: [
      { say: "I cut my hand an hour ago and the bleeding won't stop even with pressure. I'm on warfarin. Can I get an appointment today?" },
      { expect: (r) => [r.case.tier === "red" ? "" : `expected red, got ${r.case.tier}`, r.message.cards.some((c) => c.type === "urgent") ? "" : "expected urgent card"] },
    ],
  },
  {
    name: "historical-not-red",
    patientId: "PT-8821",
    steps: [
      { say: "Last year I passed out once after a new tablet, but I'm fine now. I just want to book a normal GP appointment with Dr Raman by video." },
      { expect: (r) => [r.case.tier !== "red" ? "" : "historical mention wrongly treated as red"] },
    ],
  },
  {
    name: "prospective",
    patientId: "prospective",
    steps: [
      { say: "Hi, I'm new here. I'd like to see a doctor about knee pain that's been going on for two months. I use a walking frame so I need somewhere without stairs." },
      { say: "Sure — I'm Daniel Park, born 3 March 1961, phone 0400 222 333. Text messages are fine." },
      { expect: (r) => [r.case.patientId.startsWith("PT-N") ? "" : "expected provisional patient record", /medicin|allerg|reaction/i.test(r.message.text) ? "" : "expected intake to ask about medicines/allergies before booking"] },
      { say: "I take ibuprofen most days for the knee, nothing else. No allergies that I know of. Mornings in person would suit me." },
      { expect: (r) => [r.appointments.some((a) => a.appointmentTypeId === "new_patient") || r.message.cards.some((c) => c.type === "slot_options") ? "" : "expected new-patient booking or slot options"] },
    ],
  },
];

function hr(title: string) {
  console.log(`\n${"═".repeat(100)}\n${title}\n${"═".repeat(100)}`);
}

function printTurn(r: TurnResult, sinceTrace: number) {
  console.log(`\n  ┌─ CarePlus (${r.case.status}${r.case.tier ? ", " + r.case.tier : ""}):`);
  for (const line of r.message.text.split("\n")) console.log(`  │ ${line}`);
  if (r.message.cards.length) console.log(`  │ [cards] ${r.message.cards.map((c) => c.type + (c.type === "slot_options" ? `(${c.slots.length})` : c.type === "research_signal" ? `(${c.signals.length})` : "")).join(", ")}`);
  console.log("  └─ trace:");
  for (const e of r.case.trace.slice(sinceTrace)) {
    if (e.kind === "message" && e.step === "reply") continue;
    console.log(`       ${e.kind.padEnd(11)} ${e.step.padEnd(24)} ${e.summary.slice(0, 160)}`);
    if (e.step === "evaluate_routing" && e.data?.reasons) for (const rs of e.data.reasons as string[]) console.log(`                                           · ${rs}`);
  }
  for (const c of r.communications) console.log(`  📱 ${c.channel} (${c.status}): ${c.body}`);
  for (const a of r.appointments) console.log(`  📅 ${a.status.toUpperCase()} ${a.title} ${a.start}${a.calendarEventId ? " [calendar]" : ""}`);
  for (const rv of r.reviews) console.log(`  🟠 ${rv.id} (${rv.tier}) ${rv.title}${rv.slackTs ? " [slack]" : ""}\n     reason: ${rv.reason}`);
}

async function runScenario(s: Scenario) {
  hr(`SCENARIO ${s.name} — ${s.patientId}`);
  const c: Case = await openCase(s.patientId === "prospective" ? "prospective" : s.patientId);
  let last: TurnResult | null = null;
  let traceMark = c.trace.length;
  const failures: string[] = [];
  const t0 = Date.now();

  for (const step of s.steps) {
    if ("say" in step) {
      const attachments = [];
      if (step.upload) {
        const file = path.resolve(step.upload);
        const b64 = fs.readFileSync(file).toString("base64");
        const doc = await ingestDocument({ caseId: c.id, patientId: last?.case.patientId ?? c.patientId, name: path.basename(file), mimeType: file.endsWith(".png") ? "image/png" : "image/jpeg", base64: b64 });
        attachments.push({ documentId: doc.id, name: doc.name, mimeType: doc.mimeType });
        console.log(`\n  📎 uploaded ${doc.name} → extraction: ${doc.extraction?.productName ?? "?"} [${doc.extraction?.activeIngredients.join("; ")}] conf ${Math.round((doc.extraction?.confidence ?? 0) * 100)}%`);
      }
      console.log(`\n  Patient: ${step.say}`);
      const tt = Date.now();
      const turn = await runTurn({ caseId: c.id, patientId: last?.case.patientId ?? c.patientId, text: step.say, attachments });
      printTurn(turn, traceMark);
      // Expectations see the cumulative state of the case, not just this turn's side effects.
      const st = (await import("@/core/store")).getStore();
      last = { ...turn, appointments: (await st.listAppointments({ caseId: c.id })).filter((a) => a.status !== "cancelled"), reviews: await st.listReviews({ caseId: c.id }), communications: [...((last as TurnResult | null)?.communications ?? []), ...turn.communications] };
      console.log(`  ⏱ ${Date.now() - tt} ms`);
      traceMark = last.case.trace.length;
    } else if ("staffAsk" in step) {
      console.log(`\n  Staff (Slack): ${step.staffAsk}`);
      const a = await answerStaffQuestion(step.staffAsk, c.id);
      for (const line of a.answer.split("\n")) console.log(`  🤖 ${line}`);
    } else if ("staffAction" in step) {
      const store = (await import("@/core/store")).getStore();
      const reviews = await store.listReviews({ caseId: c.id });
      const review = reviews[0];
      if (!review) {
        failures.push("staffAction: no review to act on");
        continue;
      }
      console.log(`\n  Staff clicks [${step.staffAction.actionId}] on ${review.id}`);
      const res = await performStaffAction({ reviewId: review.id, actionId: step.staffAction.actionId, staffName: "Nurse Ellen Cho" });
      console.log(`  → ${res.note}`);
      traceMark = res.case.trace.length;
    } else if ("expect" in step && last) {
      const problems = step.expect(last).filter(Boolean);
      for (const p of problems) console.log(`  ❌ ${p}`);
      failures.push(...problems);
    }
  }
  console.log(`\n  Scenario ${s.name}: ${failures.length ? `${failures.length} issue(s)` : "OK"} in ${Math.round((Date.now() - t0) / 1000)}s`);
  return failures;
}

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const store = new MemoryStore();
  setStore(store);
  await seedStore(store, { reset: true });
  const chosen = only.length ? scenarios.filter((s) => only.includes(s.name)) : scenarios;
  const summary: Record<string, string[]> = {};
  for (const s of chosen) {
    try {
      summary[s.name] = await runScenario(s);
    } catch (e) {
      console.error(`  💥 ${s.name} crashed:`, e);
      summary[s.name] = [`crash: ${(e as Error).message}`];
    }
  }
  hr("SUMMARY");
  for (const [k, v] of Object.entries(summary)) console.log(`${v.length ? "❌" : "✅"} ${k}${v.length ? " — " + v.join("; ") : ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
