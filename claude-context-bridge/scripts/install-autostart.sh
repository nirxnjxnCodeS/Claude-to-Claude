#!/usr/bin/env bash
# install-autostart.sh
# Installs claude-context-bridge as a macOS login item via launchd.
# Run once after `npm run build`. Re-run after moving the project.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DIST_ENTRY="$PROJECT_DIR/dist/index.js"
NODE_BIN="$(command -v node 2>/dev/null || true)"
PLIST_LABEL="com.claude-context-bridge"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"
LOG_DIR="$HOME/Library/Logs"

# ── Preflight checks ──────────────────────────────────────────────────────────

if [[ -z "$NODE_BIN" ]]; then
  echo "ERROR: node not found on PATH. Install Node.js 18+ and try again." >&2
  exit 1
fi

if [[ ! -f "$DIST_ENTRY" ]]; then
  echo "ERROR: $DIST_ENTRY not found. Run 'npm run build' first." >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

# ── Write plist ───────────────────────────────────────────────────────────────

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${DIST_ENTRY}</string>
    <string>--auto</string>
    <string>--no-stdio</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${PROJECT_DIR}</string>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>${LOG_DIR}/claude-context-bridge.out.log</string>

  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/claude-context-bridge.err.log</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key>
    <string>${HOME}</string>
  </dict>
</dict>
</plist>
PLIST

# ── Load into launchd ─────────────────────────────────────────────────────────

# Unload cleanly if already registered (ignore errors if not loaded)
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

# ── Confirm ───────────────────────────────────────────────────────────────────

echo ""
echo "  Installed: $PLIST_LABEL"
echo "  Plist:     $PLIST_PATH"
echo "  Entry:     $NODE_BIN $DIST_ENTRY --auto --no-stdio"
echo "  Logs:      $LOG_DIR/claude-context-bridge.{out,err}.log"
echo ""
echo "  The bridge will start automatically on every login."
echo "  SSE endpoint: http://localhost:3451/sse"
echo ""
echo "  To stop:    launchctl unload $PLIST_PATH"
echo "  To restart: launchctl unload $PLIST_PATH && launchctl load $PLIST_PATH"
echo "  To view log: tail -f $LOG_DIR/claude-context-bridge.err.log"
