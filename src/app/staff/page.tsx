"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Appointment, Case, Communication, ResolvedMedication, StaffReview, Patient, Fact } from "@/core/types";
import { Button, Dots, Empty, ProvenanceTag, StatusBadge, TierBadge } from "@/components/ui";
import { MedicationCard, ResearchSignalCard } from "@/components/portal/Cards";
import { ago, apptClinician, fmtDateTime, fmtTime, renderMarkdown } from "@/lib/ui";

interface Overview {
  reviews: (StaffReview & { patientName: string })[];
  cases: { id: string; patientId: string; patientName: string; title?: string; status: string; tier?: string; outcome?: string; updatedAt: string; createdAt: string; pendingStaffQuestions: number; txgemmaSignals: number }[];
  integrations: Record<string, boolean>;
}

interface CaseDetail {
  case: Case;
  patient: Patient | null;
  communications: Communication[];
  appointments: Appointment[];
  reviews: StaffReview[];
  medications: ResolvedMedication[];
}

const STAFF_NAME = "Nurse Ellen Cho";

export default function StaffConsole() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [selectedCase, setSelectedCase] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [acting, setActing] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [qa, setQa] = useState<{ q: string; a: string }[]>([]);
  const [asking, setAsking] = useState(false);
  const [freeText, setFreeText] = useState("");
  const [tab, setTab] = useState<"trace" | "conversation" | "record">("trace");
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const r = await fetch("/api/staff/overview");
    const d = (await r.json()) as Overview;
    setOv(d);
    // First load: focus the newest open review (or newest case) so the console is never blank.
    setSelectedCase((cur) => {
      if (cur) return cur;
      const first = d.reviews.find((x) => x.status === "open" || x.status === "in_progress") ?? d.reviews[0];
      return first?.caseId ?? d.cases[0]?.id ?? null;
    });
  }, []);

  const loadDetail = useCallback(async (caseId: string) => {
    const r = await fetch(`/api/case/${caseId}`);
    const d = (await r.json()) as CaseDetail;
    if (!d.case) return;
    setDetail(d);
    const pr = await fetch(`/api/portal/${d.case.patientId}`);
    const pd = await pr.json();
    setFacts(pd.facts ?? []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state is set after awaited fetches
    load();
    const iv = setInterval(() => {
      load();
      setNow(Date.now());
    }, 5000);
    return () => clearInterval(iv);
  }, [load]);

  useEffect(() => {
    if (!selectedCase) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state is set after awaited fetches
    loadDetail(selectedCase);
    const iv = setInterval(() => loadDetail(selectedCase), 5000);
    return () => clearInterval(iv);
  }, [selectedCase, loadDetail]);

  const act = async (review: StaffReview, actionId: string) => {
    setActing(`${review.id}:${actionId}`);
    setNote(null);
    try {
      const action = review.actions.find((a) => a.id === actionId);
      const body: Record<string, unknown> = { reviewId: review.id, actionId, staffName: STAFF_NAME };
      if (action?.kind === "ask_patient" && freeText.trim()) body.freeText = freeText.trim();
      const r = await fetch("/api/staff/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setNote(d.note ?? "Done");
      setFreeText("");
      await Promise.all([load(), selectedCase ? loadDetail(selectedCase) : Promise.resolve()]);
    } catch (e) {
      setNote(`Failed: ${(e as Error).message}`);
    } finally {
      setActing(null);
    }
  };

  const ask = async (q: string) => {
    if (!q.trim()) return;
    setAsking(true);
    setQuestion("");
    try {
      const r = await fetch("/api/staff/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q, caseId: /\bCP-\d+/i.test(q) ? undefined : selectedCase }) });
      const d = await r.json();
      setQa((x) => [...x, { q, a: d.answer ?? d.error ?? "(no answer)" }]);
    } finally {
      setAsking(false);
    }
  };

  const openReviews = useMemo(() => (ov?.reviews ?? []).filter((r) => r.status === "open" || r.status === "in_progress"), [ov]);
  const closedReviews = useMemo(() => (ov?.reviews ?? []).filter((r) => r.status !== "open" && r.status !== "in_progress"), [ov]);
  const caseReviews = detail?.reviews ?? [];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-line bg-panel px-5 py-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-[13px] text-stone-500 hover:text-stone-800">
            ← Personas
          </Link>
          <span className="text-stone-300">|</span>
          <div>
            <div className="text-[15px] font-semibold text-stone-900">Staff exception console</div>
            <div className="text-[12px] text-stone-500">
              Only cases that need a human land here. {ov?.integrations.slack ? "Mirrored to Slack." : "Slack not connected — this console is the exception inbox."}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[12px] text-stone-500">
          <span>
            Signed in as <span className="font-medium text-stone-700">{STAFF_NAME}</span>
          </span>
          <Link href="/research" className="rounded-lg border border-line bg-white px-3 py-1.5 text-stone-700 hover:bg-stone-50">
            Research view
          </Link>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[1600px] flex-1 grid-cols-1 gap-5 px-5 py-5 xl:grid-cols-[340px_minmax(0,1fr)_380px]">
        {/* Queue */}
        <aside className="space-y-4">
          <section className="rounded-xl border border-line bg-panel">
            <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <h2 className="text-[13px] font-semibold text-stone-800">Needs attention</h2>
              <span className="rounded-full bg-amber-soft px-2 py-0.5 text-[11px] font-medium text-amber">{openReviews.length}</span>
            </header>
            <ul className="divide-y divide-line">
              {openReviews.length === 0 && (
                <li className="px-4 py-4">
                  <Empty>Nothing waiting. CarePlus is handling routine cases on its own.</Empty>
                </li>
              )}
              {openReviews.map((r) => (
                <li key={r.id}>
                  <button onClick={() => setSelectedCase(r.caseId)} className={`w-full px-4 py-3 text-left transition hover:bg-stone-50 ${selectedCase === r.caseId ? "bg-stone-50" : ""}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-stone-500">
                        {r.id} · {r.caseId}
                      </span>
                      <TierBadge tier={r.tier} />
                    </div>
                    <div className="mt-1 text-[13px] font-medium text-stone-800">{r.title}</div>
                    <div className="mt-0.5 flex items-center justify-between text-[11px] text-stone-500">
                      <span>{r.patientName}</span>
                      <span className={now - Date.parse(r.createdAt) > 2 * 3600_000 ? "text-red" : ""}>{ago(r.createdAt)}</span>
                    </div>
                    {r.assignedTo && <div className="mt-0.5 text-[11px] text-sky-700">Assigned · {r.assignedTo}</div>}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-line bg-panel">
            <header className="border-b border-line px-4 py-2.5">
              <h2 className="text-[13px] font-semibold text-stone-800">All cases</h2>
            </header>
            <ul className="scroll-thin max-h-[40vh] divide-y divide-line overflow-y-auto">
              {(ov?.cases ?? []).map((c) => (
                <li key={c.id}>
                  <button onClick={() => setSelectedCase(c.id)} className={`w-full px-4 py-2.5 text-left transition hover:bg-stone-50 ${selectedCase === c.id ? "bg-stone-50" : ""}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-stone-500">{c.id}</span>
                      <div className="flex items-center gap-1">
                        <TierBadge tier={c.tier} />
                        <StatusBadge status={c.status} />
                      </div>
                    </div>
                    <div className="mt-0.5 truncate text-[12px] text-stone-700">
                      <span className="font-medium">{c.patientName}</span> · {c.title}
                    </div>
                  </button>
                </li>
              ))}
              {ov && ov.cases.length === 0 && (
                <li className="px-4 py-4">
                  <Empty>No cases yet.</Empty>
                </li>
              )}
            </ul>
          </section>

          {closedReviews.length > 0 && (
            <section className="rounded-xl border border-line bg-panel">
              <header className="border-b border-line px-4 py-2.5">
                <h2 className="text-[13px] font-semibold text-stone-800">Resolved</h2>
              </header>
              <ul className="divide-y divide-line">
                {closedReviews.slice(0, 5).map((r) => (
                  <li key={r.id} className="px-4 py-2 text-[12px] text-stone-500">
                    <button onClick={() => setSelectedCase(r.caseId)} className="w-full text-left hover:text-stone-800">
                      <span className="font-mono text-[11px]">{r.id}</span> · {r.title} <StatusBadge status={r.status} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>

        {/* Case detail */}
        <main className="space-y-4">
          {!detail && <div className="h-64 animate-pulse rounded-xl border border-line bg-panel" />}
          {detail && (
            <>
              <section className="rounded-xl border border-line bg-panel p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[13px] text-stone-500">{detail.case.id}</span>
                      <TierBadge tier={detail.case.tier} size="md" />
                      <StatusBadge status={detail.case.status} />
                    </div>
                    <h2 className="mt-1 text-[17px] font-semibold text-stone-900">{detail.case.title}</h2>
                    <div className="mt-0.5 text-[12px] text-stone-500">
                      {detail.patient ? (
                        <>
                          {detail.patient.name} · {detail.patient.kind === "existing" ? "member, verified record" : "prospective, self-reported only"} · {detail.patient.id}
                        </>
                      ) : (
                        detail.case.patientId
                      )}{" "}
                      · opened {fmtDateTime(detail.case.createdAt)}
                    </div>
                  </div>
                  <Link href={`/portal/${detail.case.patientId}`} className="text-[12px] text-accent hover:underline" target="_blank">
                    Open patient portal ↗
                  </Link>
                </div>

                {caseReviews.length > 0 && (
                  <div className="mt-4 space-y-3">
                    {caseReviews.map((r) => (
                      <div key={r.id} className={`rounded-xl border p-4 ${r.tier === "red" ? "border-red-300 bg-red-soft/40" : "border-amber-200 bg-amber-soft/40"}`}>
                        <div className="flex items-center justify-between">
                          <div className="text-[14px] font-semibold text-stone-900">
                            {r.title} <span className="ml-1 font-mono text-[11px] font-normal text-stone-500">{r.id}</span>
                          </div>
                          <StatusBadge status={r.status} />
                        </div>
                        <p className="mt-1.5 text-[13px] leading-relaxed text-stone-800">{r.reason}</p>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">Agent completed</div>
                            <ul className="mt-1 space-y-0.5 text-[12px] text-stone-700">
                              {r.completed.map((c, i) => (
                                <li key={i}>✓ {c}</li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">Unresolved</div>
                            <ul className="mt-1 space-y-0.5 text-[12px] text-stone-700">
                              {r.unresolved.map((c, i) => (
                                <li key={i}>• {c}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                        {(r.status === "open" || r.status === "in_progress") && (
                          <div className="mt-4">
                            <div className="flex flex-wrap gap-2">
                              {r.actions.map((a) => (
                                <Button key={a.id} variant={a.kind === "confirm_appointment" ? "primary" : a.kind === "dismiss" ? "ghost" : "secondary"} onClick={() => act(r, a.id)} disabled={Boolean(acting)}>
                                  {acting === `${r.id}:${a.id}` ? <Dots /> : a.label}
                                </Button>
                              ))}
                            </div>
                            {r.actions.some((a) => a.kind === "ask_patient") && (
                              <input value={freeText} onChange={(e) => setFreeText(e.target.value)} placeholder="Or type your own question for the patient, then click an “Ask patient” button" className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-1.5 text-[12px] outline-none focus:border-accent" />
                            )}
                          </div>
                        )}
                        {r.resolution && <div className="mt-2 text-[12px] text-stone-500">Resolution: {r.resolution}</div>}
                      </div>
                    ))}
                  </div>
                )}
                {note && <div className="mt-3 rounded-lg bg-stone-100 px-3 py-2 text-[12px] text-stone-700">{note}</div>}

                {detail.appointments.length > 0 && (
                  <div className="mt-4">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">Appointments on this case</div>
                    <ul className="mt-1 space-y-1">
                      {detail.appointments.map((a) => (
                        <li key={a.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-1.5 text-[12px]">
                          <span className="text-stone-800">
                            {a.title.split(" — ")[0]} · {fmtDateTime(a.start)}
                            {apptClinician(a) ? ` · ${apptClinician(a)}` : ""}
                          </span>
                          <span className="flex items-center gap-2">
                            {a.calendarLink && (
                              <a href={a.calendarLink} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                                Calendar
                              </a>
                            )}
                            <StatusBadge status={a.status} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-line bg-panel">
                <div className="flex gap-1 border-b border-line px-3 pt-2">
                  {(["trace", "conversation", "record"] as const).map((t) => (
                    <button key={t} onClick={() => setTab(t)} className={`rounded-t-lg px-3 py-2 text-[13px] ${tab === t ? "border-b-2 border-accent font-medium text-stone-900" : "text-stone-500 hover:text-stone-800"}`}>
                      {t === "trace" ? `Decision trace (${detail.case.trace.length})` : t === "conversation" ? `Conversation (${detail.case.messages.length})` : "Record & evidence"}
                    </button>
                  ))}
                </div>
                <div className="scroll-thin max-h-[60vh] overflow-y-auto p-4">
                  {tab === "trace" && <Trace trace={detail.case.trace} />}
                  {tab === "conversation" && (
                    <div className="space-y-3">
                      {detail.case.messages.map((m) => (
                        <div key={m.id} className={`rounded-lg px-3 py-2 text-[13px] ${m.role === "patient" ? "bg-sky-50" : m.role === "staff" ? "bg-amber-soft/60" : "bg-stone-50"}`}>
                          <div className="mb-0.5 flex items-center justify-between text-[10px] uppercase tracking-wide text-stone-400">
                            <span>{m.role}</span>
                            <span>{fmtTime(m.at)}</span>
                          </div>
                          <div className="prose-chat text-stone-800" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }} />
                          {m.cards.length > 0 && <div className="mt-1 text-[11px] text-stone-400">cards: {m.cards.map((c) => c.type).join(", ")}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                  {tab === "record" && (
                    <div className="space-y-4">
                      {detail.medications.map((m) => (
                        <MedicationCard key={m.id} medication={m} />
                      ))}
                      {detail.case.txgemmaSignals.length > 0 && <ResearchSignalCard signals={detail.case.txgemmaSignals} />}
                      <div>
                        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500">Facts on record — by provenance</div>
                        <ul className="space-y-1.5">
                          {facts.map((f) => (
                            <li key={f.id} className="flex items-start gap-2 text-[12px] text-stone-700">
                              <ProvenanceTag p={f.provenance} />
                              <span>
                                {f.statement} <span className="text-stone-400">· {f.source}</span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      {detail.communications.length > 0 && (
                        <div>
                          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500">Messages sent to patient</div>
                          <ul className="space-y-1 text-[12px] text-stone-600">
                            {detail.communications.map((c) => (
                              <li key={c.id} className="rounded-lg bg-stone-50 px-2.5 py-1.5">
                                <span className="text-[10px] uppercase text-stone-400">
                                  {c.channel} · {c.status} · {fmtTime(c.at)}
                                </span>
                                <div className="whitespace-pre-wrap">{c.body}</div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>
            </>
          )}
        </main>

        {/* Ask CarePlus */}
        <aside className="space-y-4 xl:sticky xl:top-5 xl:self-start">
          <section className="rounded-xl border border-line bg-panel">
            <header className="border-b border-line px-4 py-2.5">
              <h2 className="text-[13px] font-semibold text-stone-800">Ask CarePlus</h2>
              <p className="text-[11px] text-stone-500">Answers only from the case record and decision trace{selectedCase ? ` · scoped to ${selectedCase}` : ""}.</p>
            </header>
            <div className="scroll-thin max-h-[50vh] space-y-3 overflow-y-auto p-4">
              {qa.length === 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {["Why was this case routed for review?", "Which facts came from a document, and which from the patient?", "Show the patient's medication timeline.", "Show cases waiting longer than two hours."].map((s) => (
                    <button key={s} onClick={() => ask(s)} className="rounded-full border border-line bg-white px-2.5 py-1 text-[12px] text-stone-700 hover:border-accent hover:bg-accent-soft/40">
                      {s}
                    </button>
                  ))}
                </div>
              )}
              {qa.map((x, i) => (
                <div key={i}>
                  <div className="text-[12px] font-medium text-stone-800">{x.q}</div>
                  <div className="prose-chat mt-1 rounded-lg bg-stone-50 px-3 py-2 text-[12px] text-stone-700" dangerouslySetInnerHTML={{ __html: renderMarkdown(x.a) }} />
                </div>
              ))}
              {asking && (
                <div className="text-stone-500">
                  <Dots />
                </div>
              )}
            </div>
            <form
              className="flex gap-2 border-t border-line p-3"
              onSubmit={(e) => {
                e.preventDefault();
                ask(question);
              }}
            >
              <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Why was CP-1042 escalated?" className="flex-1 rounded-lg border border-line px-3 py-1.5 text-[13px] outline-none focus:border-accent" />
              <Button type="submit" disabled={asking || !question.trim()}>
                Ask
              </Button>
            </form>
          </section>
          <p className="px-1 text-[11px] leading-relaxed text-stone-400">Demo data is synthetic. In Slack, the same card appears in the private triage channel with these buttons; “Ask CarePlus” maps to messaging the bot.</p>
        </aside>
      </div>
    </div>
  );
}

function Trace({ trace }: { trace: Case["trace"] }) {
  const tone: Record<string, string> = {
    observation: "bg-stone-200 text-stone-700",
    tool_call: "bg-sky-100 text-sky-800",
    tool_result: "bg-sky-50 text-sky-700",
    policy: "bg-violet-100 text-violet-800",
    routing: "bg-amber-soft text-amber",
    action: "bg-green-soft text-green",
    message: "bg-stone-100 text-stone-600",
    staff: "bg-teal-100 text-teal-800",
    error: "bg-red-soft text-red",
  };
  return (
    <ol className="relative space-y-2 border-l border-line pl-4">
      {trace.map((e, i) => (
        <li key={i} className="relative text-[12px]">
          <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-stone-300" />
          <div className="flex items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tone[e.kind] ?? "bg-stone-100"}`}>{e.kind.replace("_", " ")}</span>
            <span className="font-mono text-[11px] text-stone-500">{e.step}</span>
            <span className="ml-auto text-[10px] text-stone-400">{fmtTime(e.at)}</span>
          </div>
          <div className="mt-0.5 whitespace-pre-wrap text-stone-700">{e.summary}</div>
          {Array.isArray(e.data?.reasons) && (
            <ul className="mt-0.5 list-disc pl-4 text-stone-500">
              {(e.data!.reasons as string[]).map((r, j) => (
                <li key={j}>{r}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}
