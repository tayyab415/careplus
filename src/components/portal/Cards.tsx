"use client";

import { useState } from "react";
import type { Card, TxGemmaSignal, ResolvedMedication } from "@/core/types";
import { Button, ProvenanceTag } from "@/components/ui";
import { fmtDateTime, MODE_LABEL } from "@/lib/ui";

interface CardProps {
  card: Card;
  onSend: (text: string) => void;
  onUploadClick: () => void;
  busy: boolean;
  isLatest: boolean;
}

export function CardView(props: CardProps) {
  const { card } = props;
  switch (card.type) {
    case "evidence_request":
      return <EvidenceRequest {...props} card={card} />;
    case "extraction_confirm":
      return <ExtractionConfirm {...props} card={card} />;
    case "medication":
      return <MedicationCard medication={card.medication} />;
    case "research_signal":
      return <ResearchSignalCard signals={card.signals} />;
    case "slot_options":
      return <SlotOptions {...props} card={card} />;
    case "receipt":
      return <Receipt reference={card.reference} items={card.items} />;
    case "urgent":
      return <Urgent heading={card.heading} instructions={card.instructions} callNumber={card.callNumber} />;
    case "staff_question":
      return <StaffQuestion question={card.question} />;
    default:
      return null;
  }
}

function Shell({ label, tone = "neutral", children }: { label: string; tone?: "neutral" | "accent" | "amber" | "red" | "violet"; children: React.ReactNode }) {
  const ring = tone === "accent" ? "border-teal-200" : tone === "amber" ? "border-amber-200" : tone === "red" ? "border-red-300" : tone === "violet" ? "border-violet-200" : "border-line";
  const head = tone === "accent" ? "text-accent" : tone === "amber" ? "text-amber" : tone === "red" ? "text-red" : tone === "violet" ? "text-violet-700" : "text-stone-500";
  return (
    <div className={`mt-2 rounded-xl border bg-white ${ring}`}>
      <div className={`border-b border-inherit px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wide ${head}`}>{label}</div>
      <div className="px-3.5 py-3">{children}</div>
    </div>
  );
}

function EvidenceRequest({ card, onUploadClick, isLatest, busy }: CardProps & { card: Extract<Card, { type: "evidence_request" }> }) {
  return (
    <Shell label="Upload requested" tone="accent">
      <p className="text-[13px] text-stone-700">{card.prompt}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {card.accepted.map((a) => (
          <span key={a} className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-600">
            {a.replace(/_/g, " ")}
          </span>
        ))}
      </div>
      {isLatest && (
        <div className="mt-3 flex items-center gap-2">
          <Button onClick={onUploadClick} disabled={busy}>
            <CameraIcon /> Take a photo or upload
          </Button>
          <span className="text-[12px] text-stone-500">JPG, PNG or PDF</span>
        </div>
      )}
    </Shell>
  );
}

function ExtractionConfirm({ card, onSend, isLatest, busy }: CardProps & { card: Extract<Card, { type: "extraction_confirm" }> }) {
  const x = card.extraction;
  const rows: [string, string | null][] = [
    ["Product", x.productName],
    ["Active ingredients", x.activeIngredients.join(", ") || null],
    ["Strength", x.strength],
    ["Form", x.dosageForm],
    ["Directions", x.directions],
    ["Prescribed", x.prescriptionDate],
    ["Prescriber", x.prescriber],
    ["Pharmacy", x.pharmacy],
    ["Name on label", x.patientNameOnLabel],
  ];
  const pct = Math.round(x.confidence * 100);
  return (
    <Shell label="What we read from your photo — please check" tone="violet">
      <div className="mb-2 flex items-center justify-between">
        <ProvenanceTag p="document_extracted" />
        <span className={`text-[12px] font-medium ${pct >= 80 ? "text-green" : pct >= 60 ? "text-amber" : "text-red"}`}>Reading confidence {pct}%</span>
      </div>
      <dl className="grid grid-cols-[130px_1fr] gap-y-1 text-[13px]">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-stone-500">{k}</dt>
              <dd className="text-stone-800">{v}</dd>
            </div>
          ))}
      </dl>
      {x.warnings.length > 0 && <p className="mt-2 text-[12px] text-amber">{x.warnings.join(" · ")}</p>}
      {isLatest && (
        <div className="mt-3 flex gap-2">
          <Button onClick={() => onSend("Yes, that's correct.")} disabled={busy}>
            Yes, that&apos;s right
          </Button>
          <Button variant="secondary" onClick={() => onSend("Something in that reading is wrong. Let me correct it: ")} disabled={busy}>
            Something&apos;s wrong
          </Button>
        </div>
      )}
      <p className="mt-2 text-[11px] text-stone-400">Nothing from a photo becomes part of your record until you confirm it.</p>
    </Shell>
  );
}

