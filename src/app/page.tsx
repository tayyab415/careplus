"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MODE_LABEL } from "@/lib/ui";

interface Persona {
  id: string;
  name: string;
  demoBlurb?: string;
  languages: string[];
  accessibility: string[];
  preferredAppointmentMode?: string;
  primaryClinician?: string;
  membership?: { plan: string; since: string; status: string };
}

interface Payload {
  clinic: { name: string; shortName: string; phone: string };
  patients: Persona[];
  integrations: Record<string, boolean>;
}

const CLINICIAN_NAMES: Record<string, string> = {
  dr_raman: "Dr Priya Raman",
  dr_whitaker: "Dr Tom Whitaker",
  nurse_cho: "Ellen Cho (Practice Nurse)",
  pharm_okafor: "Sam Okafor (Clinical Pharmacist)",
};

export default function Home() {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/patients")
      .then((r) => r.json())
      .then((d) => (d.error ? setErr(d.error) : setData(d)))
      .catch((e) => setErr(String(e)));
  }, []);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
      <header className="mb-10 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Demo · synthetic patients only
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-stone-900">
            CarePlus <span className="font-normal text-stone-400">·</span> <span className="text-stone-600">{data?.clinic.name ?? "Harbourside Family Clinic"}</span>
          </h1>
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-stone-600">
            Tell CarePlus what happened once. It reconstructs the relevant history, collects what is missing, and completes the next administrative step with the clinic — booking, follow-up questions, and staff review when something needs a human.
          </p>
        </div>
        <nav className="flex gap-2 text-sm">
          <Link href="/staff" className="rounded-lg border border-line bg-white px-3 py-2 text-stone-700 hover:bg-stone-50">
            Staff console
          </Link>
          <Link href="/research" className="rounded-lg border border-line bg-white px-3 py-2 text-stone-700 hover:bg-stone-50">
            Research view
          </Link>
        </nav>
      </header>

      {err && <p className="mb-6 rounded-lg bg-red-soft px-4 py-3 text-sm text-red">{err}</p>}

      <section>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-stone-500">Sign in as a clinic member</h2>
        <p className="mb-4 text-[13px] text-stone-500">Members have a verified clinic record. CarePlus reads it before it asks anything.</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(data?.patients ?? []).map((p) => (
            <Link key={p.id} href={`/portal/${p.id}`} className="group flex flex-col rounded-xl border border-line bg-panel p-5 transition hover:-translate-y-0.5 hover:border-accent hover:shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-stone-900">{p.name}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-stone-400">{p.id}</div>
                </div>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200">Member · verified record</span>
              </div>
              <p className="mt-3 flex-1 text-[13px] leading-relaxed text-stone-600">{p.demoBlurb}</p>
              <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] text-stone-500">
                {p.primaryClinician && (
                  <>
                    <dt className="text-stone-400">Usual clinician</dt>
                    <dd>{CLINICIAN_NAMES[p.primaryClinician] ?? p.primaryClinician}</dd>
                  </>
                )}
                {p.preferredAppointmentMode && (
                  <>
                    <dt className="text-stone-400">Prefers</dt>
                    <dd>{MODE_LABEL[p.preferredAppointmentMode]}</dd>
                  </>
                )}
                {p.languages.filter((l) => l !== "English").length > 0 && (
                  <>
                    <dt className="text-stone-400">Languages</dt>
                    <dd>{p.languages.join(", ")}</dd>
                  </>
                )}
                {p.accessibility.length > 0 && (
                  <>
                    <dt className="text-stone-400">Needs</dt>
                    <dd>{p.accessibility.join(", ")}</dd>
                  </>
                )}
              </dl>
              <div className="mt-4 text-[13px] font-medium text-accent group-hover:underline">Open portal →</div>
            </Link>
          ))}
          {!data && !err && Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-48 animate-pulse rounded-xl border border-line bg-panel" />)}

          <Link href="/portal/prospective" className="group flex flex-col justify-between rounded-xl border border-dashed border-stone-300 bg-transparent p-5 transition hover:border-accent hover:bg-white">
            <div>
              <div className="flex items-start justify-between gap-3">
                <div className="text-base font-semibold text-stone-900">I&apos;m new here</div>
                <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600 ring-1 ring-stone-200">Prospective · self-reported</span>
              </div>
              <p className="mt-3 text-[13px] leading-relaxed text-stone-600">No clinic record yet. CarePlus does a proper intake — who you are, why you&apos;re coming, what you take, what you need — then books a first visit. Everything stays labelled as self-reported until staff verify it.</p>
            </div>
            <div className="mt-4 text-[13px] font-medium text-accent group-hover:underline">Start as a new patient →</div>
          </Link>
        </div>
      </section>

      {data && (
        <footer className="mt-12 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-5 text-[12px] text-stone-500">
          <span className="font-medium text-stone-600">Live integrations:</span>
          {Object.entries(data.integrations).map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${v ? "bg-green" : "bg-stone-300"}`} />
              {k === "vertexGemini" ? "Gemini (Vertex)" : k === "txgemma" ? "TxGemma (Vertex)" : k === "sms" ? "SMS (Twilio)" : k === "calendar" ? "Google Calendar" : k === "cloudStorage" ? "Cloud Storage" : k[0].toUpperCase() + k.slice(1)}
              {!v && <span className="text-stone-400">· simulated</span>}
            </span>
          ))}
        </footer>
      )}
    </main>
  );
}
