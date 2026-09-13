"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Empty } from "@/components/ui";
import { fmtDateTime } from "@/lib/ui";

interface Payload {
  studies: { id: string; title: string; summary: string; status: string; screeningQuestions: string[] }[];
  prescreens: { caseId: string; patientRef: string; topic?: string; status: string; consented: boolean; answers: unknown; notes: string | null; updatedAt: string }[];
  signals: { key: string; count: number }[];
}

export default function ResearchView() {
  const [d, setD] = useState<Payload | null>(null);
  useEffect(() => {
    const load = () => fetch("/api/research").then((r) => r.json()).then(setD);
    load();
    const iv = setInterval(load, 8000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-line bg-panel px-5 py-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-[13px] text-stone-500 hover:text-stone-800">
            ← Personas
          </Link>
          <span className="text-stone-300">|</span>
          <div>
            <div className="text-[15px] font-semibold text-stone-900">Research coordinator view</div>
            <div className="text-[12px] text-stone-500">De-identified. Separate from the clinical queue — only patient-approved inquiries appear here.</div>
          </div>
        </div>
        <Link href="/staff" className="rounded-lg border border-line bg-white px-3 py-1.5 text-[12px] text-stone-700 hover:bg-stone-50">
          Staff console
        </Link>
      </header>

      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-5 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <main className="space-y-5">
          <section className="rounded-xl border border-line bg-panel">
            <header className="border-b border-line px-4 py-2.5">
              <h2 className="text-[13px] font-semibold text-stone-800">Awaiting coordinator contact</h2>
            </header>
            <div className="p-4">
              {!d && <div className="h-24 animate-pulse rounded-lg bg-stone-100" />}
              {d && d.prescreens.length === 0 && <Empty>No patient-approved research inquiries yet.</Empty>}
              <ul className="space-y-3">
                {d?.prescreens.map((p) => (
                  <li key={p.caseId} className="rounded-xl border border-line p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[14px] font-semibold text-stone-900">{p.topic ?? "Study interest"}</div>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${p.status === "pending_coordinator" ? "bg-amber-soft text-amber ring-amber-200" : p.status === "declined" ? "bg-stone-100 text-stone-600 ring-stone-200" : "bg-green-soft text-green ring-green-200"}`}>{p.status.replace(/_/g, " ")}</span>
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-stone-500">
                      Case {p.caseId} · patient {p.patientRef} · {fmtDateTime(p.updatedAt)}
                    </div>
                    <div className="mt-2 text-[12px] text-stone-700">{p.consented ? "Patient consented to coordinator contact." : "Patient declined contact."}</div>
                    {Array.isArray(p.answers) && (
                      <ul className="mt-2 space-y-1 text-[12px] text-stone-700">
                        {(p.answers as { question: string; answer: string }[]).map((a, i) => (
                          <li key={i} className="rounded-lg bg-stone-50 px-2.5 py-1.5">
                            <span className="text-stone-500">{a.question}</span> — <span className="font-medium">{a.answer}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {p.notes && <p className="mt-2 text-[12px] text-stone-500">{p.notes}</p>}
                    <p className="mt-2 text-[11px] text-stone-400">Eligibility is decided by the study coordinator, never by CarePlus.</p>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="rounded-xl border border-line bg-panel">
            <header className="border-b border-line px-4 py-2.5">
              <h2 className="text-[13px] font-semibold text-stone-800">Recurring molecular signals (de-identified counts)</h2>
            </header>
            <div className="p-4">
              {d && d.signals.length === 0 && <Empty>No TxGemma signals recorded yet.</Empty>}
              <ul className="grid gap-2 sm:grid-cols-2">
                {d?.signals.map((s) => (
                  <li key={s.key} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-[12px]">
                    <span className="text-stone-700">{s.key}</span>
                    <span className="rounded-full bg-fuchsia-50 px-2 py-0.5 font-medium text-fuchsia-800 ring-1 ring-fuchsia-200">{s.count}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11px] text-stone-400">Research signals only. Counts of TxGemma task runs across cases; no patient identifiers.</p>
            </div>
          </section>
        </main>

        <aside className="space-y-4">
          <section className="rounded-xl border border-line bg-panel">
            <header className="border-b border-line px-4 py-2.5">
              <h2 className="text-[13px] font-semibold text-stone-800">Recruiting studies</h2>
            </header>
            <ul className="divide-y divide-line">
              {d?.studies.map((s) => (
                <li key={s.id} className="px-4 py-3">
                  <div className="text-[13px] font-medium text-stone-800">{s.title}</div>
                  <p className="mt-0.5 text-[12px] text-stone-500">{s.summary}</p>
                  <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-stone-400">Pre-screen questions</div>
                  <ul className="mt-1 space-y-0.5 text-[12px] text-stone-600">
                    {s.screeningQuestions.map((q, i) => (
                      <li key={i}>• {q}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
