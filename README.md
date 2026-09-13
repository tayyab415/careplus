# CarePlus

An autonomous patient-intake and care-coordination agent for clinics.

Patients often leave consultations with fragmented instructions: multiple tests to schedule, follow-ups to coordinate, accessibility requirements, and vague recollections of past adverse medication reactions. Clinic staff spend hours manually chasing records, calling labs, and answering routine intake questions.

CarePlus automates the administrative and care-coordination workload. Existing and prospective patients interact with the clinic through voice, text, and photo uploads. CarePlus reconstructs messy medication timelines, requests missing physical evidence, consults a specialized open-weight molecular model for biochemical grounding, and executes actions across external clinic operations. It only escalates exceptions and medically consequential edge cases to clinic staff.

CarePlus is autonomous about coordination, not clinical treatment or diagnosis.

---

## The problem

1. **Patient friction and incomplete histories:** Patients forget exact drug formulations or brand names. When an adverse symptom happened in the past, clinics lack the exact chemical entity without tedious manual chart searches.
2. **Administrative burden on clinic staff:** Coordinating blood work, follow-up windows, accessibility accommodations, and lab turnarounds is multi-step manual labor.
3. **Unsafe generic AI chatbots:** Standard LLMs either hallucinate medical advice or refuse to take actionable steps, providing generic conversational disclaimers without completing clinic tasks.

---

## What CarePlus does

- **Reconstructs patient medication timelines:** Resolves ambiguous patient recollections by asking for targeted physical evidence (such as pill bottles or prescription labels) via multimodal inspection.
- **Biochemical property evaluation (TxGemma):** Uses Google's open-weight TxGemma model as a bounded molecular specialist to inspect SMILES representations, targets, and adverse reaction profiles.
- **Dependency-aware appointment orchestration:** Chains interdependent care tasks in order (for example: scheduling a blood draw, calculating lab processing windows, and booking the doctor follow-up only after lab results will be ready).
- **Staff exception routing:** Pushes ambiguous cases, unconfirmed adverse histories, or clinical escalation requests into the clinic's internal operational channels with structured summaries and one-click actions.

---

## External app integrations

CarePlus connects to and executes actions across three external systems to complete end-to-end workflows:

| External app | Role in workflow | Actions taken |
|---|---|---|
| **Google Cloud Platform (Vertex AI & Cloud Storage)** | Molecular inference & secure document storage | 1. Serves the TxGemma open-weight model for molecular structure & adverse-event profile analysis.<br>2. Stores uploaded prescription labels and patient photos with signed verification URLs. |
| **Slack** | Clinic staff exception console | 1. Posts structured escalation cards (`CP-1042`) when adverse reactions or ambiguous histories require human review.<br>2. Listens for staff commands (`why escalated`, `ask follow-up`) to update patient state asynchronously. |
| **Google Calendar / CalDAV Clinic Scheduling** | Dependency-aware appointment booking | 1. Inspects practitioner availability and booking constraints.<br>2. Schedules chained appointments (Lab Draw $\rightarrow$ Follow-up Review) with calendar invites and accessibility notes. |

*(Optional third-party CRM/EMR webhook: Dispatches structured JSON intake summaries to clinic webhook endpoints for EHR record ingestion).*

---

## System architecture

CarePlus uses a hub-and-spoke multi-agent topology to separate patient-facing coordination from specialist domain reasoning:

```
                          +-------------------------+
                          |   Patient Web Portal    |
                          |  (Voice / Text / Photo) |
                          +------------+------------+
                                       |
                                       v
                    +-------------------------------------+
                    |       CarePlus Coordinator Agent     |
                    |        (GPT-5.6 / Gemini Flash)     |
                    +----+---------------------------+----+
                         |                           |
         +---------------+--+                     +--+----------------+
         |                  |                     |                   |
         v                  v                     v                   v
+-----------------+ +----------------+   +-----------------+ +-----------------+
| Patient History | | Vision Label   |   | TxGemma Model   | | Calendar / EHR  |
| Store (GCP/SQL) | | Parser         |   | (Vertex AI)     | | Dispatcher      |
+-----------------+ +----------------+   +--------+--------+ +-----------------+
                                                  |
                                                  v
                                       +---------------------+
                                       |   Slack Exception   |
                                       |   Console (Staff)   |
                                       +---------------------+
```

### Routing layers

1. **Coordinator agent:** Manages dialogue state, enforces intake boundaries, extracts symptoms, and sequences dependencies.
2. **Vision inspection:** Parses uploaded medication labels, identifying active ingredients, NDC codes, and dosages.
3. **TxGemma molecular service:** Receives identified chemical structures and returns verifiable biochemical property bounds (adverse event correlations, molecular targets, formulation properties).
4. **Execution dispatcher:** Books calendar slots, writes case logs to database storage, and dispatches Slack notifications for exceptions.

