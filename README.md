# CarePlus

An autonomous patient-intake and care-coordination agent for clinics, grounded by open-weight biochemical foundation models.

Patients frequently present to clinics with fragmented care directives: multiple tests to arrange, follow-up timelines to calculate, accessibility accommodations to verify, and ambiguous recollections of prior adverse drug reactions. Clinic administrative staff spend significant daily hours manually tracking records, calling testing sites, and verifying clinical timelines.

CarePlus automates clinic administrative coordination. Patients interact with the clinic through text, voice, and document uploads. CarePlus reconstructs incomplete medication timelines, requests targeted physical verification (such as prescription labels or bottle photographs), computes molecular property predictions using Google's open-weight **TxGemma** foundation model, and executes actions across clinic scheduling and internal staff operations.

CarePlus executes operational coordination. It does not provide clinical diagnosis or prescribe treatments. When molecular predictions flag adverse events, or when historical data contains unresolvable ambiguity, CarePlus escalates structured case briefs directly to clinic staff.

---

## Technical core: TxGemma molecular evaluation pipeline

Generic large language models hallucinate chemical properties and lack grounding in pharmacology datasets. CarePlus uses Google's open-weight **TxGemma** (part of the Health AI Developer Foundations / HAI-DEF suite) deployed on Google Cloud Vertex AI as a bounded biochemical specialist.

```
+-------------------------------------------------------------------------------+
|                       TxGemma Molecular Inference Engine                      |
|                                                                               |
|  [Uploaded Prescription / Bottle]                                             |
|               |                                                               |
|               v                                                               |
|   +-----------------------+     REST API      +---------------------------+   |
|   | Vision OCR Extractor  | ----------------> | NIH PubChem PUG REST API  |   |
|   +-----------------------+                   +-------------+-------------+   |
|                                                             |                 |
|                                      Canonical SMILES & CID |                 |
|                                                             v                 |
|   +-----------------------------------------------------------------------+   |
|   |                  TxGemma Predict Model (Vertex AI)                    |   |
|   |  Pre-trained Benchmark Tasks: Therapeutics Data Commons (TDC) Suite   |   |
|   +-----------------------------------+-----------------------------------+   |
|                                       |                                       |
|             +-------------------------+-------------------------+             |
|             |                                                   |             |
|             v                                                   v             |
|  [ClinTox / FDA Approval]                           [BBB_Martins Permeability] |
|  P(Clinical Toxicity Fail)                          P(Blood-Brain Barrier Cross)|
|             |                                                   |             |
|             +-------------------------+-------------------------+             |
|                                       |                                       |
|                                       v                                       |
|                  +-----------------------------------------+                  |
|                  |     Biochemical Safety Profile JSON     |                  |
|                  |  - Compound: Promethazine               |                  |
|                  |  - SMILES: CC(CN1C2=CC=CC=C2SC3=CC=CC=C31)|                  |
|                  |  - BBB Penetration: High (>0.89)        |                  |
|                  |  - CNS Sedation / Dizziness Risk: Severe|                  |
|                  +--------------------+--------------------+                  |
|                                       |                                       |
|                                       v                                       |
|                       CarePlus Coordinator Agent Plan                         |
+-------------------------------------------------------------------------------+
```

### 1. Representation & chemical entity resolution
- **Image ingestion:** When a patient uploads physical evidence, the vision module extracts drug trade names, active pharmaceutical ingredients (APIs), and National Drug Codes (NDCs).
- **PubChem PUG REST integration:** The agent queries NCBI PubChem (`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{name}/property/CanonicalSMILES,MolecularWeight,MolecularFormula/JSON`) to obtain verified chemical identifiers, including Canonical SMILES, CID, and molecular weights.

### 2. Therapeutics Data Commons (TDC) model execution
TxGemma is trained on the Therapeutics Data Commons benchmark suite across 66 molecular property tasks. CarePlus invokes specific TDC task prompts against the Vertex AI endpoint:
- **`ClinTox` benchmark task:** Evaluates clinical trial toxicity failures and FDA approval status to determine clinical risk profiles.
- **`BBB_Martins` (Blood-Brain Barrier) benchmark task:** Evaluates blood-brain barrier permeability. For example, verifying whether a compound cross-penetrates the central nervous system (CNS), correlating patient-reported dizziness, lethargy, or vertigo with molecular pharmacokinetics.
- **Drug-drug interaction (DDI) & target profile:** Classifies adverse metabolic pathways when combined with active prescriptions in the patient's existing clinic profile.