export function MedicationCard({ medication: m }: { medication: ResolvedMedication }) {
  const [open, setOpen] = useState(false);
  return (
    <Shell label="Medicine identified" tone="neutral">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[14px] font-semibold text-stone-900">{m.rxnormName ?? m.queryName}</div>
          <div className="text-[12px] text-stone-500">
            {m.ingredients.map((i) => i.name).join(" + ")}
            {m.strength ? ` · ${m.strength}` : ""}
            {m.dosageForm ? ` · ${m.dosageForm}` : ""}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <ProvenanceTag p="database_verified" />
          <span className="text-[11px] text-stone-400">{m.matchQuality === "exact" ? "Exact RxNorm match" : m.matchQuality === "approximate" ? "Approximate match" : "Unresolved"}</span>
        </div>
      </div>
      {m.molecules.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {m.molecules.map((mol) => (
            <div key={mol.pubchem.cid} className="rounded-lg bg-stone-50 px-2.5 py-2">
              <div className="flex items-center justify-between text-[12px]">
                <span className="font-medium text-stone-700">{mol.ingredient}</span>
                <a className="text-accent hover:underline" href={`https://pubchem.ncbi.nlm.nih.gov/compound/${mol.pubchem.cid}`} target="_blank" rel="noreferrer">
                  PubChem CID {mol.pubchem.cid}
                </a>
              </div>
              <div className="mt-1 break-all font-mono text-[11px] text-stone-500">{mol.pubchem.canonicalSmiles}</div>
              {mol.pubchem.molecularFormula && (
                <div className="mt-0.5 text-[11px] text-stone-400">
                  {mol.pubchem.molecularFormula}
                  {mol.pubchem.molecularWeight ? ` · ${mol.pubchem.molecularWeight.toFixed(1)} g/mol` : ""}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {m.labels.length > 0 && (
        <div className="mt-3">
          <button className="text-[12px] font-medium text-accent hover:underline" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide" : "Show"} official label information (openFDA)
          </button>
          {open && (
            <div className="mt-2 space-y-3">
              {m.labels.map((l) => (
                <div key={l.ingredient} className="text-[12px]">
                  <div className="mb-1 font-medium text-stone-700">
                    {l.ingredient} {l.label.brandName ? `· ${l.label.brandName}` : ""}
                  </div>
                  {l.label.boxedWarning && <LabelSection title="Boxed warning" text={l.label.boxedWarning} tone="red" />}
                  {l.label.warnings && <LabelSection title="Warnings" text={l.label.warnings} />}
                  {l.label.warningsAndCautions && <LabelSection title="Warnings and cautions" text={l.label.warningsAndCautions} />}
                  {l.label.adverseReactions && <LabelSection title="Adverse reactions" text={l.label.adverseReactions} />}
                  {l.label.contraindications && <LabelSection title="Contraindications" text={l.label.contraindications} />}
                  {l.label.drugInteractions && <LabelSection title="Drug interactions" text={l.label.drugInteractions} />}
                </div>
              ))}
              <p className="text-[11px] text-stone-400">Official manufacturer labelling. This is reference information for you and the clinic — not advice about your situation.</p>
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}

function LabelSection({ title, text, tone }: { title: string; text: string; tone?: "red" }) {
  const [more, setMore] = useState(false);
  const short = text.length > 420 && !more ? text.slice(0, 420) + "…" : text;
  return (
    <div className={`mb-2 rounded-lg px-2.5 py-2 ${tone === "red" ? "bg-red-soft" : "bg-stone-50"}`}>
      <div className={`text-[11px] font-semibold uppercase tracking-wide ${tone === "red" ? "text-red" : "text-stone-500"}`}>{title}</div>
      <p className="mt-1 whitespace-pre-line leading-relaxed text-stone-700">{short}</p>
      {text.length > 420 && (
        <button className="mt-1 text-[11px] text-accent hover:underline" onClick={() => setMore((m) => !m)}>
          {more ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}

export function ResearchSignalCard({ signals }: { signals: TxGemmaSignal[] }) {
  const [showPrompt, setShowPrompt] = useState<string | null>(null);
  return (
    <Shell label="TxGemma research signal · for the clinic team" tone="violet">
      <div className="mb-2 flex items-center justify-between">
        <ProvenanceTag p="model_predicted" />
        <span className="text-[11px] text-stone-400">{signals[0]?.model ?? "TxGemma"} on Vertex AI</span>
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-stone-400">
            <th className="pb-1 font-medium">Compound</th>
            <th className="pb-1 font-medium">Task</th>
            <th className="pb-1 font-medium">Model output</th>
          </tr>
        </thead>
        <tbody>
          {signals.map((s, i) => (
            <tr key={i} className="border-t border-line align-top">
              <td className="py-1.5 pr-2 font-medium text-stone-700">{s.ingredient}</td>
              <td className="py-1.5 pr-2 text-stone-600">
                <button className="text-left hover:underline" onClick={() => setShowPrompt(showPrompt === `${i}` ? null : `${i}`)} title="Show the exact prompt and raw output">
                  {s.taskLabel}
                </button>
              </td>
              <td className="py-1.5 text-stone-700">
                {s.kind === "classification" ? (
                  <span>
                    <span className="mr-1 rounded bg-stone-100 px-1 font-mono text-[11px]">{s.choice ?? "?"}</span>
                    {s.meaning}
                  </span>
                ) : (
                  <span>
                    {s.value ?? "?"} <span className="text-stone-400">(normalised)</span> · {s.meaning}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {showPrompt !== null && signals[Number(showPrompt)] && (
        <div className="mt-2 rounded-lg bg-stone-50 p-2.5 font-mono text-[11px] text-stone-600">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-stone-400">Prompt</div>
          <pre className="whitespace-pre-wrap">{signals[Number(showPrompt)].prompt}</pre>
          <div className="mb-1 mt-2 text-[10px] uppercase tracking-wide text-stone-400">Raw output</div>
          <pre className="whitespace-pre-wrap">{signals[Number(showPrompt)].rawOutput}</pre>
          <div className="mt-1 text-[10px] text-stone-400">{signals[Number(showPrompt)].latencyMs} ms</div>
        </div>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-stone-400">{signals[0]?.disclaimer}</p>
    </Shell>
  );
}

function SlotOptions({ card, onSend, isLatest, busy }: CardProps & { card: Extract<Card, { type: "slot_options" }> }) {
  return (
    <Shell label={`Available times · ${card.title}`} tone="accent">
      <div className="grid gap-2 sm:grid-cols-3">
        {card.slots.map((s, i) => (
          <button
            key={i}
            disabled={!isLatest || busy}
            onClick={() => onSend(`I'll take ${fmtDateTime(s.start)}${s.clinician ? ` with ${s.clinician}` : ""} for the ${card.title.toLowerCase()}.`)}
            className="rounded-lg border border-line bg-white px-3 py-2 text-left transition enabled:hover:border-accent enabled:hover:bg-accent-soft disabled:opacity-60"
          >
            <div className="text-[13px] font-medium text-stone-800">{fmtDateTime(s.start)}</div>
            <div className="text-[11px] text-stone-500">
              {MODE_LABEL[s.mode]}
              {s.clinician ? ` · ${s.clinician}` : ""}
            </div>
            {s.location && <div className="text-[11px] text-stone-400">{s.location}</div>}
          </button>
        ))}
      </div>
    </Shell>
  );
}

function Receipt({ reference, items }: { reference: string; items: string[] }) {
  return (
    <Shell label={`What CarePlus did · ref ${reference}`} tone="accent">
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-2 text-[13px] text-stone-700">
            <span className="mt-0.5 inline-flex h-4 w-4 flex-none items-center justify-center rounded-full bg-accent-soft text-[10px] font-bold text-accent">✓</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </Shell>
  );
}

function Urgent({ heading, instructions, callNumber }: { heading: string; instructions: string; callNumber: string }) {
  return (
    <div className="mt-2 rounded-xl border-2 border-red bg-red-soft p-4">
      <div className="text-[15px] font-semibold text-red">{heading}</div>
      <p className="mt-1 text-[13px] leading-relaxed text-stone-800">{instructions}</p>
      <a href={`tel:${callNumber}`} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-red px-4 py-2 text-[14px] font-semibold text-white hover:bg-red-800">
        Call {callNumber} now
      </a>
      <p className="mt-2 text-[11px] text-stone-500">The clinic team has been alerted. This is the clinic&apos;s approved instruction, not a diagnosis.</p>
    </div>
  );
}

function StaffQuestion({ question }: { question: string }) {
  return (
    <div className="mt-1 rounded-xl border border-amber-200 bg-amber-soft px-3.5 py-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-amber">Question from the clinic team</div>
      <p className="mt-1 text-[13px] text-stone-800">{question}</p>
      <p className="mt-1 text-[11px] text-stone-500">Reply below — your answer goes straight back to the reviewing clinician.</p>
    </div>
  );
}

export function CameraIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}
