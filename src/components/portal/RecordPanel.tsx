"use client";

import { useState } from "react";
import type { Appointment, CarePlanTask, Fact, Patient } from "@/core/types";
import { Empty, ProvenanceTag, StatusBadge } from "@/components/ui";
import { apptClinician, fmtDate, fmtDateTime, MODE_LABEL } from "@/lib/ui";

const KIND_LABEL: Record<string, string> = {
  medication: "Medicines",
  adverse_experience: "Reactions & side effects",
  symptom: "Symptoms",
  allergy: "Allergies",
  condition: "Conditions",
  accessibility: "Access & support",
  care_plan_instruction: "Care plan",
  appointment_history: "Appointments",
  contact_preference: "Contact",
  research_interest: "Research",
  document: "Documents",
  note: "Notes",
};

const KIND_ORDER = ["condition", "medication", "allergy", "adverse_experience", "symptom", "care_plan_instruction", "accessibility", "contact_preference", "research_interest", "document", "note", "appointment_history"];

export function RecordPanel({ patient, facts, appointments, careTasks }: { patient: Patient | null; facts: Fact[]; appointments: Appointment[]; careTasks: CarePlanTask[] }) {
  // Snapshot "now" once per mount so render stays pure; the panel re-mounts with new data anyway.
  const [now] = useState(() => Date.now());
  if (!patient) {
    return (
      <div className="rounded-xl border border-dashed border-stone-300 p-4">
        <div className="text-[13px] font-semibold text-stone-800">No clinic record yet</div>
        <p className="mt-1 text-[12px] leading-relaxed text-stone-500">You&apos;re talking to CarePlus as a new patient. Anything you tell it is stored as self-reported until the clinic verifies it at your first visit.</p>
      </div>
    );
  }
  const upcoming = appointments.filter((a) => a.status !== "cancelled" && Date.parse(a.end) > now);
  const past = appointments.filter((a) => Date.parse(a.end) <= now && a.status !== "cancelled").slice(-3).reverse();
  const groups = new Map<string, Fact[]>();
  for (const f of facts) {
    if (f.kind === "appointment_history") continue;
    groups.set(f.kind, [...(groups.get(f.kind) ?? []), f]);
  }
  const openTasks = careTasks.filter((t) => t.status === "open" || t.status === "scheduled");

  return (
    <div className="space-y-4">
      <div className={`rounded-xl border px-4 py-3 ${patient.kind === "prospective" ? "border-amber-200 bg-amber-soft/40" : "border-emerald-200 bg-emerald-50/60"}`}>
        <div className="flex items-center justify-between">
          <div className="text-[13px] font-semibold text-stone-900">{patient.name}</div>
          {patient.kind === "prospective" ? (
            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-amber ring-1 ring-amber-200">Provisional · self-reported</span>
          ) : (
            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-emerald-800 ring-1 ring-emerald-200">Verified clinic record</span>
          )}
        </div>
        {patient.kind === "prospective" && <p className="mt-1 text-[11px] text-stone-500">Created from this conversation. Staff verify identity and history at the first visit.</p>}
        <dl className="mt-2 grid grid-cols-[90px_1fr] gap-y-0.5 text-[12px] text-stone-600">
          {patient.dateOfBirth && (
            <>
              <dt className="text-stone-400">Born</dt>
              <dd>{fmtDate(patient.dateOfBirth)}</dd>
            </>
          )}
          {patient.membership && (
            <>
              <dt className="text-stone-400">Membership</dt>
              <dd>
                {patient.membership.plan} · since {patient.membership.since.slice(0, 4)}
              </dd>
            </>
          )}
          {patient.preferredAppointmentMode && (
            <>
              <dt className="text-stone-400">Prefers</dt>
              <dd>{MODE_LABEL[patient.preferredAppointmentMode]}</dd>
            </>
          )}
          {patient.languages.length > 0 && (
            <>
              <dt className="text-stone-400">Languages</dt>
              <dd>{patient.languages.join(", ")}</dd>
            </>
          )}
          {patient.accessibility.length > 0 && (
            <>
              <dt className="text-stone-400">Needs</dt>
              <dd>{patient.accessibility.join(", ")}</dd>
            </>
          )}
        </dl>
      </div>

      <Section title="Upcoming appointments">
        {upcoming.length === 0 ? (
          <Empty>None booked.</Empty>
        ) : (
          <ul className="space-y-2">
            {upcoming.map((a) => (
              <li key={a.id} className="rounded-lg border border-line px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[13px] font-medium text-stone-800">{a.title.split(" — ")[0]}</div>
                  <StatusBadge status={a.status} />
                </div>
                <div className="mt-0.5 text-[12px] text-stone-500">
                  {fmtDateTime(a.start)} · {MODE_LABEL[a.mode]}
                  {apptClinician(a) ? ` · ${apptClinician(a)}` : ""}
                </div>
                {a.location && <div className="text-[11px] text-stone-400">{a.location}</div>}
                {a.calendarLink && (
                  <a href={a.calendarLink} target="_blank" rel="noreferrer" className="text-[11px] text-accent hover:underline">
                    Calendar event
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {openTasks.length > 0 && (
        <Section title="Care plan — still to arrange">
          <ul className="space-y-1.5">
            {openTasks.map((t) => (
              <li key={t.id} className="flex items-start gap-2 text-[12px] text-stone-700">
                <span className={`mt-1 h-1.5 w-1.5 flex-none rounded-full ${t.status === "scheduled" ? "bg-green" : "bg-amber"}`} />
                <span>
                  {t.description}
                  {t.dueBy && <span className="text-stone-400"> · by {fmtDate(t.dueBy)}</span>}
                  {t.status === "scheduled" && <span className="text-green"> · scheduled</span>}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {KIND_ORDER.filter((k) => groups.has(k)).map((k) => (
        <Section key={k} title={KIND_LABEL[k] ?? k}>
          <ul className="space-y-2">
            {groups.get(k)!.map((f) => (
              <li key={f.id} className="text-[12px] leading-relaxed text-stone-700">
                <div>{f.statement}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-stone-400">
                  <ProvenanceTag p={f.provenance} />
                  <span>{f.source}</span>
                  <span>· {fmtDate(f.recordedAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      ))}

      {past.length > 0 && (
        <Section title="Recent visits">
          <ul className="space-y-1 text-[12px] text-stone-600">
            {past.map((a) => (
              <li key={a.id}>
                {fmtDate(a.start)} · {a.title.split(" — ")[0]}
                {apptClinician(a) ? ` · ${apptClinician(a)}` : ""}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-400">{title}</div>
      {children}
    </div>
  );
}
