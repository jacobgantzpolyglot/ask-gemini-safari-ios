#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$ROOT_DIR/build"
DIST_DIR="$ROOT_DIR/dist"

rm -rf "$BUILD_DIR" "$DIST_DIR"
mkdir -p "$BUILD_DIR" "$DIST_DIR"

echo "==> Checking Xcode & safari-web-extension-converter..."
xcodebuild -version
HELP_TEXT="$(xcrun safari-web-extension-converter --help 2>&1 || true)"

EXTRA_ARGS=()
if echo "$HELP_TEXT" | grep -q -- "--iOS-only"; then
  EXTRA_ARGS+=("--iOS-only")
elif echo "$HELP_TEXT" | grep -q -- "--ios-only"; then
  EXTRA_ARGS+=("--ios-only")
fi

echo "==> Generating Xcode Safari Web Extension project..."
xcrun safari-web-extension-converter "$ROOT_DIR/extension" \
  --project-location "$BUILD_DIR/SafariProject" \
  --app-name "Ask Gemini" \
  --bundle-identifier "com.askgemini.safari.ios" \
  --swift \
  --copy-resources \
  --no-open \
  --no-prompt \
  --force \
  "${EXTRA_ARGS[@]}"

echo "==> Customizing host iOS onboarding screen & AppIcon..."
while IFS= read -r -d '' main_html; do
  cp "$ROOT_DIR/host-app/Main.html" "$main_html"
  echo "Replaced $main_html"
done < <(find "$BUILD_DIR/SafariProject" -name "Main.html" -print0)

while IFS= read -r -d '' appiconset; do
  cp "$ROOT_DIR/host-app/icon-1024.png" "$appiconset/icon-1024.png"
  cat > "$appiconset/Contents.json" <<'EOF'
{
  "images" : [
    {
      "filename" : "icon-1024.png",
      "idiom" : "universal",
      "platform" : "ios",
      "size" : "1024x1024"
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
EOF
  echo "Updated iOS AppIcon in $appiconset"
done < <(find "$BUILD_DIR/SafariProject" -type d -name "AppIcon.appiconset" -print0)

XCODEPROJ="$(find "$BUILD_DIR/SafariProject" -maxdepth 3 -name "*.xcodeproj" | head -n 1)"
if [[ -z "$XCODEPROJ" ]]; then
  echo "ERROR: Could not find generated .xcodeproj"
  exit 1
fi
echo "==> Found project: $XCODEPROJ"

IOS_SCHEME="$(xcodebuild -project "$XCODEPROJ" -list -json | python3 -c '
import json, sys
data = json.load(sys.stdin)
schemes = data.get("project", {}).get("schemes", [])
for s in schemes:
    if "(iOS)" in s:
        print(s)
        sys.exit(0)
if schemes:
    print(schemes[0])
    sys.exit(0)
sys.exit(1)
')"
echo "==> Selected iOS scheme: $IOS_SCHEME"

DERIVED_DATA="$BUILD_DIR/DerivedData"

echo "==> Building unsigned iOS app + Safari Web Extension (.appex)..."
xcodebuild build \
  -project "$XCODEPROJ" \
  -scheme "$IOS_SCHEME" \
  -configuration Release \
  -sdk iphoneos \
  -destination "generic/platform=iOS" \
  -derivedDataPath "$DERIVED_DATA" \
  IPHONEOS_DEPLOYMENT_TARGET=15.4 \
  CODE_SIGN_IDENTITY="" \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGNING_ALLOWED=NO \
  ENABLE_BITCODE=NO \
  ENABLE_DEBUG_DYLIB=NO \
  COMPILER_INDEX_STORE_ENABLE=NO

APP_BUNDLE="$(find "$DERIVED_DATA/Build/Products/Release-iphoneos" -maxdepth 1 -name "*.app" | head -n 1)"
if [[ -z "$APP_BUNDLE" || ! -d "$APP_BUNDLE" ]]; then
  echo "ERROR: Built .app bundle not found!"
  exit 1
fi

APPEX_BUNDLE="$(find "$APP_BUNDLE/PlugIns" -maxdepth 1 -name "*.appex" | head -n 1 || true)"
if [[ -z "$APPEX_BUNDLE" || ! -d "$APPEX_BUNDLE" ]]; then
  echo "ERROR: Embedded Safari Web Extension (.appex) not found inside $APP_BUNDLE/PlugIns!"
  exit 1
fi
echo "==> Verified embedded Safari extension: $APPEX_BUNDLE"

echo "==> Applying clean ad-hoc signatures (inner-most .appex first, then outer .app)..."
rm -rf "$APP_BUNDLE/_CodeSignature" "$APPEX_BUNDLE/_CodeSignature"
codesign --force --sign - --timestamp=none "$APPEX_BUNDLE"
codesign --force --sign - --timestamp=none "$APP_BUNDLE"

echo "==> Packaging unsigned IPA..."
STAGE_DIR="$BUILD_DIR/Stage"
mkdir -p "$STAGE_DIR/Payload"
cp -R "$APP_BUNDLE" "$STAGE_DIR/Payload/"

IPA_PATH="$DIST_DIR/AskGemini-Safari-iOS-unsigned.ipa"
(
  cd "$STAGE_DIR"
  ditto -c -k --sequesterRsrc --keepParent "Payload" "$IPA_PATH"
)

echo "==> Successfully built unsigned IPA:"
ls -lh "$IPA_PATH"
unzip -l "$IPA_PATH" | head -n 40
