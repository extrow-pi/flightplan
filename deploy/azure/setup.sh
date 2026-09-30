#!/usr/bin/env bash
# Creates or updates Flightplan on Azure Container Apps. Safe to re-run: it applies the
# settings in deploy/azure/production.env to whatever already exists.
#
#   bash deploy/azure/setup.sh
#
# Creates, in one resource group:
#   - a storage account with a 5 GB file share for floor map uploads
#   - a Container Apps environment (plus the Log Analytics workspace Azure adds for logs)
#   - the Container App: one always-on replica, 0.25 vCPU / 0.5 GiB, HTTPS ingress
# The database is Supabase (DATABASE_URL), not an Azure resource.
set -euo pipefail

cd "$(dirname "$0")"
# Git Bash on Windows rewrites arguments that look like paths (e.g. Azure resource IDs)
export MSYS_NO_PATHCONV=1

if [[ ! -f production.env ]]; then
  echo "Missing deploy/azure/production.env: copy production.env.example and fill it in." >&2
  exit 1
fi
# Read KEY=value lines literally rather than sourcing the file, so values can contain
# <, >, $, spaces and quotes. A " #" after the value starts a comment; surrounding quotes are dropped.
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"
  [[ "$line" =~ ^([A-Z_][A-Z0-9_]*)=(.*)$ ]] || continue
  key="${BASH_REMATCH[1]}"
  value="${BASH_REMATCH[2]}"
  value="$(sed -E 's/[[:space:]]+#.*$//; s/^[[:space:]]+//; s/[[:space:]]+$//' <<<"$value")"
  if [[ "$value" =~ ^\"(.*)\"$ || "$value" =~ ^\'(.*)\'$ ]]; then value="${BASH_REMATCH[1]}"; fi
  export "$key=$value"
done < production.env

for var in RESOURCE_GROUP LOCATION CONTAINERAPP_ENV CONTAINERAPP_NAME STORAGE_ACCOUNT IMAGE DATABASE_URL BETTER_AUTH_SECRET; do
  if [[ -z "${!var:-}" ]]; then
    echo "Set $var in deploy/azure/production.env" >&2
    exit 1
  fi
done

[[ -n "${AZURE_SUBSCRIPTION:-}" ]] && az account set --subscription "$AZURE_SUBSCRIPTION"
echo "Subscription: $(az account show --query name -o tsv)"

echo "==> Azure CLI extension and resource providers"
az extension add --name containerapp --upgrade --only-show-errors
az provider register --namespace Microsoft.App --wait
az provider register --namespace Microsoft.OperationalInsights --wait

echo "==> Resource group $RESOURCE_GROUP ($LOCATION)"
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

echo "==> Storage account $STORAGE_ACCOUNT and uploads share"
az storage account create --name "$STORAGE_ACCOUNT" --resource-group "$RESOURCE_GROUP" --location "$LOCATION" \
  --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 --allow-blob-public-access false --output none
az storage share-rm create --storage-account "$STORAGE_ACCOUNT" --resource-group "$RESOURCE_GROUP" \
  --name uploads --quota 5 --output none
storage_key=$(az storage account keys list --account-name "$STORAGE_ACCOUNT" --resource-group "$RESOURCE_GROUP" --query "[0].value" -o tsv)

echo "==> Container Apps environment $CONTAINERAPP_ENV"
if ! az containerapp env show --name "$CONTAINERAPP_ENV" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  az containerapp env create --name "$CONTAINERAPP_ENV" --resource-group "$RESOURCE_GROUP" --location "$LOCATION" --output none
fi
az containerapp env storage set --name "$CONTAINERAPP_ENV" --resource-group "$RESOURCE_GROUP" --storage-name uploads \
  --azure-file-account-name "$STORAGE_ACCOUNT" --azure-file-account-key "$storage_key" \
  --azure-file-share-name uploads --access-mode ReadWrite --output none
env_id=$(az containerapp env show --name "$CONTAINERAPP_ENV" --resource-group "$RESOURCE_GROUP" --query id -o tsv)

app_exists=false
az containerapp show --name "$CONTAINERAPP_NAME" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null && app_exists=true

# Default the public URL to the app's own address (known once the environment exists)
if [[ -z "${BETTER_AUTH_URL:-}" ]]; then
  domain=$(az containerapp env show --name "$CONTAINERAPP_ENV" --resource-group "$RESOURCE_GROUP" --query properties.defaultDomain -o tsv)
  BETTER_AUTH_URL="https://$CONTAINERAPP_NAME.$domain"
fi

# YAML single-quoted string: double any single quotes
q() { printf "'%s'" "${1//\'/\'\'}"; }

# Secrets are stored encrypted by Container Apps; env vars reference them by name.
# Blank optional settings are left out entirely.
secrets="" env=""
add_secret() { # add_secret ENV_VAR secret-name
  local value="${!1:-}"
  [[ -z "$value" ]] && return
  secrets+="      - name: $2"$'\n'"        value: $(q "$value")"$'\n'
  env+="          - name: $1"$'\n'"            secretRef: $2"$'\n'
}
add_env() { # add_env ENV_VAR
  local value="${!1:-}"
  [[ -z "$value" ]] && return
  env+="          - name: $1"$'\n'"            value: $(q "$value")"$'\n'
}
add_secret DATABASE_URL database-url
add_secret BETTER_AUTH_SECRET better-auth-secret
add_secret RESEND_API_KEY resend-api-key
add_secret GOOGLE_CLIENT_SECRET google-client-secret
add_env BETTER_AUTH_URL
add_env EMAIL_FROM
add_env APP_TIMEZONE
add_env GOOGLE_CLIENT_ID

registries=""
if [[ -n "${GHCR_USERNAME:-}" && -n "${GHCR_TOKEN:-}" ]]; then
  secrets+="      - name: ghcr-token"$'\n'"        value: $(q "$GHCR_TOKEN")"$'\n'
  registries="    registries:
      - server: ghcr.io
        username: $(q "$GHCR_USERNAME")
        passwordSecretRef: ghcr-token"
fi

# When updating, keep the image the GitHub workflow last deployed
image="$IMAGE"
if $app_exists; then
  image=$(az containerapp show --name "$CONTAINERAPP_NAME" --resource-group "$RESOURCE_GROUP" \
    --query "properties.template.containers[0].image" -o tsv)
fi

spec=.containerapp.yaml
trap 'rm -f "$spec"' EXIT
umask 077
cat > "$spec" <<YAML
location: $LOCATION
properties:
  managedEnvironmentId: $env_id
  configuration:
    activeRevisionsMode: Single
    ingress:
      external: true
      targetPort: 3001
      transport: auto
      allowInsecure: false
    secrets:
${secrets}${registries}
  template:
    containers:
      - name: flightplan
        image: $(q "$image")
        resources:
          cpu: 0.25
          memory: 0.5Gi
        env:
${env}        volumeMounts:
          - volumeName: uploads
            mountPath: /data/uploads
        probes:
          - type: Startup
            httpGet:
              path: /api/health
              port: 3001
            periodSeconds: 5
            failureThreshold: 24
          - type: Liveness
            httpGet:
              path: /api/health
              port: 3001
            periodSeconds: 30
    # Exactly one replica: the email worker and payment reminders run inside the app,
    # and it must never scale to zero or they stop.
    scale:
      minReplicas: 1
      maxReplicas: 1
    volumes:
      - name: uploads
        storageType: AzureFile
        storageName: uploads
YAML

if $app_exists; then
  echo "==> Updating Container App $CONTAINERAPP_NAME"
  az containerapp update --name "$CONTAINERAPP_NAME" --resource-group "$RESOURCE_GROUP" --yaml "$spec" --output none
else
  echo "==> Creating Container App $CONTAINERAPP_NAME"
  az containerapp create --name "$CONTAINERAPP_NAME" --resource-group "$RESOURCE_GROUP" --yaml "$spec" --output none
fi

fqdn=$(az containerapp show --name "$CONTAINERAPP_NAME" --resource-group "$RESOURCE_GROUP" --query properties.configuration.ingress.fqdn -o tsv)
echo
echo "Done. App: https://$fqdn"
echo "Public URL (BETTER_AUTH_URL): $BETTER_AUTH_URL"
echo "Logs: az containerapp logs show -n $CONTAINERAPP_NAME -g $RESOURCE_GROUP --follow"
