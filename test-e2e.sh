#!/usr/bin/env bash
#
# PAI CLI End-to-End Test Script
# Tests core functionality against a real LLM endpoint.
# Usage: bash test-e2e.sh [--config <path>] [--provider <name>]
#
set -uo pipefail

CONFIG="${PAI_E2E_CONFIG:-test-config.json}"
PROVIDER="${PAI_E2E_PROVIDER:-azure-gpt41-mini}"
PAI="node dist/index.js"
TD=$(mktemp -d)
PASS=0; FAIL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config)   CONFIG="$2"; shift 2 ;;
    --provider) PROVIDER="$2"; shift 2 ;;
    *) echo "Unknown: $1"; exit 1 ;;
  esac
done

cleanup() { rm -rf "$TD"; }
trap cleanup EXIT

G() { printf "\033[32m  ✓ %s\033[0m\n" "$*"; PASS=$((PASS+1)); }
R() { printf "\033[31m  ✗ %s\033[0m\n" "$*"; FAIL=$((FAIL+1)); }
S() { echo ""; printf "\033[33m━━ %s ━━\033[0m\n" "$*"; }

# Run pai with stdin from /dev/null to prevent hanging on tty check
run_pai() {
  $PAI "$@" </dev/null
}

# ── Pre-flight ────────────────────────────────────────────────
S "Pre-flight"
if [[ -f "$CONFIG" ]]; then G "Config: $CONFIG"; else R "Config not found: $CONFIG"; exit 1; fi
if run_pai --version >/dev/null 2>&1; then G "pai binary OK"; else R "pai broken — run npm run build"; exit 1; fi

# ══════════════════════════════════════════════════════════════
# 1. Basic chat (non-streaming)
# ══════════════════════════════════════════════════════════════
S "1. Basic chat (non-streaming)"
OUT="$TD/1_stdout.txt"
run_pai chat "Reply with exactly the word PONG and nothing else" \
  --config "$CONFIG" --provider "$PROVIDER" >"$OUT" 2>/dev/null
EC=$?
[[ $EC -eq 0 ]] && G "exit=0" || R "exit=$EC (expected 0)"
[[ -s "$OUT" ]] && G "stdout non-empty" || R "stdout empty"
grep -qi "PONG" "$OUT" && G "contains PONG" || R "missing PONG"

# ══════════════════════════════════════════════════════════════
# 2. Streaming chat
# ══════════════════════════════════════════════════════════════
S "2. Streaming chat"
OUT="$TD/2_stdout.txt"
run_pai chat "Reply with exactly the word STREAM_OK and nothing else" \
  --config "$CONFIG" --provider "$PROVIDER" --stream >"$OUT" 2>/dev/null
EC=$?
[[ $EC -eq 0 ]] && G "exit=0" || R "exit=$EC"
grep -qi "STREAM_OK" "$OUT" && G "contains STREAM_OK" || R "missing STREAM_OK"

# ══════════════════════════════════════════════════════════════
# 3. Tool calling (bash_exec)
# ══════════════════════════════════════════════════════════════
S "3. Tool calling (bash_exec)"
OUT="$TD/3_stdout.txt"
run_pai chat "Use the bash_exec tool to run: echo E2E_TOOL_OK. Then reply with the exact output of that command." \
  --config "$CONFIG" --provider "$PROVIDER" >"$OUT" 2>/dev/null
EC=$?
[[ $EC -eq 0 ]] && G "exit=0" || R "exit=$EC"
[[ -s "$OUT" ]] && G "stdout non-empty" || R "stdout empty"
grep -qi "E2E_TOOL_OK" "$OUT" && G "tool result echoed" || R "missing E2E_TOOL_OK"

# ══════════════════════════════════════════════════════════════
# 4. System instruction
# ══════════════════════════════════════════════════════════════
S "4. System instruction"
OUT="$TD/4_stdout.txt"
run_pai chat "What is your name?" \
  --config "$CONFIG" --provider "$PROVIDER" \
  --system "You are TestBot. Always start your reply with: I am TestBot." >"$OUT" 2>/dev/null
