#!/usr/bin/env bash
# Deploy CarePlus to Cloud Run.
#
#   ./deploy.sh              # build image with Cloud Build + deploy service "careplus"
#   SKIP_BUILD=1 ./deploy.sh # redeploy the last image (config-only change)
#
# Prereqs: gcloud authenticated with access to $PROJECT; the service account below exists;
# Secret Manager secrets `careplus-openai-api-key` and `careplus-agent-key` exist (see
# "one-time setup" at the bottom). Nothing from .env or ./secrets is baked into the image —
# runtime config is passed as env vars / mounted secrets here.
set -euo pipefail
cd "$(dirname "$0")"

PROJECT="${PROJECT:-onehorizon-494120}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-careplus}"
SA="${SA:-careplus-agent@${PROJECT}.iam.gserviceaccount.com}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${SERVICE}/${SERVICE}:latest"

gcloud config set project "$PROJECT" >/dev/null

# ---- build ----------------------------------------------------------------
if [[ -z "${SKIP_BUILD:-}" ]]; then
  gcloud artifacts repositories describe "$SERVICE" --location "$REGION" >/dev/null 2>&1 ||
    gcloud artifacts repositories create "$SERVICE" --repository-format docker --location "$REGION"
  gcloud builds submit --region "$REGION" --tag "$IMAGE" --timeout 1200s .
fi

# ---- runtime config -------------------------------------------------------
# Non-secret env (mirrors .env). PUBLIC_BASE_URL is set after the first deploy, below.
ENV_VARS=(
  "GOOGLE_CLOUD_PROJECT=${PROJECT}"
  "GOOGLE_CLOUD_LOCATION=${REGION}"
  "FIRESTORE_DATABASE=careplus"
  "EVIDENCE_BUCKET=${PROJECT}-careplus-evidence"
  "STORE_BACKEND=firestore"
  "COORDINATOR_MODEL=gpt-5.6-luna"
  "COORDINATOR_REASONING=low"
  "FAST_MODEL=gemini-3.1-flash-lite"
  "VISION_MODEL=gemini-3.1-flash-lite"
  "TXGEMMA_ENDPOINT_ID=mg-endpoint-9e3af183-3c3f-48d7-a96b-bf9254c9c45b"
  "TXGEMMA_DEDICATED_DNS=mg-endpoint-9e3af183-3c3f-48d7-a96b-bf9254c9c45b.us-central1-182986415789.prediction.vertexai.goog"
  "TXGEMMA_LOCATION=us-central1"
  "CALENDAR_SHARE_WITH=sahiltanna7@gmail.com"
  "CAREPLUS_DRY_RUN=false"
  "CAREPLUS_DEBUG=true"
  # The SA key is mounted from Secret Manager: Google Calendar (SA-owned calendar) and V4
  # signed URLs for evidence both need a private key, which the metadata-server identity
  # alone does not provide. The service also *runs as* the same SA for everything else.
  "GOOGLE_APPLICATION_CREDENTIALS=/secrets/careplus-agent.json"
)
SECRETS="OPENAI_API_KEY=careplus-openai-api-key:latest,/secrets/careplus-agent.json=careplus-agent-key:latest"

# Slack (optional): wired when the secrets exist in Secret Manager. Review cards post from the
# deployed service; button handling runs via `npm run slack` (Socket Mode) using SLACK_APP_TOKEN.
SLACK_TRIAGE_CHANNEL="${SLACK_TRIAGE_CHANNEL:-C0C1C9TQWV9}"
if gcloud secrets describe careplus-slack-bot-token >/dev/null 2>&1; then
  SECRETS+=",SLACK_BOT_TOKEN=careplus-slack-bot-token:latest"
  ENV_VARS+=("SLACK_TRIAGE_CHANNEL=${SLACK_TRIAGE_CHANNEL}")
fi
if gcloud secrets describe careplus-slack-app-token >/dev/null 2>&1; then
  SECRETS+=",SLACK_APP_TOKEN=careplus-slack-app-token:latest"
fi

ENV_JOINED=$(IFS='|'; echo "${ENV_VARS[*]}")

gcloud run deploy "$SERVICE" \
  --region "$REGION" \
  --image "$IMAGE" \
  --platform managed \
  --allow-unauthenticated \
  --service-account "$SA" \
  --min-instances 1 \
  --memory 1Gi \
  --cpu 1 \
  --timeout 300s \
  --port 8080 \
  --set-env-vars "^|^${ENV_JOINED}" \
  --set-secrets "$SECRETS"

# ---- PUBLIC_BASE_URL = the service's own URL -------------------------------
# Prefer the deterministic URL (https://SERVICE-PROJECT_NUMBER.REGION.run.app) over the legacy *.a.run.app one.
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format 'value(projectNumber)')
URL="https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"
CURRENT=$(gcloud run services describe "$SERVICE" --region "$REGION" \
  --format 'value(spec.template.spec.containers[0].env)' | tr ';' '\n' | sed -n "s/.*PUBLIC_BASE_URL': '\([^']*\)'.*/\1/p" || true)
if [[ "$CURRENT" != "$URL" ]]; then
  gcloud run services update "$SERVICE" --region "$REGION" --update-env-vars "PUBLIC_BASE_URL=${URL}"
fi

echo
echo "Deployed: $URL"
echo "Check:    curl -s $URL/api/patients | head -c 400"

# ---- one-time setup (already applied to $PROJECT; kept for reproducibility) ----
# gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com iamcredentials.googleapis.com calendar-json.googleapis.com
# for r in roles/datastore.user roles/aiplatform.user; do gcloud projects add-iam-policy-binding $PROJECT --member serviceAccount:$SA --role $r; done
# gcloud storage buckets add-iam-policy-binding gs://$PROJECT-careplus-evidence --member serviceAccount:$SA --role roles/storage.objectAdmin
# gcloud iam service-accounts add-iam-policy-binding $SA --member serviceAccount:$SA --role roles/iam.serviceAccountTokenCreator
# gcloud secrets create careplus-openai-api-key --replication-policy automatic && printf '%s' "$OPENAI_API_KEY" | gcloud secrets versions add careplus-openai-api-key --data-file=-
# gcloud secrets create careplus-agent-key --replication-policy automatic && gcloud secrets versions add careplus-agent-key --data-file=secrets/careplus-agent.json
# gcloud secrets create careplus-slack-bot-token --replication-policy automatic && printf '%s' "$SLACK_BOT_TOKEN" | gcloud secrets versions add careplus-slack-bot-token --data-file=-
# gcloud secrets create careplus-slack-app-token --replication-policy automatic && printf '%s' "$SLACK_APP_TOKEN" | gcloud secrets versions add careplus-slack-app-token --data-file=-
# for s in careplus-openai-api-key careplus-agent-key careplus-slack-bot-token careplus-slack-app-token; do gcloud secrets add-iam-policy-binding $s --member serviceAccount:$SA --role roles/secretmanager.secretAccessor; done
