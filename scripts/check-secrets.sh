#!/usr/bin/env bash
# Fails if anything that looks like a real credential is tracked by git.
#
#   scripts/check-secrets.sh
#
# CI runs this on every pull request. It is a safety net, not the main
# defence: the main defence is that secrets only ever live in backend/.env
# (which .gitignore excludes) and in the hosting provider's settings.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

status=0

# 1. No environment files, keys or certificates in the repository at all.
tracked=$(git ls-files | grep -E '(^|/)\.env($|\.)|\.pem$|\.key$|\.p12$|\.pfx$' | grep -v '\.env\.example$' || true)
if [ -n "$tracked" ]; then
  echo "These files must not be committed:"
  echo "$tracked" | sed 's/^/  /'
  status=1
fi

# 2. Nothing shaped like a live credential inside any tracked file.
patterns=(
  'sk-ant-[A-Za-z0-9_-]{20,}'                        # Anthropic API key
  'sk_(live|test)_[A-Za-z0-9]{20,}'                  # Stripe secret key
  'rk_(live|test)_[A-Za-z0-9]{20,}'                  # Stripe restricted key
  'whsec_[A-Za-z0-9]{24,}'                           # Stripe webhook secret
  'AKIA[0-9A-Z]{16}'                                 # AWS access key id
  'gh[pousr]_[A-Za-z0-9]{30,}'                       # GitHub token
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'               # private key block
  'postgres(ql)?://[^:@/[:space:]]+:[^@/[:space:]]{12,}@[a-z0-9.-]+\.(neon\.tech|amazonaws\.com|render\.com)'  # hosted DB URL with password
)
for pattern in "${patterns[@]}"; do
  # -I skips binary files; the lockfiles are skipped because their integrity
  # hashes are long random-looking strings by design.
  hits=$(git grep -nIE -e "$pattern" -- . ':!*package-lock.json' || true)
  if [ -n "$hits" ]; then
    echo "Possible secret (pattern: $pattern):"
    # Print where, never the value.
    echo "$hits" | cut -d: -f1,2 | sed 's/^/  /'
    status=1
  fi
done

if [ "$status" -eq 0 ]; then
  echo "No secrets found in tracked files."
else
  echo
  echo "If a real key was committed, removing it is not enough: revoke it and create a new one."
fi
exit "$status"
