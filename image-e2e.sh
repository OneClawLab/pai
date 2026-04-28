#!/usr/bin/env bash
#
# PAI Image E2E Test Script — image generation, editing, and chat --image
#
# Prerequisites:
#   - pai must be built (npm run build)
#   - Default image provider/model configured:
#       pai model default --image-provider <name> --image-model gpt-image-2
#   - Provider must have input=["text","image"] for chat --image tests
#
# Usage: bash image-e2e.sh
#
set -uo pipefail

source "$(dirname "$0")/scripts/e2e-lib.sh"

PAI="pai"

# ── Retry wrapper for flaky API calls ─────────────────────────
# run_cmd_retry <max_retries> <delay_secs> <cmd...>
#   Retries the command up to max_retries times with delay between attempts.
#   Sets $OUT and $EC like run_cmd.
run_cmd_retry() {
  local max_retries=$1 delay=$2
  shift 2
  local attempt
  for attempt in $(seq 1 "$max_retries"); do
    run_cmd "$@"
    if [[ $EC -eq 0 ]]; then
      return 0
    fi
    if [[ $attempt -lt $max_retries ]]; then
      printf "    (attempt %d/%d failed, retrying in %ds...)\n" "$attempt" "$max_retries" "$delay"
      sleep "$delay"
    fi
  done
  return $EC
}

# Pace between API calls to avoid 429
pace() { sleep "${IMAGE_PACE:-5}"; }

setup_e2e

# ── Pre-flight ────────────────────────────────────────────────
section "Pre-flight"

require_bin $PAI "run npm run build"

DEFAULTS=$($PAI model default --json 2>/dev/null)
IMG_PROVIDER=$(echo "$DEFAULTS" | json_field_from_stdin "defaultImageProvider")
IMG_MODEL=$(echo "$DEFAULTS" | json_field_from_stdin "defaultImageModel")
CHAT_PROVIDER=$(echo "$DEFAULTS" | json_field_from_stdin "defaultProvider")

if [[ -z "$IMG_PROVIDER" ]]; then
  fail "No default image provider — run: pai model default --image-provider <name>"
  exit 1
fi
pass "Image provider: $IMG_PROVIDER"

if [[ -z "$IMG_MODEL" ]]; then
  fail "No default image model — run: pai model default --image-model gpt-image-2"
  exit 1
fi
pass "Image model: $IMG_MODEL"

if [[ -z "$CHAT_PROVIDER" ]]; then
  fail "No default chat provider — run: pai model default --name <provider>"
  exit 1
fi
pass "Chat provider: $CHAT_PROVIDER"

# ══════════════════════════════════════════════════════════════
# 1. Basic image generation — save to file
# ══════════════════════════════════════════════════════════════
section "1. Basic image generation (--output)"

IMG1="$TD/cat.png"
run_cmd_retry 3 10 $PAI image "a cute cartoon cat sitting on a windowsill, simple flat illustration" \
  --output "$IMG1" --quality low --size 1024x1024
assert_exit0
assert_nonempty
assert_file_exists "$IMG1" "cat.png"

# Verify it's a real PNG (starts with PNG magic bytes)
if node -e "
  const b = require('fs').readFileSync(process.argv[1]);
  if (b[0]!==0x89 || b[1]!==0x50) process.exit(1);
" "$(np "$IMG1")" 2>/dev/null; then
  pass "cat.png is valid PNG"
else
  fail "cat.png is not a valid PNG"
fi

pace

# ══════════════════════════════════════════════════════════════
# 2. Image generation — base64 to stdout
# ══════════════════════════════════════════════════════════════
section "2. Image generation (base64 stdout)"

run_cmd_retry 3 10 $PAI image "a simple red circle on white background" --quality low --size 1024x1024
assert_exit0
assert_nonempty

# Verify stdout is valid base64 (decode should succeed)
if node -e "
  const b64 = require('fs').readFileSync(process.argv[1], 'utf8').trim();
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 100) process.exit(1);
" "$(np "$OUT")" 2>/dev/null; then
  pass "stdout is valid base64 image data"
else
  fail "stdout is not valid base64"
fi

pace

# ══════════════════════════════════════════════════════════════
# 3. Image generation — JSON output
# ══════════════════════════════════════════════════════════════
section "3. Image generation (--json)"