### 3. Bounded specialist output
TxGemma returns structured predictions (classification probabilities and regression values) rather than unconstrained conversational text. The coordinator agent parses these numerical outputs into deterministic risk tiers:
- **`LOW_RISK_ADMIN`:** No contradictory adverse markers detected. Completes administrative booking automatically.
- **`ADVERSE_HISTORICAL_CORRELATION`:** Molecular profile corroborates patient's reported symptoms (e.g. Promethazine crossing BBB matching historical dizziness). Schedules dedicated 15-minute medication review and generates an escalation payload.
- **`CONTRAINDICATION_ALERT`:** High-probability DDI or toxicity threshold exceeded. Halts self-service booking and triggers an urgent staff callback task in Slack.

---

## External app integrations

CarePlus connects to three external services to complete the end-to-end loop:

| External service | Role in pipeline | Concrete API actions |
|---|---|---|
| **Google Cloud Platform (Vertex AI & Cloud Storage)** | Molecular inference & audit-compliant artifact storage | 1. `POST /v1/projects/{project}/locations/{location}/endpoints/{id}:predict`: Executes TxGemma TDC benchmark inference on canonical SMILES.<br>2. `storage.objects.insert`: Archives prescription label images with HMAC-signed verification URLs. |
| **Slack API** | Operational exception console for clinical staff | 1. `chat.postMessage`: Dispatches interactive escalation blocks (`CP-1042`) containing patient context, uploaded label thumbnails, and TxGemma molecular risk outputs.<br>2. `block_actions` listener: Processes staff decisions (e.g. approving a review slot, requesting dosage intervals) and relays instructions back to the patient session. |
| **Google Calendar / CalDAV API** | Dependency-aware multi-step appointment scheduler | 1. `freeBusy.query`: Evaluates clinician and phlebotomy availability constraints.<br>2. `events.insert`: Sequentially schedules ordered dependencies (e.g. Lab Draw at $T_0$, 48-hour analytical window, follow-up consultation at $T_0 + 72\text{h}$) with structured metadata. |

---

## System architecture

CarePlus implements a multi-agent orchestration architecture:

```
                            +--------------------------+
                            |    Patient Web Client    |
                            |  (WebRTC Voice / HTTPS)  |
                            +------------+-------------+
                                         |
                                         v
                      +--------------------------------------+
                      |      CarePlus Orchestrator Agent     |
                      |        (GPT-5.6 / Gemini Flash)      |
                      +----+-------------+--------------+----+
                           |             |              |
          +----------------+             |              +----------------+
          |                              |                               |
          v                              v                               v
+--------------------+        +--------------------+          +--------------------+
| Synthetic Patient  |        | Multimodal Label   |          | External Actions   |
| History Store      |        | & SMILES Resolver  |          | Dispatcher         |
| (PostgreSQL / GCP) |        | (PubChem PUG API)  |          | (Calendar / CalDAV)|
+--------------------+        +----------+---------+          +--------------------+
                                         |
                                         v
                              +--------------------+
                              | TxGemma Specialist |
                              | (GCP Vertex AI)    |
                              +----------+---------+
                                         |
                                         v
                              +--------------------+
                              |  Slack Exception   |
                              |  Console Engine    |
                              +--------------------+
```

### Component breakdown

1. **CarePlus Orchestrator:** Maintains session state, tracks dialogue history, validates required intake variables, and executes conditional logic based on downstream specialist outputs.
2. **Synthetic Patient History Store:** Houses fixture-backed longitudinal health records, prior appointment outcomes, recorded allergies, and accessibility constraints.
3. **Multimodal Chemical Resolver:** Combines vision OCR with PubChem REST lookups to bridge physical drug packaging to canonical chemical representations.
4. **TxGemma Specialist Worker:** An isolated inference worker querying the Vertex AI endpoint for TDC benchmark predictions.
5. **Slack Exception Console:** A bi-directional integration that converts clinical edge cases into actionable staff tickets.

---

## Primary evaluation journey: Medication history reconstruction

### Clinical scenario

A patient, Maya, contacts the clinic portal:
> *"My doctor recommended this cough medicine, but I took something similar last year and became dizzy. I cannot remember exactly what it was. Can you help me arrange a medication review?"*

### Execution trace

1. **Intake & history retrieval:** CarePlus pulls Maya's record (`PT-8821`). The store contains a clinician note from June 2025: *"Patient reported post-administration dizziness; active drug name unrecorded."*
2. **Missing evidence query:** The agent identifies an unverified clinical entity. Rather than guessing, CarePlus requests:
   > *"I found your note about dizziness from June 2025, but the exact medication name was never confirmed. Do you have the old packaging, bottle, or prescription slip available to photograph?"*
3. **Multimodal ingestion:** Maya uploads a photo of an old syrup bottle. The vision parser extracts:
   - Product name: *Promethazine HCl and Dextromethorphan Hydrobromide Oral Solution*
   - Active ingredients: *Promethazine Hydrochloride, Dextromethorphan HBr*
