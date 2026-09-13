"use client";

import type { ReactNode } from "react";
import { PROVENANCE_CLASS, PROVENANCE_LABEL } from "@/lib/ui";

export function TierBadge({ tier, size = "sm" }: { tier?: string | null; size?: "sm" | "md" }) {
  if (!tier) return null;
  const cls =
    tier === "red" ? "bg-red-soft text-red ring-red-200" : tier === "amber" ? "bg-amber-soft text-amber ring-amber-200" : "bg-green-soft text-green ring-green-200";
  const label = tier === "red" ? "Urgent" : tier === "amber" ? "Staff review" : "Routine";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full ring-1 font-medium ${cls} ${size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${tier === "red" ? "bg-red" : tier === "amber" ? "bg-amber" : "bg-green"}`} />
      {label}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    open: ["Open", "bg-stone-100 text-stone-700 ring-stone-200"],
    awaiting_patient: ["Waiting on patient", "bg-sky-50 text-sky-800 ring-sky-200"],
    awaiting_staff: ["Waiting on clinic", "bg-amber-soft text-amber ring-amber-200"],
    completed: ["Completed", "bg-green-soft text-green ring-green-200"],
    urgent: ["Urgent", "bg-red-soft text-red ring-red-200"],
    held: ["Reserved · pending staff", "bg-amber-soft text-amber ring-amber-200"],
    confirmed: ["Confirmed", "bg-green-soft text-green ring-green-200"],
    cancelled: ["Cancelled", "bg-stone-100 text-stone-500 ring-stone-200"],
    in_progress: ["In progress", "bg-sky-50 text-sky-800 ring-sky-200"],
    resolved: ["Resolved", "bg-green-soft text-green ring-green-200"],
    dismissed: ["Dismissed", "bg-stone-100 text-stone-500 ring-stone-200"],
    sent: ["Sent", "bg-green-soft text-green ring-green-200"],
    simulated: ["Simulated", "bg-stone-100 text-stone-600 ring-stone-200"],
    failed: ["Failed", "bg-red-soft text-red ring-red-200"],
  };
  const [label, cls] = map[status] ?? [status, "bg-stone-100 text-stone-700 ring-stone-200"];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${cls}`}>{label}</span>;
}

export function ProvenanceTag({ p }: { p: string }) {
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ${PROVENANCE_CLASS[p] ?? "bg-stone-100 text-stone-700 ring-stone-200"}`}>{PROVENANCE_LABEL[p] ?? p}</span>;
}

export function Panel({ title, action, children, className = "" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-panel ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h3 className="text-[13px] font-semibold text-stone-800">{title}</h3>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-[13px] text-muted">{children}</p>;
}

export function Dots() {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="dot h-1.5 w-1.5 rounded-full bg-stone-500" />
      <span className="dot h-1.5 w-1.5 rounded-full bg-stone-500" />
      <span className="dot h-1.5 w-1.5 rounded-full bg-stone-500" />
    </span>
  );
}

export function Button({ children, onClick, variant = "primary", disabled, type = "button", className = "", title }: { children: ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "ghost" | "danger"; disabled?: boolean; type?: "button" | "submit"; className?: string; title?: string }) {
  const base = "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition disabled:opacity-50 disabled:cursor-not-allowed";
  const v =
    variant === "primary"
      ? "bg-accent text-white hover:bg-teal-800"
      : variant === "secondary"
        ? "border border-line bg-white text-stone-800 hover:bg-stone-50"
        : variant === "danger"
          ? "bg-red text-white hover:bg-red-800"
          : "text-stone-700 hover:bg-stone-100";
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} className={`${base} ${v} ${className}`}>
      {children}
    </button>
  );
}