IMG3="$TD/json_test.png"
run_cmd_retry 3 10 $PAI image "a blue square" --quality low --size 1024x1024 \
  --output "$IMG3" --json
assert_exit0
assert_nonempty
assert_contains '"images"'
assert_contains '"created"'

pace

# ══════════════════════════════════════════════════════════════
# 4. Multiple images (-n 2)
# ══════════════════════════════════════════════════════════════
section "4. Multiple images (-n 2)"

IMG4="$TD/multi.png"
run_cmd_retry 3 10 $PAI image "abstract geometric pattern, minimal" -n 2 --quality low --size 1024x1024 \
  --output "$IMG4"
assert_exit0
assert_nonempty

# Should produce multi_1.png and multi_2.png
assert_file_exists "$TD/multi_1.png" "multi_1.png"
assert_file_exists "$TD/multi_2.png" "multi_2.png"

pace

# ══════════════════════════════════════════════════════════════
# 5. Stdin prompt
# ══════════════════════════════════════════════════════════════
section "5. Stdin prompt"

IMG5="$TD/stdin.png"
echo "a green triangle on black background" | $PAI image --quality low --size 1024x1024 \
  --output "$IMG5" >"$TD/out_stdin.txt" 2>/dev/null
EC=$?
OUT="$TD/out_stdin.txt"
assert_exit0
assert_file_exists "$IMG5" "stdin.png"

pace

# ══════════════════════════════════════════════════════════════
# 6. Prompt from file (--input-file)
# ══════════════════════════════════════════════════════════════
section "6. Prompt from file (--input-file)"

PROMPT_FILE="$TD/prompt.txt"
echo "a yellow star on a purple background, flat design" > "$PROMPT_FILE"
IMG6="$TD/from_file.png"
run_cmd_retry 3 10 $PAI image --input-file "$PROMPT_FILE" --quality low --size 1024x1024 \
  --output "$IMG6"
assert_exit0
assert_file_exists "$IMG6" "from_file.png"

pace

# ══════════════════════════════════════════════════════════════
# 7. Image edit — first round (add element)
#    Depends on test 1 (cat.png)
# ══════════════════════════════════════════════════════════════
section "7. Image edit — round 1 (add hat to cat)"

if [[ ! -f "$IMG1" ]]; then
  fail "SKIP: cat.png not available (test 1 failed)"
else
  IMG7="$TD/cat_hat.png"
  run_cmd_retry 3 15 $PAI image "add a small red top hat on the cat's head" \
    --image "$IMG1" \
    --output "$IMG7" --quality low --size 1024x1024
  assert_exit0
  assert_file_exists "$IMG7" "cat_hat.png"

  if node -e "
    const b = require('fs').readFileSync(process.argv[1]);
    if (b[0]!==0x89 || b[1]!==0x50) process.exit(1);
  " "$(np "$IMG7")" 2>/dev/null; then
    pass "cat_hat.png is valid PNG"
  else
    fail "cat_hat.png is not a valid PNG"
  fi
fi

pace

# ══════════════════════════════════════════════════════════════
# 8. Image edit — second round (add another element)
#    Depends on test 7 (cat_hat.png)
# ══════════════════════════════════════════════════════════════
section "8. Image edit — round 2 (add sunglasses)"

IMG7="${IMG7:-$TD/cat_hat.png}"
if [[ ! -f "$IMG7" ]]; then
  fail "SKIP: cat_hat.png not available (test 7 failed)"
else
  IMG8="$TD/cat_hat_glasses.png"
  run_cmd_retry 3 15 $PAI image "add cool black sunglasses to the cat" \
    --image "$IMG7" \
    --output "$IMG8" --quality low --size 1024x1024
  assert_exit0
  assert_file_exists "$IMG8" "cat_hat_glasses.png"

  if node -e "
    const b = require('fs').readFileSync(process.argv[1]);
    if (b[0]!==0x89 || b[1]!==0x50) process.exit(1);
  " "$(np "$IMG8")" 2>/dev/null; then
    pass "cat_hat_glasses.png is valid PNG"
  else
    fail "cat_hat_glasses.png is not a valid PNG"
  fi
fi

pace

# ══════════════════════════════════════════════════════════════
# 9. Image edit — style transfer
#    Depends on test 1 (cat.png)
# ══════════════════════════════════════════════════════════════
section "9. Image edit — style transfer (watercolor)"

