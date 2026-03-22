#!/usr/bin/env bash
#
# PAI CLI End-to-End Test Script — chat functionality
# Prerequisite: pai must be installed and `pai model default` must have provider + model configured.
# Usage: bash test-e2e.sh
#
set -uo pipefail

source "$(dirname "$0")/scripts/e2e-lib.sh"

PAI="pai"

setup_e2e

# ── Pre-flight ────────────────────────────────────────────────
section "Pre-flight"

require_bin $PAI "run npm run build"

PROVIDER=$($PAI model default --json 2>/dev/null | json_field_from_stdin "defaultProvider")
if [[ -z "$PROVIDER" ]]; then fail "No default provider — run: pai model default --name <provider>"; exit 1; fi
pass "Default provider: $PROVIDER"

# ══════════════════════════════════════════════════════════════
# 1. Basic chat (non-streaming)
# ══════════════════════════════════════════════════════════════
section "1. Basic chat (non-streaming)"
run_cmd $PAI chat "Reply with exactly the word PONG and nothing else"
assert_exit0
assert_nonempty
assert_contains "PONG"

# ══════════════════════════════════════════════════════════════
# 2. Streaming chat
# ══════════════════════════════════════════════════════════════
section "2. Streaming chat"
run_cmd $PAI chat "Reply with exactly the word STREAM_OK and nothing else" --stream
assert_exit0
assert_contains "STREAM_OK"

# ══════════════════════════════════════════════════════════════
# 3. Tool calling (bash_exec)
# ══════════════════════════════════════════════════════════════
section "3. Tool calling (bash_exec)"
run_cmd $PAI chat "Use the bash_exec tool to run: echo E2E_TOOL_OK. Then reply with the exact output of that command."
assert_exit0
assert_contains "E2E_TOOL_OK"

# ══════════════════════════════════════════════════════════════
# 4. System instruction (--system)
# ══════════════════════════════════════════════════════════════
section "4. System instruction (--system)"
run_cmd $PAI chat "What is your name?" \
  --system "You are TestBot. Always start your reply with: I am TestBot."
assert_exit0
assert_contains "TestBot"

# ══════════════════════════════════════════════════════════════
# 5. System instruction from file (--system-file)
# ══════════════════════════════════════════════════════════════
section "5. System instruction from file (--system-file)"
SYSF="$TD/system.txt"
echo "You are a pirate. Always say Arrr in your reply." >"$SYSF"
run_cmd $PAI chat "Hello" --system-file "$SYSF"
assert_exit0
assert_contains "Arrr"

# ══════════════════════════════════════════════════════════════
# 6. Session file round-trip
# ══════════════════════════════════════════════════════════════
section "6. Session round-trip"
SESS="$TD/session.jsonl"
$PAI chat "Remember this code: ALPHA-7749" --session "$SESS" >/dev/null 2>&1
assert_file_exists "$SESS" "session file"

run_cmd $PAI chat "What was the code I asked you to remember? Reply with just the code." --session "$SESS"
assert_exit0
assert_contains "ALPHA-7749"

# ══════════════════════════════════════════════════════════════
# 7. --no-append flag
# ══════════════════════════════════════════════════════════════
section "7. --no-append flag"
SESS_NA="$TD/session_na.jsonl"
$PAI chat "Hello" --session "$SESS_NA" --no-append >/dev/null 2>&1
assert_empty "$SESS_NA"

# ══════════════════════════════════════════════════════════════
# 8. Stdin pipe input
# ══════════════════════════════════════════════════════════════
section "8. Stdin pipe"
echo "Reply with exactly: PIPE_OK" | $PAI chat >"$TD/out_pipe.txt" 2>/dev/null
EC=$?
OUT="$TD/out_pipe.txt"
assert_exit0
assert_contains "PIPE_OK"

# ══════════════════════════════════════════════════════════════
# 9. --json flag (stderr output)
# ══════════════════════════════════════════════════════════════
section "9. --json flag"
run_cmd_with_stderr $PAI chat "Reply with: JSON_OK" --json
assert_first_stderr_line_is_json
assert_contains '"type"' "$ERR"

# ══════════════════════════════════════════════════════════════
# 10. --quiet flag
# ══════════════════════════════════════════════════════════════
section "10. --quiet flag"
run_cmd_with_stderr $PAI chat "Reply with: QUIET_OK" --quiet
assert_exit0
assert_nonempty
assert_stderr_empty

# ══════════════════════════════════════════════════════════════
# 11. --log flag
# ══════════════════════════════════════════════════════════════
section "11. --log flag"
LOG="$TD/chat.log.md"
$PAI chat "Reply with: LOG_OK" --log "$LOG" >/dev/null 2>&1
assert_file_exists "$LOG" "log file"
assert_contains "User" "$LOG"
assert_contains "Assistant" "$LOG"

summary_and_exit
