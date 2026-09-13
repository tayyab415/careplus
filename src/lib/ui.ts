/** Client-safe helpers shared by the portal and staff console. */

export const CLINIC_TZ = "Australia/Sydney";

export function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-AU", { timeZone: CLINIC_TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-AU", { timeZone: CLINIC_TZ, day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

export function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-AU", { timeZone: CLINIC_TZ, hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export function ago(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export const PROVENANCE_LABEL: Record<string, string> = {
  patient_reported: "Patient reported",
  document_extracted: "From document",
  database_verified: "Verified",
  model_predicted: "Model signal",
  staff_confirmed: "Staff confirmed",
  clinic_policy: "Clinic policy",
};

export const PROVENANCE_CLASS: Record<string, string> = {
  patient_reported: "bg-sky-50 text-sky-800 ring-sky-200",
  document_extracted: "bg-violet-50 text-violet-800 ring-violet-200",
  database_verified: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  model_predicted: "bg-fuchsia-50 text-fuchsia-800 ring-fuchsia-200",
  staff_confirmed: "bg-teal-50 text-teal-800 ring-teal-200",
  clinic_policy: "bg-stone-100 text-stone-700 ring-stone-200",
};

export const MODE_LABEL: Record<string, string> = { in_person: "In person", video: "Video", phone: "Phone" };

/** Tiny markdown: **bold**, bullet / numbered lists, paragraphs. Good enough for agent replies. */
export function renderMarkdown(text: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`(.+?)`/g, "<code>$1</code>");
  const lines = text.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join("<br/>")}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const ul = line.match(/^\s*[-•*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const kind = ul ? "ul" : "ol";
      if (list !== kind) {
        closeList();
        list = kind;
        out.push(`<${kind}>`);
      }
      out.push(`<li>${inline((ul ?? ol)![1])}</li>`);
    } else if (line.trim() === "") {
      flushPara();
      closeList();
    } else {
      closeList();
      para.push(line);
    }
  }
  flushPara();
  closeList();
  return out.join("");
}

/** Appointment.clinician holds the roster id (for conflict checks); the display name lives in the title suffix. */
export function apptClinician(a: { title: string; clinician?: string }): string | undefined {
  const fromTitle = a.title.split(" — ")[1];
  return fromTitle ?? a.clinician;
}