if [[ ! -f "$IMG1" ]]; then
  fail "SKIP: cat.png not available (test 1 failed)"
else
  IMG9="$TD/cat_watercolor.png"
  run_cmd_retry 3 15 $PAI image "transform this into a watercolor painting style" \
    --image "$IMG1" \
    --output "$IMG9" --quality low --size 1024x1024
  assert_exit0
  assert_file_exists "$IMG9" "cat_watercolor.png"
fi

pace

# ══════════════════════════════════════════════════════════════
# 10. Image edit — JSON output
#     Depends on test 1 (cat.png)
# ══════════════════════════════════════════════════════════════
section "10. Image edit — JSON output"

if [[ ! -f "$IMG1" ]]; then
  fail "SKIP: cat.png not available (test 1 failed)"
else
  IMG10="$TD/edit_json.png"
  run_cmd_retry 3 15 $PAI image "make the background blue" \
    --image "$IMG1" \
    --output "$IMG10" --json --quality low --size 1024x1024
  assert_exit0
  assert_contains '"images"'
  assert_contains '"created"'
fi

pace

# ══════════════════════════════════════════════════════════════
# 11. pai chat --image (multimodal vision)
#     Depends on test 1 (cat.png)
# ══════════════════════════════════════════════════════════════
section "11. pai chat --image (describe image)"

if [[ ! -f "$IMG1" ]]; then
  fail "SKIP: cat.png not available (test 1 failed)"
else
  run_cmd_retry 2 10 $PAI chat "Describe this image in one short sentence. What animal do you see?" \
    --image "$IMG1"
  assert_exit0
  assert_nonempty
  assert_contains "cat"
fi

pace

# ══════════════════════════════════════════════════════════════
# 12. pai chat --image (compare original vs edited)
#     Depends on test 1 (cat.png) and test 7 (cat_hat.png)
# ══════════════════════════════════════════════════════════════
section "12. pai chat --image (compare two images)"

if [[ ! -f "$IMG1" ]] || [[ ! -f "${IMG7:-}" ]]; then
  fail "SKIP: requires cat.png and cat_hat.png"
else
  run_cmd_retry 2 10 $PAI chat "I'm showing you two images. The first is the original, the second is edited. What was added in the second image? Reply in one short sentence." \
    --image "$IMG1" --image "$IMG7"
  assert_exit0
  assert_nonempty
  assert_contains "hat"
fi

pace

# ══════════════════════════════════════════════════════════════
# 13. Error: missing prompt
# ══════════════════════════════════════════════════════════════
section "13. Error: missing prompt"

run_cmd $PAI image --output "$TD/nope.png"
assert_nonzero_exit
assert_file_missing "$TD/nope.png" "nope.png"

# ══════════════════════════════════════════════════════════════
# 14. Error: invalid size
# ══════════════════════════════════════════════════════════════
section "14. Error: invalid size"

run_cmd $PAI image "test" --size 999x999 --output "$TD/nope2.png"
assert_nonzero_exit

# ══════════════════════════════════════════════════════════════
# 15. Error: edit with nonexistent image
# ══════════════════════════════════════════════════════════════
section "15. Error: edit with nonexistent image"

run_cmd $PAI image "edit this" --image "$TD/does_not_exist.png" --output "$TD/nope3.png"
assert_nonzero_exit

# ══════════════════════════════════════════════════════════════
# 16. Wide format generation
# ══════════════════════════════════════════════════════════════
section "16. Wide format (1536x1024)"

IMG16="$TD/wide.png"
run_cmd_retry 3 10 $PAI image "a panoramic mountain landscape at sunset" \
  --size 1536x1024 --quality low --output "$IMG16"
assert_exit0
assert_file_exists "$IMG16" "wide.png"

pace

# ══════════════════════════════════════════════════════════════
# 17. Tall format generation
# ══════════════════════════════════════════════════════════════
section "17. Tall format (1024x1536)"

IMG17="$TD/tall.png"
run_cmd_retry 3 10 $PAI image "a tall lighthouse by the sea, vertical composition" \
  --size 1024x1536 --quality low --output "$IMG17"
assert_exit0
assert_file_exists "$IMG17" "tall.png"

# ══════════════════════════════════════════════════════════════
# Done
# ══════════════════════════════════════════════════════════════

summary_and_exit
