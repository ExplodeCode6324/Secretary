#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${DEVELOPER_DIR:?Set DEVELOPER_DIR to Xcode 16.4 Contents/Developer}"
version=$(xcodebuild -version)
if [[ "$version" != $'Xcode 16.4\nBuild version 16F6' ]]; then
  echo 'Xcode 16.4 (16F6) is required; refusing an implicit toolchain change.' >&2
  exit 1
fi
printf '%s\n' "$version"
xcrun swift --version
package=src/secretary_macos/Packages/SecretaryKit
cmp docs/api/v1/examples.json "$package/Tests/SecretaryKitTests/Fixtures/api-v1.json"
xcrun swift test --package-path "$package" --force-resolved-versions
node test_case/native/fixture-probe.mjs "$PWD/$package/.build/debug/SecretaryProbe"
SECRETARY_MODE=fixture node --import tsx test_case/native/management-fixture.ts "$PWD/$package/.build/debug/SecretaryProbe"
xcodebuild -project src/secretary_macos/Secretary.xcodeproj -scheme Secretary \
  -configuration Debug -destination 'platform=macOS' -derivedDataPath .build/native \
  -disableAutomaticPackageResolution build-for-testing
python3 - <<'PY'
import json
from pathlib import Path
root = Path('src/secretary_macos')
a = json.loads((root/'Packages/SecretaryKit/Package.resolved').read_text())['pins']
b = json.loads((root/'Secretary.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved').read_text())['pins']
assert a == b, 'Xcode and SwiftPM dependency pins diverged'
assert next(p for p in a if p['identity'] == 'swift-markdown')['state']['version'] == '0.6.0'
print('PASS: dependency pins and public DTO fixture match')
PY
