#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Hundie setup"
echo ""

# GitHub auth
if ! gh auth status &>/dev/null; then
  echo "GitHub: not authenticated. Run:"
  echo "  gh auth login -h github.com -p https -w"
  exit 1
fi
echo "GitHub: $(gh auth status 2>&1 | head -1)"

# Git init first (gh repo create --source=. requires a valid repo)
if [[ -d .git ]] && ! git rev-parse --git-dir &>/dev/null; then
  echo "Removing incomplete .git directory..."
  rm -rf .git
fi

if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  echo "Initializing git..."
  git init
  git branch -M main
fi

# Commit if nothing committed yet or there are changes
if ! git rev-parse HEAD &>/dev/null || [[ -n "$(git status --porcelain)" ]]; then
  echo "Staging and committing..."
  git add -A
  git commit -m "$(cat <<'EOF'
Initial Hundie setup with Supabase entity registry.

Connects to Hundie Project on Supabase and seeds the entity list for multi-entity expense classification.
EOF
)"
else
  echo "Git: working tree clean"
fi

# GitHub repo + remote
if gh repo view ciutrust/hundie-cursor &>/dev/null; then
  echo "GitHub repo ciutrust/hundie-cursor exists"
  if ! git remote get-url origin &>/dev/null; then
    echo "Adding origin remote..."
    git remote add origin "https://github.com/ciutrust/hundie-cursor.git"
  fi
else
  echo "Creating GitHub repo hundie-cursor..."
  gh repo create hundie-cursor --private --source=. --remote=origin \
    --description "Weekly transaction classifier for multi-entity bookkeeping and taxes" \
    --push
fi

# Push if create didn't push (existing repo path)
if git remote get-url origin &>/dev/null; then
  git push -u origin main 2>/dev/null || git push -u origin main || true
fi

# Supabase verify
if [[ ! -f .env.local ]]; then
  cp .env.local.example .env.local
  echo "Created .env.local — fill in Supabase keys from docs/SUPABASE.md"
fi

npm install
npm run verify:db

echo ""
echo "Done. Repo: https://github.com/ciutrust/hundie-cursor"
echo "Open $ROOT in Cursor to continue."