---

## The core user journey: Medication history reconstruction

### Scenario: Maya's medication review

1. **Intake dialogue:** Maya contacts the clinic portal:  
   *"My doctor recommended this cough medicine, but I took something similar last year and became dizzy. I can't remember exactly what it was. Can you help me arrange a medication review?"*
2. **Context retrieval:** CarePlus pulls Maya's synthetic clinic record. It finds a recorded note from June 2025 documenting dizziness, but no confirmed drug name.
3. **Targeted evidence request:** CarePlus does not guess. It prompts:  
   *"I found your note about dizziness last June, but the exact medication wasn't recorded. Do you have the old bottle or label you could take a photo of?"*
4. **Multimodal verification:** Maya uploads a photo of a label showing *Dextromethorphan / Promethazine*. The vision extractor identifies the compound.
5. **TxGemma analysis:** The agent queries the TxGemma molecular endpoint for the compound's profile. TxGemma confirms known central nervous system side effects matching dizziness.
6. **Autonomous scheduling:** CarePlus identifies that Maya needs a 15-minute medication review rather than urgent emergency triage. It books the consultation on the clinic calendar for 2:30 PM and attaches the uploaded evidence.
7. **Staff loop via Slack:** The agent pushes an escalation summary to the clinic's Slack channel:  
   `[CP-1042] Medication review scheduled: Patient reported dizziness from confirmed Promethazine compound.`  
   Clinic staff clicks a button in Slack: *"Ask patient date of last dose."* The question appears directly in Maya's portal chat.

---

## Reliability and evaluation

To satisfy the hackathon evaluation requirements, CarePlus includes an automated test harness in `tests/` verifying multi-step execution across mock and live environments:

```bash
# Run the verification test suite
npm test
# or
python3 -m pytest tests/ -v
```

### What the test suite verifies

1. **Multi-step state machine integrity:**
   - Verifies that the coordinator transitions through `INTAKE` $\rightarrow$ `EVIDENCE_REQUEST` $\rightarrow$ `SPECIALIST_QUERY` $\rightarrow$ `DISPATCH` without skipping prerequisite steps.
2. **App integration contract tests:**
   - **GCP Storage / Vision:** Asserts valid image upload, signed URL generation, and JSON label extraction.
   - **TxGemma endpoint:** Asserts that input SMILES/chemical identifiers produce schema-valid response payloads with known toxicity/adverse risk metrics.
   - **Slack webhook / Bot:** Asserts formatting of escalation cards and receipt of interactive button callbacks.
   - **Calendar dispatcher:** Asserts sequential appointment ordering (tests fail if a follow-up is scheduled before a lab draw dependency).
3. **Safety boundary enforcement:**
   - Negative tests verifying that the agent rejects diagnostic prompts (*"Do I have cancer?"*) and routes them directly to human staff without hallucinating medical advice.

---

## Quick start

### Prerequisites

- Node.js 20+ or Python 3.11+
- Google Cloud SDK (`gcloud` authenticated)
- Slack Bot Token & Webhook URL
- OpenAI API Key or Google GenAI API Key

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/careplus.git
cd careplus

# Install dependencies
npm install
# and for Python services
pip install -r requirements.txt

# Configure environment variables
cp .env.example .env
```

### Environment variables

```ini
OPENAI_API_KEY=your_openai_key
GOOGLE_GENAI_API_KEY=your_gemini_key
GOOGLE_CLOUD_PROJECT=your_gcp_project_id
GOOGLE_APPLICATION_CREDENTIALS=path/to/credentials.json
SLACK_BOT_TOKEN=xoxb-your-token
SLACK_CHANNEL_ID=C0123456789
CALENDAR_API_KEY=your_calendar_key
```

### Running the application

```bash
# Start the backend agent service & TxGemma mock/connector
npm run dev

# In a separate terminal, launch the patient portal UI
npm run start:portal
```

Open `http://localhost:3000` to interact with the patient clinic portal.

---

## Demo video

Watch the 2-minute demonstration: **[Link to Demo Video (YouTube / Loom)]**

### Demo breakdown (under 120 seconds)

- **0:00 - 0:25:** Patient explains past adverse reaction via portal voice/text; CarePlus identifies the missing record.
- **0:25 - 0:50:** Patient uploads photo of medicine bottle; vision module extracts chemical entity and TxGemma runs molecular evaluation.
- **0:50 - 1:20:** CarePlus resolves dependency, books the medication-review appointment, and posts the case record to Slack.
- **1:20 - 1:50:** Clinic staff in Slack queries the agent (*"Why was CP-1042 escalated?"*) and pushes a follow-up question back to the patient.
- **1:50 - 2:00:** Verification suite runs showing 100% test pass on multi-app tool execution.
