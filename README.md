# CarePlus

**An autonomous patient-intake and care-coordination agent for a clinic.**

Patients talk to CarePlus through the clinic's website. It reads their clinic record, asks only for what is missing (a photo of the bottle, a discharge paper), resolves medicines against authoritative sources, runs a bounded molecular research signal through **TxGemma**, and completes the next administrative step — booking, follow-ups, confirmations. Routine cases finish on their own. Only uncertain or medically consequential cases reach staff, in Slack or the staff console.

CarePlus **coordinates**. It does not diagnose, prescribe, change medicines, determine causation or declare a medicine safe.

---

## Run it

```bash
npm install
cp .env.example .env        # fill in OPENAI_API_KEY and the TxGemma endpoint (see below)
npm run dev                 # http://localhost:3000
```

Everything else runs with defaults: in-memory store persisted to `.careplus/store.json`, simulated SMS (a virtual phone in the UI), Google Calendar via the service-account key in `./secrets`, and the web **staff console** standing in for Slack until tokens are added.

| Command | What it does |
| --- | --- |
| `npm run dev` | Patient portal, staff console, research view |
| `npm run eval [scenario…]` | Scripted end-to-end scenarios through the real coordinator, with assertions (`maya`, `arjun`, `tom`, `lucia`, `grace`, `red`, `historical-not-red`, `prospective`) |
| `npm run smoke -- resolver "…"` | Exercise one specialist in isolation (`resolver`, `txgemma`, `vision`, `redflag`, `slots`, `calendar`) |
| `npm run slack` | Socket-Mode Slack bot (needs tokens — see *Slack*) |
| `npm run typecheck` | `tsc --noEmit` |

### Demo walkthrough (the two-minute ending)

1. Open `/`, choose **Maya Lin** (member, verified record).
2. Say: *"My doctor recommended this cough medicine, but I took something similar last year and became dizzy. I cannot remember exactly what it was. Can you help me arrange a medication review?"*
   CarePlus finds the unconfirmed 2025 dizziness report in her record and asks for the bottle.
3. Upload `public/demo/promethazine-bottle.png`. Gemini reads the label; the card shows the extraction and its confidence. **Confirm it** — nothing from a photo becomes record until the patient says so.
4. In one turn CarePlus: resolves the medicine (RxNorm → PubChem SMILES → openFDA label), runs TxGemma (ClinTox + blood-brain-barrier) on both ingredients, hits the **amber** policy (prior adverse experience), **holds** a video medication review with her usual GP (real Google Calendar event), sends the SMS (lands on the virtual phone), and opens a staff review.
5. Open `/staff` in another tab. Ask *"Why was this case routed for review?"* — the answer comes from the decision trace with provenance labels. Click **Ask patient: date of last dose**.
6. Back on Maya's tab the question appears in the chat and on her phone. Answer it; the reviewer sees it. Click **Confirm appointment** in the console; the hold becomes a booking and Maya gets the confirmation.

