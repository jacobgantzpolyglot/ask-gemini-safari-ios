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

echo "==> Normalizing bundle identifiers in project.pbxproj..."
python3 - "$XCODEPROJ/project.pbxproj" <<'PY'
import pathlib, re, sys

pbxproj = pathlib.Path(sys.argv[1])
text = pbxproj.read_text(encoding="utf-8")

def fix_bundle_id(match):
    prefix, val, suffix = match.group(1), match.group(2), match.group(3)
    if "Extension" in val:
        return f"{prefix}com.askgemini.safari.ios.Extension{suffix}"
    return f"{prefix}com.askgemini.safari.ios{suffix}"

new_text = re.sub(r'(PRODUCT_BUNDLE_IDENTIFIER\s*=\s*)([^;\n]+)(;)', fix_bundle_id, text)
pbxproj.write_text(new_text, encoding="utf-8")

for line in new_text.splitlines():
    if "PRODUCT_BUNDLE_IDENTIFIER" in line:
        print("  ", line.strip())
PY

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

echo "==> Applying clean ad-hoc signatures (embedded frameworks, inner .appex, then outer .app)..."
rm -rf "$APP_BUNDLE/_CodeSignature" "$APPEX_BUNDLE/_CodeSignature"
if [[ -d "$APPEX_BUNDLE/Frameworks" ]]; then
  while IFS= read -r -d '' fw; do
    codesign --force --sign - --timestamp=none "$fw"
  done < <(find "$APPEX_BUNDLE/Frameworks" -maxdepth 1 \( -name "*.dylib" -o -name "*.framework" \) -print0)
fi
codesign --force --sign - --timestamp=none "$APPEX_BUNDLE"

if [[ -d "$APP_BUNDLE/Frameworks" ]]; then
  while IFS= read -r -d '' fw; do
    codesign --force --sign - --timestamp=none "$fw"
  done < <(find "$APP_BUNDLE/Frameworks" -maxdepth 1 \( -name "*.dylib" -o -name "*.framework" \) -print0)
fi
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
unzip -l "$IPA_PATH" | head -n 40 || true
