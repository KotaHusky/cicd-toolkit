#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Azure Container Apps Setup Wizard
# =============================================================================
#
# Interactive setup for deploying a container to Azure Container Apps.
# Polls GitHub for repos/images and Azure for regions — no manual typing.
# Saves all selections to .setup-aca.env for instant re-runs.
#
# Deploys infra/main.bicep (idempotent — safe to re-run).
#
# Prerequisites: az CLI logged in, gh CLI logged in
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BICEP_FILE="${SCRIPT_DIR}/../infra/main.bicep"
CONFIG_FILE=".setup-aca.env"

# ---- Colors & helpers --------------------------------------------------------

BOLD='\033[1m'
DIM='\033[2m'
CYAN='\033[36m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
RESET='\033[0m'

info()    { echo -e "${CYAN}${BOLD}$1${RESET}"; }
success() { echo -e "${GREEN}$1${RESET}"; }
warn()    { echo -e "${YELLOW}$1${RESET}"; }
err()     { echo -e "${RED}$1${RESET}"; }
dim()     { echo -e "${DIM}$1${RESET}"; }
spinner() {
  local pid=$1 msg=$2
  local frames=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
  local i=0
  while kill -0 "$pid" 2>/dev/null; do
    printf "\r  ${CYAN}${frames[$i]}${RESET} %s" "$msg"
    i=$(( (i + 1) % ${#frames[@]} ))
    sleep 0.1
  done
  printf "\r"
}

# Pick from a numbered list. Args: var_name, prompt, default, items...
pick() {
  local var_name=$1 prompt_text=$2 default=$3
  shift 3
  local items=("$@")
  local count=${#items[@]}

  echo ""
  info "$prompt_text"

  # Find default index
  local default_idx=""
  for i in "${!items[@]}"; do
    local marker=""
    if [[ "${items[$i]}" == "$default" ]]; then
      default_idx=$((i + 1))
      marker=" ${DIM}(saved)${RESET}"
    fi
    echo -e "  ${BOLD}$((i + 1))${RESET}  ${items[$i]}${marker}"
  done

  local hint=""
  if [[ -n "$default_idx" ]]; then
    hint=" [${default_idx}]"
  fi

  local choice
  while true; do
    read -rp "  Pick${hint}: " choice
    # Enter = default
    if [[ -z "$choice" && -n "$default_idx" ]]; then
      choice=$default_idx
      break
    fi
    # Validate number
    if [[ "$choice" =~ ^[0-9]+$ ]] && (( choice >= 1 && choice <= count )); then
      break
    fi
    err "  Enter a number between 1 and ${count}"
  done

  eval "$var_name=\"${items[$((choice - 1))]}\""
}

# Text prompt with default. Args: var_name, prompt, default
prompt() {
  local var_name=$1 prompt_text=$2 default=$3
  local value
  read -rp "  ${prompt_text} [${default}]: " value
  value="${value:-$default}"
  eval "$var_name=\"$value\""
}

# ---- Banner -----------------------------------------------------------------

echo ""
echo -e "${BOLD}┌─────────────────────────────────────────────┐${RESET}"
echo -e "${BOLD}│   Azure Container Apps Setup Wizard         │${RESET}"
echo -e "${BOLD}└─────────────────────────────────────────────┘${RESET}"
echo ""
dim "  Deploys infrastructure via Bicep (idempotent — safe to re-run)"
dim "  Selections are saved to ${CONFIG_FILE}"
echo ""

# ---- Preflight checks -------------------------------------------------------

preflight_ok=true

check() {
  local name=$1 cmd=$2 fix=$3
  if eval "$cmd" &>/dev/null; then
    echo -e "  ${GREEN}✓${RESET} ${name}"
  else
    echo -e "  ${RED}✗${RESET} ${name} — ${fix}"
    preflight_ok=false
  fi
}

info "Preflight"
check "az CLI"        "command -v az"     "Install: https://aka.ms/install-azure-cli"
check "gh CLI"        "command -v gh"     "Install: https://cli.github.com"
check "az logged in"  "az account show"   "Run: az login"
check "gh logged in"  "gh auth status"    "Run: gh auth login"
check "Bicep template" "test -f '$BICEP_FILE'" "Missing: ${BICEP_FILE}"

if [[ "$preflight_ok" == false ]]; then
  echo ""
  err "Fix the issues above and re-run."
  exit 1
fi

# ---- Load saved config (if any) ---------------------------------------------

if [[ -f "$CONFIG_FILE" ]]; then
  echo ""
  dim "  Loaded saved config from ${CONFIG_FILE}"
  # shellcheck source=/dev/null
  source "$CONFIG_FILE"
fi

# ---- 1. GitHub repo ---------------------------------------------------------

echo ""
info "Fetching your GitHub repos..."

GH_OWNER=$(gh api user -q .login)

mapfile -t REPOS < <(
  gh api "users/${GH_OWNER}/repos" \
    --paginate \
    -q '.[].name' \
  | sort
)

if [[ ${#REPOS[@]} -eq 0 ]]; then
  err "No repos found for ${GH_OWNER}"
  exit 1
fi

pick REPO "Which repository?" "${SAVED_REPO:-}" "${REPOS[@]}"
FULL_REPO="${GH_OWNER}/${REPO}"
success "  → ${FULL_REPO}"

# ---- 2. Container image -----------------------------------------------------

echo ""
info "Fetching GHCR images for ${REPO}..."

mapfile -t TAGS < <(
  gh api "users/${GH_OWNER}/packages/container/${REPO}/versions" \
    --paginate \
    -q '.[].metadata.container.tags[]' \
  2>/dev/null | head -20 || true
)

if [[ ${#TAGS[@]} -eq 0 ]]; then
  warn "  No tags found — using 'latest'"
  IMAGE="ghcr.io/${FULL_REPO}:latest"
else
  pick TAG "Which image tag?" "${SAVED_TAG:-latest}" "${TAGS[@]}"
  IMAGE="ghcr.io/${FULL_REPO}:${TAG}"
  success "  → ${IMAGE}"
fi

# ---- 3. Azure region --------------------------------------------------------

echo ""
info "Fetching Azure regions..."

mapfile -t ALL_REGIONS < <(
  az account list-locations \
    --query "[?metadata.regionType=='Physical'].name" \
    -o tsv \
  | sort
)

# Put common ones first
COMMON=("eastus" "eastus2" "westus2" "westus3" "centralus" "northeurope" "westeurope")
REGIONS=()
for r in "${COMMON[@]}"; do
  for ar in "${ALL_REGIONS[@]}"; do
    if [[ "$ar" == "$r" ]]; then
      REGIONS+=("$r")
      break
    fi
  done
done
# Add separator + rest
REGIONS+=("───────────")
for ar in "${ALL_REGIONS[@]}"; do
  skip=false
  for c in "${COMMON[@]}"; do
    [[ "$ar" == "$c" ]] && skip=true && break
  done
  $skip || REGIONS+=("$ar")
done

pick LOCATION "Azure region?" "${SAVED_LOCATION:-eastus2}" "${REGIONS[@]}"
# If they somehow picked the separator, re-prompt
while [[ "$LOCATION" == "───────────" ]]; do
  warn "  That's a separator, pick an actual region"
  pick LOCATION "Azure region?" "${SAVED_LOCATION:-eastus2}" "${REGIONS[@]}"
done
success "  → ${LOCATION}"

# ---- 4. App name + resource group --------------------------------------------

echo ""
info "App configuration"
prompt APP_NAME       "App name"            "${SAVED_APP_NAME:-${REPO}}"
prompt RESOURCE_GROUP "Resource group"      "${SAVED_RESOURCE_GROUP:-rg-${APP_NAME}}"
prompt TARGET_PORT    "Target port"         "${SAVED_TARGET_PORT:-3000}"
prompt MIN_REPLICAS   "Min replicas"        "${SAVED_MIN_REPLICAS:-1}"

# ---- Save selections --------------------------------------------------------

cat > "$CONFIG_FILE" <<CONF
# Auto-generated by setup-aca.sh — safe to edit or delete
SAVED_REPO="${REPO}"
SAVED_TAG="${TAG:-latest}"
SAVED_LOCATION="${LOCATION}"
SAVED_APP_NAME="${APP_NAME}"
SAVED_RESOURCE_GROUP="${RESOURCE_GROUP}"
SAVED_TARGET_PORT="${TARGET_PORT}"
SAVED_MIN_REPLICAS="${MIN_REPLICAS}"
CONF

# ---- Summary ----------------------------------------------------------------

echo ""
echo -e "${BOLD}┌─────────────────────────────────────────────┐${RESET}"
echo -e "${BOLD}│   Configuration Summary                     │${RESET}"
echo -e "${BOLD}└─────────────────────────────────────────────┘${RESET}"
echo ""
echo -e "  App name:         ${BOLD}${APP_NAME}${RESET}"
echo -e "  Resource group:   ${BOLD}${RESOURCE_GROUP}${RESET}"
echo -e "  Region:           ${BOLD}${LOCATION}${RESET}"
echo -e "  Image:            ${BOLD}${IMAGE}${RESET}"
echo -e "  Target port:      ${BOLD}${TARGET_PORT}${RESET}"
echo -e "  Min replicas:     ${BOLD}${MIN_REPLICAS}${RESET}"
echo -e "  GitHub repo:      ${BOLD}${FULL_REPO}${RESET}"
echo ""
dim "  Saved to ${CONFIG_FILE} — re-run to use these defaults"
echo ""

read -rp "  Deploy? (y/N): " confirm
if [[ "${confirm}" != "y" && "${confirm}" != "Y" ]]; then
  echo ""
  warn "Aborted. Your selections are saved — re-run anytime."
  exit 0
fi

# ==============================================================================
# DEPLOY
# ==============================================================================

echo ""

# ---- 1. Resource providers ---------------------------------------------------

info "Registering resource providers..."
az provider register -n Microsoft.App --wait &>/dev/null &
local_pid1=$!
az provider register -n Microsoft.OperationalInsights --wait &>/dev/null &
local_pid2=$!
spinner $local_pid1 "Microsoft.App"
wait $local_pid1
spinner $local_pid2 "Microsoft.OperationalInsights"
wait $local_pid2
success "  ✓ Resource providers registered"

# ---- 2. Resource Group -------------------------------------------------------

echo ""
info "Creating resource group..."
az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --output none
success "  ✓ ${RESOURCE_GROUP}"

# ---- 3. Bicep Deployment -----------------------------------------------------

echo ""
info "Deploying infrastructure (Bicep)..."
DEPLOY_OUTPUT=$(az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --template-file "$BICEP_FILE" \
  --parameters \
    appName="$APP_NAME" \
    image="$IMAGE" \
    targetPort="$TARGET_PORT" \
    minReplicas="$MIN_REPLICAS" \
    location="$LOCATION" \
  --query "properties.outputs" \
  --output json)

FQDN=$(echo "$DEPLOY_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['fqdn']['value'])")
success "  ✓ Container App deployed"
echo -e "  ${BOLD}https://${FQDN}${RESET}"

# ---- 4. Service Principal for GitHub Actions ---------------------------------

echo ""
info "Creating service principal..."

SUB_ID=$(az account show --query id -o tsv)
RG_ID="/subscriptions/${SUB_ID}/resourceGroups/${RESOURCE_GROUP}"

SP_JSON=$(az ad sp create-for-rbac \
  --name "github-actions-${APP_NAME}" \
  --role contributor \
  --scopes "$RG_ID" \
  --sdk-auth)

success "  ✓ Service principal created"

# ---- 5. Set GitHub Secret ----------------------------------------------------

echo ""
read -rp "  Set AZURE_CREDENTIALS secret in ${FULL_REPO}? (y/N): " set_secret
if [[ "${set_secret}" == "y" || "${set_secret}" == "Y" ]]; then
  echo "$SP_JSON" | gh secret set AZURE_CREDENTIALS --repo "$FULL_REPO"
  success "  ✓ AZURE_CREDENTIALS set in ${FULL_REPO}"
else
  echo ""
  warn "  Set this manually as AZURE_CREDENTIALS in GitHub repo settings:"
  echo "$SP_JSON"
fi

# ---- Done --------------------------------------------------------------------

echo ""
echo -e "${BOLD}┌─────────────────────────────────────────────┐${RESET}"
echo -e "${BOLD}│   Setup Complete                            │${RESET}"
echo -e "${BOLD}└─────────────────────────────────────────────┘${RESET}"
echo ""
echo -e "  Your app: ${BOLD}https://${FQDN}${RESET}"
echo ""
dim "  Cloudflare DNS (optional):"
dim "    1. CNAME → ${FQDN} (Proxied)"
dim "    2. Origin Certificate → upload to ACA"
dim "    3. SSL mode → Full (Strict)"
echo ""