Other personas show the other paths: **Arjun** (three dependency-aware bookings, wheelchair-accessible physio, fully autonomous), **Lucia** (Portuguese; routine asthma review booked *and* a medication review held for a prior rash — one staff review), **Tom** (post-discharge, doesn't know what to book), **Grace** (research pre-screen with consent + records transfer), **I'm new here** (prospective intake → provisional record → first visit).

---

## Architecture

```
Patient portal (Next.js)  ── text · voice · photo/PDF ──▶  /api/chat (SSE)
                                                              │
                                              Coordinator (GPT 5.6 Luna, tool-calling loop)
                                                              │
        ┌──────────────┬──────────────┬─────────────┬─────────┴───────┬───────────────┬──────────────┐
   Case store      Vision OCR      RxNorm ·      openFDA         TxGemma 2B        Policy engine    Actions
 (Firestore or   (Gemini 3.1     PubChem        official         (Vertex AI        (deterministic   Calendar (SA)
  memory)         Flash Lite)    SMILES         label            endpoint)         red/amber/green)  SMS/virtual phone
                                                                                                     Slack / staff console
```

**Who decides what.** The coordinator LLM gathers, asks, resolves and explains. It never picks the route itself: it calls `evaluate_routing` and the **policy engine** (clinic-authored, deterministic) returns the tier and what may be booked. Red flags are screened *before* the LLM sees the message (keyword rules + a fast classifier for historical vs current mentions). TxGemma only ever sees a SMILES string and returns a research signal that is labelled as such everywhere it appears.

**Provenance is first-class.** Every fact is tagged `patient_reported`, `document_extracted`, `database_verified`, `model_predicted`, `staff_confirmed` or `clinic_policy`, and the UI shows the tag. Staff can ask "which facts came from a document and which from the patient?" and get two lists.

**Tiers.**

- **Green** — autonomous: reconstruct history, request documents, resolve medicines, pick appointment type, book allowed types, send confirmations, record preferences.
- **Amber** — reversible preparation, then review: prior adverse experience, uncertain match, new medicine alongside a high-monitoring one (e.g. warfarin), post-discharge medication change, conflicting records, TxGemma vs label disagreement, questions needing clinician judgement. CarePlus *holds* the review slot and gathers evidence while staff review. Routine bookings requested in the same conversation still complete.
- **Red** — clinic-authored rules only. Ordinary workflow stops, approved urgent instruction is shown with a call action, staff alerted.

### Code map

```
src/agent/         coordinator loop, system prompt, tool definitions + handlers, context builder
src/core/policy/   red-flag screen, routing engine
src/core/types.ts  zod schemas: Fact (provenance), Patient, Case, StaffReview, Card, TxGemmaSignal…
src/core/store/    CaseStore interface; Firestore + in-memory implementations
src/specialists/   vision label extractor · RxNorm/PubChem/openFDA resolver · TxGemma client + TDC task selection
src/actions/       scheduler + Google Calendar · patient messaging (Twilio/virtual phone) · Slack cards · staff reviews
src/data/          synthetic clinic (roster, rooms, appointment types, red-flag rules, studies) + 5 synthetic patients
src/app/           portal, staff console, research view, API routes
scripts/           eval.ts (scenario harness), smoke.ts, slack-bot.ts
```

### TxGemma

`txgemma-2b-predict` from Vertex AI Model Garden, deployed to a dedicated endpoint. Prompts are the TDC templates shipped with the model (`src/specialists/txgemma/tdc_prompts.json`). Tasks are chosen from what the patient reported (dizziness/drowsiness → `BBB_Martins`; rash → `Skin_Reaction`; palpitations → `hERG`; interaction concerns → CYP tasks) with `ClinTox` always on. Regression tasks are excluded from auto-selection after evaluation showed low-quality outputs at 2B. The routing engine compares each signal with the official label's adverse-reactions section and records either *corroborating context* or a *disagreement* (which is an amber trigger).

---

## Configuration

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY`, `COORDINATOR_MODEL` (`gpt-5.6-luna`), `COORDINATOR_REASONING` (`low`) | Coordinator |
| `GOOGLE_CLOUD_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS` | ADC or SA key (auto-detected at `./secrets/careplus-agent.json`) |
| `FAST_MODEL`, `VISION_MODEL` (`gemini-3.1-flash-lite`) | Red-flag classifier, label OCR — served via Vertex AI |
| `TXGEMMA_ENDPOINT_ID`, `TXGEMMA_DEDICATED_DNS`, `TXGEMMA_LOCATION` | Vertex endpoint (from `gcloud ai endpoints describe`) |
| `STORE_BACKEND` (`memory` \| `firestore`), `FIRESTORE_DATABASE` | Store. Firestore DB `careplus` (Native mode) already exists in the project |
| `CLINIC_CALENDAR_ID`, `CALENDAR_SHARE_WITH` | Clinic calendar owned by the SA; created on first use and shared with you |
| `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_TRIAGE_CHANNEL` | Slack exception console |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Real SMS; otherwise the virtual phone |
| `CAREPLUS_DRY_RUN` | Simulate every external action |
| `PUBLIC_BASE_URL` | Portal link appended to every SMS |

### Slack

1. api.slack.com/apps → *Create New App* → *From an app manifest* → paste `slack-app-manifest.yaml`.
2. Install to workspace → Bot User OAuth Token → `SLACK_BOT_TOKEN`.
3. Basic Information → App-Level Tokens → create with `connections:write` → `SLACK_APP_TOKEN`.
4. Create a private channel, invite the bot, put the channel ID in `SLACK_TRIAGE_CHANNEL`.
5. `npm run slack` next to `npm run dev`.

Cards then post to the channel with the same buttons as the staff console; thread replies under a card, DMs, or @mentions ("Why was CP-1042 escalated?", "Show cases waiting longer than two hours") are answered from the decision trace.

---

## What is real, what is simulated

| | Live | When unavailable |
| --- | --- | --- |
| Coordinator (OpenAI) | ✓ | — |
| Gemini via Vertex (OCR, classifier) | ✓ | — |
| TxGemma on Vertex | ✓ (dedicated endpoint) | — |
| RxNorm · PubChem · openFDA | ✓ public APIs | — |
| Google Calendar | ✓ service-account calendar, events created/updated/cancelled | `CAREPLUS_DRY_RUN=true` |
| Firestore | ✓ (`STORE_BACKEND=firestore`) | in-memory store (`.careplus/store.json`) |
| Slack | with tokens | web staff console at `/staff` |
| SMS | with Twilio | virtual phone panel in the portal |

All patients, records, clinicians and the clinic are synthetic. Nothing here is a compliance, privacy or security design — that is a deliberate non-claim.
