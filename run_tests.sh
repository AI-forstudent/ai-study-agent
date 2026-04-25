#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_tests.sh — AI Study Partner Quality Gate
#
# Runs all three layers of the QA pyramid in sequence.
# Exit code is non-zero if any layer fails, so CI can catch regressions.
#
# Usage:
#   ./run_tests.sh              # all layers
#   ./run_tests.sh unit         # backend unit tests only
#   ./run_tests.sh frontend     # frontend Vitest only
#   ./run_tests.sh e2e          # Playwright E2E only
#   ./run_tests.sh integration  # backend unit + integration (needs live DB)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

header() { echo -e "\n${CYAN}${BOLD}▶ $1${RESET}"; }
success() { echo -e "${GREEN}✔ $1${RESET}"; }
fail()    { echo -e "${RED}✘ $1${RESET}"; exit 1; }

LAYER="${1:-all}"

# ── Layer 1: Backend unit tests (Pytest, no live DB required) ─────────────────
run_unit() {
  header "Backend Unit Tests (Pytest)"
  cd backend
  uv run pytest tests/ -v --tb=short || fail "Backend unit tests failed"
  success "Backend unit tests passed"
  cd ..
}

# ── Layer 1b: Backend integration tests (needs live PostgreSQL + pgvector) ────
run_integration() {
  header "Backend Integration Tests (Pytest + live DB)"
  cd backend
  uv run pytest tests/ -v --tb=short --run-integration || fail "Backend integration tests failed"
  success "Backend integration tests passed"
  cd ..
}

# ── Layer 2: Frontend unit/hook tests (Vitest) ────────────────────────────────
run_frontend() {
  header "Frontend Unit Tests (Vitest)"
  cd ai-study-client
  # --run executes once instead of watch mode (CI-friendly)
  npm test -- --run || fail "Frontend unit tests failed"
  success "Frontend unit tests passed"
  cd ..
}

# ── Layer 3: End-to-End tests (Playwright) ────────────────────────────────────
run_e2e() {
  header "E2E Tests (Playwright)"
  # Requires the full stack to be running — start with `docker compose up` first.
  PLAYWRIGHT_BASE_URL="${PLAYWRIGHT_BASE_URL:-http://localhost:5173}" \
    npx playwright test tests/e2e/ --reporter=list || fail "E2E tests failed"
  success "E2E tests passed"
}

# ── Dispatch ──────────────────────────────────────────────────────────────────
case "$LAYER" in
  unit)        run_unit ;;
  integration) run_unit; run_integration ;;
  frontend)    run_frontend ;;
  e2e)         run_e2e ;;
  all)
    run_unit
    run_frontend
    run_e2e
    echo -e "\n${GREEN}${BOLD}✔ All QA layers passed.${RESET}\n"
    ;;
  *)
    echo "Usage: $0 [unit|integration|frontend|e2e|all]"
    exit 1
    ;;
esac