EC=$?
[[ $EC -eq 0 ]] && G "exit=0" || R "exit=$EC"
grep -qi "TestBot" "$OUT" && G "system instruction respected" || R "missing TestBot"

# ══════════════════════════════════════════════════════════════
# 5. Session file round-trip
# ══════════════════════════════════════════════════════════════
S "5. Session round-trip"
SESS="$TD/session.jsonl"
OUT="$TD/5_stdout.txt"

# Turn 1: store a code
run_pai chat "Remember this code: ALPHA-7749" \
  --config "$CONFIG" --provider "$PROVIDER" \
  --session "$SESS" >/dev/null 2>&1
[[ -f "$SESS" ]] && G "session file created" || R "session file missing"

# Turn 2: recall
run_pai chat "What was the code I asked you to remember? Reply with just the code." \
  --config "$CONFIG" --provider "$PROVIDER" \
  --session "$SESS" >"$OUT" 2>/dev/null
EC=$?
[[ $EC -eq 0 ]] && G "exit=0" || R "exit=$EC"
grep -qi "ALPHA-7749" "$OUT" && G "session context preserved" || R "missing ALPHA-7749"

# ══════════════════════════════════════════════════════════════
# 6. --json flag (NDJSON on stderr)
# ══════════════════════════════════════════════════════════════
S "6. --json flag"
ERR="$TD/6_stderr.txt"
run_pai chat "Reply with: JSON_OK" \
  --config "$CONFIG" --provider "$PROVIDER" \
  --json >/dev/null 2>"$ERR"

LINE=$(head -1 "$ERR")
if echo "$LINE" | node -e "JSON.parse(require('fs').readFileSync(0,'utf8'))" 2>/dev/null; then
  G "stderr line is valid JSON"
else
  R "stderr line not valid JSON: $LINE"
fi
echo "$LINE" | grep -q '"type"' && G "has type field" || R "missing type field"

# ══════════════════════════════════════════════════════════════
# 7. --quiet flag
# ══════════════════════════════════════════════════════════════
S "7. --quiet flag"
OUT="$TD/7_stdout.txt"
ERR="$TD/7_stderr.txt"
run_pai chat "Reply with: QUIET_OK" \
  --config "$CONFIG" --provider "$PROVIDER" \
  --quiet >"$OUT" 2>"$ERR"
EC=$?
[[ $EC -eq 0 ]] && G "exit=0" || R "exit=$EC"
[[ -s "$OUT" ]] && G "stdout has content" || R "stdout empty"
[[ ! -s "$ERR" ]] && G "stderr empty" || R "stderr not empty: $(cat "$ERR")"

# ══════════════════════════════════════════════════════════════
# 8. --log flag
# ══════════════════════════════════════════════════════════════
S "8. --log flag"
LOG="$TD/chat.log.md"
run_pai chat "Reply with: LOG_OK" \
  --config "$CONFIG" --provider "$PROVIDER" \
  --log "$LOG" >/dev/null 2>&1
[[ -f "$LOG" ]] && G "log file created" || R "log file missing"
grep -qi "User" "$LOG" && G "log has User entry" || R "log missing User"
grep -qi "Assistant" "$LOG" && G "log has Assistant entry" || R "log missing Assistant"

# ══════════════════════════════════════════════════════════════
# 9. Stdin pipe input
# ══════════════════════════════════════════════════════════════
S "9. Stdin pipe"
OUT="$TD/9_stdout.txt"
# NOTE: this test intentionally pipes stdin instead of using </dev/null
echo "Reply with exactly: PIPE_OK" | $PAI chat \
  --config "$CONFIG" --provider "$PROVIDER" >"$OUT" 2>/dev/null