4. **Chemical grounding & TxGemma analysis:**
   - PubChem API resolves Promethazine canonical SMILES: `CC(CN1C2=CC=CC=C2SC3=CC=CC=C31)N(C)C`.
   - The TxGemma worker runs the `BBB_Martins` and `ClinTox` benchmarks on Vertex AI.
   - Output: High blood-brain barrier permeability ($p > 0.89$), known central nervous system depression, and confirmed sedative/dizziness profile.
5. **Dependency-aware scheduling:** The agent classifies this as a non-emergency medication review. It inspects practitioner calendar slots and schedules a 15-minute telehealth consultation for 2:30 PM.
6. **Bi-directional staff exception loop:**
   - CarePlus formats an escalation card and posts it to `#clinic-triage` in Slack:
     ```text
     [CP-1042] Medication Review Scheduled (Telehealth - 2:30 PM)
     Patient: Maya Lin (PT-8821)
     Trigger: Historical Adverse Reaction Verification
     Identified Molecule: Promethazine HCl (SMILES: CC(CN1C2=CC=CC=C2SC3=CC=CC=C31)N(C)C)
     TxGemma Finding: High BBB Permeability (p=0.91), sedative profile correlates with dizziness.
     Action Required: Review concomitant prescriptions prior to call.
     [Ask Patient: Date of Last Dose] [Approve Intake Notes]
     ```
   - Clinic staff clicks **Ask Patient: Date of Last Dose**.
   - The coordinator agent receives the Slack webhook and surfaces the follow-up question immediately in Maya's active portal session.

---

## Reliability, testing, and evaluation

CarePlus includes an automated verification test suite to validate multi-step agent transitions, API contract reliability, and safety guardrails.

```bash
# Run the test suite
npm test
# or
python3 -m pytest tests/ -v
```

### Evaluation test matrix

| Test category | Suite file | Conditions verified |
|---|---|---|
| **Multi-step state machine** | `tests/test_coordinator_flow.py` | Asserts sequential transitions through `INTAKE` $\rightarrow$ `HISTORY_QUERY` $\rightarrow$ `EVIDENCE_REQUEST` $\rightarrow$ `TXGEMMA_PREDICT` $\rightarrow$ `EXTERNAL_DISPATCH`. Ensures no step executes out of order. |
| **Chemical resolution contract** | `tests/test_pubchem_resolver.py` | Validates that OCR extracted strings correctly resolve to canonical SMILES via PubChem REST API with valid HTTP 200 responses and structure validation. |
| **TxGemma inference validation** | `tests/test_txgemma_inference.py` | Sends mock and live SMILES strings to the prediction pipeline; asserts schema compliance, probability score bounds ($[0.0, 1.0]$), and expected TDC task formatting. |
| **Slack interaction loop** | `tests/test_slack_console.py` | Validates Block Kit JSON payload construction and simulates webhook callback payloads from staff button clicks. |
| **Calendar sequencing** | `tests/test_scheduler_dependencies.py` | Asserts dependency constraints: scheduling fails if a dependent follow-up is booked prior to the prerequisite lab availability window. |
| **Safety boundaries** | `tests/test_safety_guardrails.py` | Negative tests: verifies that diagnostic requests (*"Diagnose this rash"*) or requests for illegal drug synthesis are blocked from scheduling and routed to staff with standard safety notices. |

---

## Setup and local execution

### Prerequisites

- Node.js 20+ and Python 3.11+
- Google Cloud SDK (`gcloud` authenticated with access to Vertex AI)
- Slack Bot credentials (`SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID`)
- Google Calendar API credentials

### Installation

```bash
# Clone the repository
git clone https://github.com/tayyab415/careplus.git
cd careplus

# Install dependencies
npm install
pip install -r requirements.txt

# Configure environment variables
cp .env.example .env
```

### Configuration (`.env`)

```ini
# Core LLM Providers
OPENAI_API_KEY=your_openai_api_key
GOOGLE_GENAI_API_KEY=your_gemini_api_key

# Google Cloud Platform & TxGemma
GOOGLE_CLOUD_PROJECT=your_gcp_project_id
GOOGLE_CLOUD_LOCATION=us-central1
TXGEMMA_ENDPOINT_ID=your_vertex_endpoint_id
GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json

# Slack Operations Console
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
SLACK_SIGNING_SECRET=your_slack_signing_secret
SLACK_TRIAGE_CHANNEL=C0123456789

# Clinic Scheduling
CALENDAR_CLIENT_ID=your_google_calendar_client_id
CALENDAR_CLIENT_SECRET=your_google_calendar_client_secret
```

### Running the application

```bash
# 1. Start the backend orchestration and TxGemma dispatch service
npm run dev:server

# 2. Start the clinic portal web interface
npm run dev:portal
```

Access the patient portal at `http://localhost:3000`.
