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
export npm_config_update_notifier=false
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo "export npm_config_update_notifier=false"
    echo "export NEXT_TELEMETRY_DISABLED=1"
  } >>"$CLAUDE_ENV_FILE"
fi

log="$(mktemp -t beekeeping-session-start.XXXXXX)"
if ! pnpm install --frozen-lockfile >"$log" 2>&1; then
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

echo "session-start: installed the workspace with pnpm $(pnpm --version) on Node $(node --version). Run pnpm check and pnpm build before asking for review."
