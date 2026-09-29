#!/usr/bin/env bash
# Installs the workspace when a Claude Code on the web session starts, so the
# session can run the checks in AGENTS.md straight away. Local sessions skip
# it; run `pnpm install --frozen-lockfile` yourself there.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:?CLAUDE_PROJECT_DIR is not set}"

# Keep pnpm's upgrade notice and Next.js telemetry out of every session.
# pnpm 10 reads the npm_ name and pnpm 11 the pnpm_ one.
export npm_config_update_notifier=false pnpm_config_update_notifier=false
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  for line in \
    "export npm_config_update_notifier=false" \
    "export pnpm_config_update_notifier=false" \
    "export NEXT_TELEMETRY_DISABLED=1"; do
    grep -qxF "$line" "$CLAUDE_ENV_FILE" 2>/dev/null || echo "$line" >>"$CLAUDE_ENV_FILE"
  done
fi

log="$(mktemp -t beekeeping-session-start.XXXXXX)"
trap 'rm -f "$log"' EXIT

# A hook has no terminal, so pnpm can't ask before it rebuilds node_modules,
# which it must do after a pnpm upgrade. Tell it not to ask.
if ! pnpm install --frozen-lockfile --config.confirmModulesPurge=false >"$log" 2>&1; then
  echo "session-start: pnpm install --frozen-lockfile failed:" >&2
  cat "$log" >&2
  exit 1
fi

# The ocr-review skill needs the open-code-review CLI.
if ! command -v ocr >/dev/null 2>&1; then
  if ! npm install --global @alibaba-group/open-code-review@1.12.10 >>"$log" 2>&1; then
    echo "session-start: installing the ocr CLI failed:" >&2
    cat "$log" >&2
    exit 1
  fi
fi

echo "session-start: installed the workspace with pnpm $(pnpm --version) on Node $(node --version). Run pnpm check, pnpm build and pnpm test:e2e before asking for review."
