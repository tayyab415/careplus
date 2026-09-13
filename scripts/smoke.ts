/**
 * Smoke-test the specialists one by one, outside the agent loop.
 *   npx tsx scripts/smoke.ts resolver "Promethazine HCl and Dextromethorphan HBr oral solution"
 *   npx tsx scripts/smoke.ts txgemma "CC(CN1C2=CC=CC=C2SC3=CC=CC=C31)N(C)C" dizziness
 *   npx tsx scripts/smoke.ts vision public/demo/promethazine-bottle.png
 *   npx tsx scripts/smoke.ts redflag "I took the whole bottle"
 *   npx tsx scripts/smoke.ts slots medication_review video
 *   npx tsx scripts/smoke.ts calendar
 */
import fs from "node:fs";
import { resolveMedication } from "@/specialists/medication/resolver";
import { runTxGemma } from "@/specialists/txgemma/client";
import { extractLabel } from "@/specialists/vision/labelExtractor";
import { screenRedFlags } from "@/core/policy/redFlags";
import { findSlots } from "@/actions/scheduler";
import { ensureClinicCalendar, freeBusy } from "@/actions/calendar";
import { getStore } from "@/core/store";
import { seedStore } from "@/data/seed";
import { formatLocal } from "@/core/time";

const [, , cmd, ...rest] = process.argv;

async function main() {
  switch (cmd) {
    case "resolver": {
      const med = await resolveMedication({ name: rest.join(" ") });
      console.log(JSON.stringify({ ...med, label: med.label ? { ...med.label, warnings: med.label.warnings?.slice(0, 200), adverseReactions: med.label.adverseReactions?.slice(0, 200), drugInteractions: med.label.drugInteractions?.slice(0, 200) } : undefined }, null, 2));
      break;
    }
    case "txgemma": {
      const [smiles, ...themes] = rest;
      const t0 = Date.now();
      const signals = await runTxGemma({ ingredient: "test", smiles, reportedThemes: themes.join(" ") || "dizziness rash palpitations" });
      console.log(`${Date.now() - t0} ms`);
      for (const s of signals) console.log(`${s.task.padEnd(20)} raw="${s.rawOutput}" → ${s.meaning}`);
      break;
    }
    case "vision": {
      const file = rest[0];
      const b64 = fs.readFileSync(file).toString("base64");
      const mime = file.endsWith(".png") ? "image/png" : file.endsWith(".pdf") ? "application/pdf" : "image/jpeg";
      const t0 = Date.now();
      const ex = await extractLabel({ mimeType: mime, base64: b64 });
      console.log(`${Date.now() - t0} ms`);
      console.log(JSON.stringify(ex, null, 2));
      break;
    }
    case "redflag": {
      const r = await screenRedFlags(rest.join(" "));
      console.log(r);
      break;
    }
    case "slots": {
      await seedStore(getStore());
      const slots = await findSlots({ appointmentTypeId: rest[0] ?? "medication_review", mode: rest[1] as "video" | undefined, limit: 6 });
      for (const s of slots) console.log(formatLocal(s.start), s.mode, s.location ?? "", s.clinician);
      break;
    }
    case "calendar": {
      const id = await ensureClinicCalendar();
      console.log("calendar id:", id);
      const busy = await freeBusy(new Date().toISOString(), new Date(Date.now() + 7 * 86400000).toISOString());
      console.log("busy periods next 7d:", busy.length);
      break;
    }
    default:
      console.log("commands: resolver | txgemma | vision | redflag | slots | calendar");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
