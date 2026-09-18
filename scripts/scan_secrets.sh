#!/usr/bin/env bash
# Simple secret scanner (security remediation DIYHOMIE-EM-02).
# Fails (exit 1) if likely credentials appear in tracked source files.
set -u
cd "$(dirname "$0")/.."

PATTERNS=(
  'password"?\s*[:=]\s*"[^"$<{][^"]{5,}"'      # hardcoded password literals
  'sk-[A-Za-z0-9]{20,}'                          # OpenAI-style keys
  'AKIA[0-9A-Z]{16}'                             # AWS access keys
  'preview\.emergentagent\.com'                  # non-local default URLs in tests
)
EXCLUDES=(--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=backups
          --exclude-dir=test_reports --exclude-dir=memory
          --exclude='*.env*' --exclude='scan_secrets.sh' --exclude='*.lock' --exclude='*.log')

FAIL=0
for p in "${PATTERNS[@]}"; do
  HITS=$(grep -rInE "${EXCLUDES[@]}" "$p" backend/tests backend/*.py frontend/src frontend/app 2>/dev/null \
         | grep -v 'environ' | grep -v 'placeholder' | grep -v 'change-me' | grep -v 'WRONG_PW' | head -20)
  if [ -n "$HITS" ]; then
    echo "POTENTIAL SECRET ($p):"
    echo "$HITS"
    FAIL=1
  fi
done
if [ "$FAIL" -eq 0 ]; then echo "✅ No secrets detected in source."; fi
exit $FAIL
