#!/usr/bin/env bash
# Etaros commit guard.
#
# On 2026-08-17 the repo went public with _private/ tracked in all 176 commits:
# financial roadmap, grant applications, margins, launch plan. Nothing objected,
# because nothing was watching. This is the thing that watches.
#
# Install:  git config core.hooksPath .githooks
# Bypass:   git commit --no-verify   (only when you have read what it flagged)

set -uo pipefail

RED=$'\033[0;31m'; YEL=$'\033[0;33m'; DIM=$'\033[2m'; OFF=$'\033[0m'
fail=0

staged=$(git diff --cached --name-only --diff-filter=ACMR)
[ -z "$staged" ] && exit 0

# ── 1. Paths that must never be tracked ──────────────────────────────────────
# Matched against the path, so a rename into a new directory is still caught.
BLOCKED_PATHS='^(_private/|\.agents/|POSITIONING\.md|DEPLOY\.md|social-bot/|server/|app\.config\.js$|\.env$|.*/\.env$|.*\.pem$|.*\.p12$|.*\.mobileprovision$|scripts/gen-keys\.js|\.build\.txt|\.faillog\.txt|\.r\.txt)'

while IFS= read -r f; do
  if printf '%s' "$f" | grep -qE "$BLOCKED_PATHS"; then
    printf '%sBLOCKED%s  %s\n' "$RED" "$OFF" "$f"
    fail=1
  fi
done <<< "$staged"

# ── 2. Live secret values in the diff ────────────────────────────────────────
# Placeholders are fine ("sk-ant-…", "AIza_PASTE_YOUR_KEY"), real keys are not.
# Each pattern requires enough trailing entropy that a doc example won't match.
scan_secret() {
  local label="$1" pattern="$2"
  local hits
  hits=$(git diff --cached -U0 | grep -E '^\+' | grep -oE "$pattern" | sort -u | head -3)
  if [ -n "$hits" ]; then
    printf '%sSECRET%s   %s\n' "$RED" "$OFF" "$label"
    while IFS= read -r h; do printf '          %s%s…%s\n' "$DIM" "${h:0:24}" "$OFF"; done <<< "$hits"
    fail=1
  fi
}

scan_secret "Google API key"        'AIza[A-Za-z0-9_-]{30,}'
scan_secret "Anthropic API key"     'sk-ant-[A-Za-z0-9_-]{40,}'
scan_secret "Groq API key"          'gsk_[A-Za-z0-9]{40,}'
scan_secret "OpenAI API key"        'sk-proj-[A-Za-z0-9_-]{40,}'
scan_secret "Stripe live key"       '(sk|rk)_live_[A-Za-z0-9]{20,}'
scan_secret "Stripe webhook secret" 'whsec_[A-Za-z0-9]{28,}'
scan_secret "Mistral API key"       '\bmistral[_-]?key["'"'"' :=]+[A-Za-z0-9]{28,}'
scan_secret "Private key block"     'BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY'

# A Supabase service_role JWT grants full database access and bypasses RLS.
# The anon key is public by design, so match the role claim, not the prefix.
if git diff --cached -U0 | grep -E '^\+' | grep -q 'eyJ[A-Za-z0-9_-]\{10,\}\.eyJ[A-Za-z0-9_-]*c2VydmljZV9yb2xl'; then
  printf '%sSECRET%s   Supabase service_role JWT (full DB access, bypasses RLS)\n' "$RED" "$OFF"
  fail=1
fi

# ── 3. Advisory: large files ─────────────────────────────────────────────────
while IFS= read -r f; do
  [ -f "$f" ] || continue
  sz=$(wc -c < "$f" | tr -d ' ')
  if [ "$sz" -gt 5242880 ]; then
    printf '%sLARGE%s    %s (%s MB) — git keeps this forever\n' "$YEL" "$OFF" "$f" "$((sz/1048576))"
  fi
done <<< "$staged"

if [ "$fail" -ne 0 ]; then
  cat <<EOF

${RED}Commit refused.${OFF}

This repository is public. Anything committed here is world-readable within
minutes, and going private again does not recall forks, clones, or archives.

  Untrack a file but keep it on disk:   git rm --cached <file>
  Then ignore it:                       echo "<file>" >> .gitignore
  Rotate a leaked key at the provider.  Removing the line is not enough.

If this is a false positive:            git commit --no-verify
EOF
  exit 1
fi

exit 0
