#!/bin/bash
# Builds "Dashcam Editor.app" from launcher.applescript.
# Re-run this after editing launcher.applescript.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$HERE/.." && pwd)"
APP="$PROJECT_ROOT/Dashcam Editor.app"

echo "Building: $APP"

# Quit a running instance so we can overwrite it cleanly.
osascript -e 'tell application "Dashcam Editor" to quit' 2>/dev/null || true
rm -rf "$APP"

# Compile the AppleScript into an applet bundle.
osacompile -o "$APP" "$HERE/launcher.applescript"

# Flip the applet to "stay open" so Cmd-Q runs the quit handler (which stops the server).
/usr/libexec/PlistBuddy -c "Add :OSAAppletStayOpen bool true" "$APP/Contents/Info.plist" \
  || /usr/libexec/PlistBuddy -c "Set :OSAAppletStayOpen true" "$APP/Contents/Info.plist"

# Give it a friendly Dock/menu name.
/usr/libexec/PlistBuddy -c "Set :CFBundleName Dashcam Editor" "$APP/Contents/Info.plist"

# Re-sign ad hoc after editing the bundle so macOS is happy to launch it.
codesign --force --deep -s - "$APP" >/dev/null 2>&1 || true

echo "Done. Double-click \"Dashcam Editor.app\" or drag it to your Dock / Applications."
