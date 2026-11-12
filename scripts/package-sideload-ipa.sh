#!/bin/bash
set -euo pipefail

usage() {
  echo "usage: $0 <path/to/PocketPal.app> <path/to/PocketPal.entitlements> <output.ipa>" >&2
  exit 64
}

[ "$#" -eq 3 ] || usage

APP_PATH=${1%/}
ENTITLEMENTS_PATH=$2
OUTPUT_IPA=$3

if [ ! -d "$APP_PATH" ]; then
  echo "error: .app directory not found: $APP_PATH" >&2
  exit 1
fi

if [ ! -f "$ENTITLEMENTS_PATH" ]; then
  echo "error: entitlements file not found: $ENTITLEMENTS_PATH" >&2
  exit 1
fi

WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

PAYLOAD_DIR="$WORK_DIR/Payload"
STAGED_APP="$PAYLOAD_DIR/$(basename "$APP_PATH")"
mkdir -p "$PAYLOAD_DIR"
cp -R "$APP_PATH" "$STAGED_APP"

# Ad-hoc sign embedded frameworks and dylibs first so nested signatures remain valid.
if [ -d "$STAGED_APP/Frameworks" ]; then
  find "$STAGED_APP/Frameworks" -maxdepth 2 \( -name "*.framework" -o -name "*.dylib" \) | while IFS= read -r item; do
    codesign --force --sign - --timestamp=none "$item"
  done
fi

# Ad-hoc sign the app bundle WITH entitlements so SideStore / Sideloadly preserve
# increased-memory-limit and extended-virtual-addressing during free Apple ID re-signing.
codesign --force --sign - --entitlements "$ENTITLEMENTS_PATH" --timestamp=none "$STAGED_APP"

ENTITLEMENTS_DUMP=$(codesign -d --entitlements :- "$STAGED_APP" 2>&1 || true)
echo "$ENTITLEMENTS_DUMP"
if ! grep -q "com.apple.developer.kernel.increased-memory-limit" <<<"$ENTITLEMENTS_DUMP"; then
  echo "error: increased-memory-limit entitlement missing from signed app bundle" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_IPA")"
ABS_OUTPUT_IPA=$(cd "$(dirname "$OUTPUT_IPA")" && pwd)/$(basename "$OUTPUT_IPA")

(
  cd "$WORK_DIR"
  ditto -c -k --sequesterRsrc --keepParent Payload "$ABS_OUTPUT_IPA"
)

ls -lh "$ABS_OUTPUT_IPA"
echo "Packaged sideload IPA at: $ABS_OUTPUT_IPA"