EC=$?
[[ $EC -eq 0 ]] && G "exit=0" || R "exit=$EC"
grep -qi "PIPE_OK" "$OUT" && G "stdin pipe works" || R "missing PIPE_OK"

# ══════════════════════════════════════════════════════════════
# 10. System instruction from file
# ══════════════════════════════════════════════════════════════
S "10. System instruction from file"
OUT="$TD/10_stdout.txt"
SYSF="$TD/system.txt"
echo "You are a pirate. Always say Arrr in your reply." > "$SYSF"
run_pai chat "Hello" \
  --config "$CONFIG" --provider "$PROVIDER" \
  --system-file "$SYSF" >"$OUT" 2>/dev/null
EC=$?
[[ $EC -eq 0 ]] && G "exit=0" || R "exit=$EC"
grep -qi "Arrr" "$OUT" && G "system-file respected" || R "missing Arrr"

# ══════════════════════════════════════════════════════════════
# 11. model list
# ══════════════════════════════════════════════════════════════
S "11. model list"
OUT="$TD/11_stdout.txt"
run_pai model list --config "$CONFIG" >"$OUT" 2>/dev/null
EC=$?
[[ $EC -eq 0 ]] && G "exit=0" || R "exit=$EC"
grep -qi "$PROVIDER" "$OUT" && G "lists provider" || R "missing $PROVIDER"

# ══════════════════════════════════════════════════════════════
# 12. model list --json
# ══════════════════════════════════════════════════════════════
S "12. model list --json"
OUT="$TD/12_stdout.txt"
run_pai model list --config "$CONFIG" --json >"$OUT" 2>/dev/null
EC=$?
[[ $EC -eq 0 ]] && G "exit=0" || R "exit=$EC"
if cat "$OUT" | node -e "JSON.parse(require('fs').readFileSync(0,'utf8'))" 2>/dev/null; then
  G "valid JSON"
else
  R "invalid JSON"
fi
grep -qi "$PROVIDER" "$OUT" && G "JSON has provider" || R "missing $PROVIDER"

# ══════════════════════════════════════════════════════════════
# 13. Error — missing provider
# ══════════════════════════════════════════════════════════════
S "13. Error — missing provider"
run_pai chat "hello" --config "$CONFIG" --provider nonexistent >/dev/null 2>&1
EC=$?
[[ $EC -eq 1 ]] && G "exit=1 for missing provider" || R "exit=$EC (expected 1)"

# ══════════════════════════════════════════════════════════════
# 14. Error — invalid temperature
# ══════════════════════════════════════════════════════════════
S "14. Error — invalid temperature"
run_pai chat "hello" --config "$CONFIG" --provider "$PROVIDER" --temperature 5.0 >/dev/null 2>&1
EC=$?
[[ $EC -eq 1 ]] && G "exit=1 for bad temperature" || R "exit=$EC (expected 1)"

# ══════════════════════════════════════════════════════════════
# 15. --no-append flag
# ══════════════════════════════════════════════════════════════
S "15. --no-append flag"
SESS_NA="$TD/session_na.jsonl"
run_pai chat "Hello" \
  --config "$CONFIG" --provider "$PROVIDER" \
  --session "$SESS_NA" --no-append >/dev/null 2>&1
if [[ ! -f "$SESS_NA" ]] || [[ ! -s "$SESS_NA" ]]; then
  G "session not written with --no-append"
else
  R "session should be empty with --no-append"
fi

# ══════════════════════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════════════════════
S "Results"
echo ""
TOTAL=$((PASS + FAIL))
printf "  Passed: \033[32m%d\033[0m\n" "$PASS"
printf "  Failed: %s\n" "$( [[ $FAIL -gt 0 ]] && printf "\033[31m%d\033[0m" "$FAIL" || echo 0 )"
echo "  Total:  $TOTAL"
echo ""
[[ $FAIL -eq 0 ]] && printf "\033[32mAll tests passed!\033[0m\n" && exit 0
printf "\033[31mSome tests failed.\033[0m\n" && exit 1
