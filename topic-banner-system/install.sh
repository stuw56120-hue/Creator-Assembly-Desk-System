#!/usr/bin/env bash
set -euo pipefail

# ── colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()  { echo -e "${CYAN}${BOLD}[info]${RESET}  $*"; }
ok()    { echo -e "${GREEN}${BOLD}[ ok ]${RESET}  $*"; }
warn()  { echo -e "${YELLOW}${BOLD}[warn]${RESET}  $*"; }
fail()  { echo -e "${RED}${BOLD}[fail]${RESET}  $*" >&2; exit 1; }

# ── resolve script directory ──────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo
echo -e "${BOLD}╔══════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║   Topic Change Banner System — Installer     ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════╝${RESET}"
echo

# ── 1. check Node.js ──────────────────────────────────────────────────────────
info "Checking Node.js..."
if ! command -v node &>/dev/null; then
  fail "Node.js not found. Install Node.js 20+ from https://nodejs.org"
fi

NODE_VERSION=$(node -e "process.stdout.write(process.versions.node)")
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 20 ]; then
  fail "Node.js 20+ required (found v${NODE_VERSION}). Please upgrade."
fi
ok "Node.js v${NODE_VERSION}"

# ── 2. ensure pnpm ────────────────────────────────────────────────────────────
info "Checking pnpm..."
if ! command -v pnpm &>/dev/null; then
  warn "pnpm not found — installing via npm..."
  npm install -g pnpm || fail "Failed to install pnpm. Try: sudo npm install -g pnpm"
fi
PNPM_VERSION=$(pnpm --version)
ok "pnpm v${PNPM_VERSION}"

# ── 3. install dependencies ───────────────────────────────────────────────────
info "Installing dependencies..."
cd "$SCRIPT_DIR"
pnpm install --frozen-lockfile || fail "pnpm install failed"
ok "Dependencies installed"

# ── 4. run tests ──────────────────────────────────────────────────────────────
info "Running test suite..."
if pnpm test; then
  ok "All tests passed"
else
  fail "Tests failed — installation aborted"
fi

# ── 5. compile TypeScript ─────────────────────────────────────────────────────
info "Compiling TypeScript..."
pnpm exec tsc --noEmit false || fail "TypeScript compilation failed"
ok "Compiled to dist/"

# ── 6. write the topic-banner executable ─────────────────────────────────────
EXEC="$SCRIPT_DIR/topic-banner"
cat > "$EXEC" <<'WRAPPER'
#!/usr/bin/env bash
# topic-banner — Topic Change Banner System CLI
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/dist/index.js" "$@"
WRAPPER
chmod +x "$EXEC"
ok "Executable written → ${EXEC}"

# ── done ──────────────────────────────────────────────────────────────────────
echo
echo -e "${GREEN}${BOLD}Installation complete.${RESET}"
echo
echo -e "  Run a job:"
echo -e "  ${BOLD}OPENAI_API_KEY=sk-...  ${EXEC} --manifest path/to/manifest.json --out path/to/out.json${RESET}"
echo
echo -e "  Smoke-test (mock embeddings):"
echo -e "  ${BOLD}${EXEC} --manifest fixtures/sample_transcript.json --out /tmp/out.json${RESET}"
echo
