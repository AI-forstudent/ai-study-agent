#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# AI Study Partner — Vibe Coding Setup Migration
# ─────────────────────────────────────────────────────────────
# This script:
#   1. Promotes useful files from .context/ into docs/
#   2. Deletes .context/ (its content is now elsewhere)
#   3. Creates GEMINI.md as a symlink to CLAUDE.md
#   4. Creates the .gemini/ directory if needed
#
# Run from project root.
# Idempotent — safe to re-run.

set -euo pipefail

cd "$(dirname "$0")"

echo "🔍 Checking current state..."

if [[ ! -f CLAUDE.md ]]; then
  echo "❌ CLAUDE.md not found — are you in the project root?"
  exit 1
fi

# ─────────────────────────────────────────────────────────────
# 1. Create docs/ if it doesn't exist
# ─────────────────────────────────────────────────────────────
mkdir -p docs

# ─────────────────────────────────────────────────────────────
# 2. Migrate useful .context files (only if they exist)
# ─────────────────────────────────────────────────────────────
# Note: vision.md and active_tracker.md from this setup package
# are intended to REPLACE (not preserve) the .context/ versions
# because the new versions are slimmed-down. The old .context/
# files are preserved in git history if you ever need them.

if [[ -d .context ]]; then
  echo "📦 Found .context/ — backing up to .context.bak/"
  rm -rf .context.bak
  mv .context .context.bak
  echo "   (You can delete .context.bak/ later — it's preserved in git history anyway)"
else
  echo "✅ .context/ already gone"
fi

# ─────────────────────────────────────────────────────────────
# 3. Create GEMINI.md as symlink to CLAUDE.md
# ─────────────────────────────────────────────────────────────
if [[ -L GEMINI.md ]]; then
  echo "✅ GEMINI.md symlink already exists"
elif [[ -f GEMINI.md ]]; then
  echo "⚠️  GEMINI.md exists as a regular file — backing up to GEMINI.md.bak"
  mv GEMINI.md GEMINI.md.bak
  ln -s CLAUDE.md GEMINI.md
  echo "✅ Created GEMINI.md → CLAUDE.md"
else
  ln -s CLAUDE.md GEMINI.md
  echo "✅ Created GEMINI.md → CLAUDE.md"
fi

# ─────────────────────────────────────────────────────────────
# 4. Create .gemini/ dir if missing
# ─────────────────────────────────────────────────────────────
mkdir -p .gemini

# ─────────────────────────────────────────────────────────────
# 5. Verify expected files are in place
# ─────────────────────────────────────────────────────────────
echo ""
echo "📋 Verifying setup:"
for f in CLAUDE.md GEMINI.md SYSTEM_ARCHITECTURE.md .mcp.json .gemini/settings.json docs/active_tracker.md docs/vision.md backend/CLAUDE.md ai-study-client/CLAUDE.md; do
  if [[ -e $f || -L $f ]]; then
    echo "   ✅ $f"
  else
    echo "   ❌ MISSING: $f"
  fi
done

echo ""
echo "✅ Migration done."
echo ""
echo "Next steps:"
echo "  1. Set env vars in your shell (~/.zshrc or ~/.bashrc):"
echo "       export POSTGRES_MCP_URI='postgresql://user:pass@localhost:5433/app_db'"
echo "       export GITHUB_TOKEN='ghp_your_fine_grained_PAT_here'"
echo "  2. Source your shell config: source ~/.zshrc"
echo "  3. Test Claude Code: cd into project, run 'claude' then '/mcp' to list servers"
echo "  4. Test Gemini CLI: run 'gemini' then '/mcp list'"
echo "  5. Once verified, delete .context.bak/ if you don't need it"
