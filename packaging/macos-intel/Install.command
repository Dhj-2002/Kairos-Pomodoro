#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR/source"
SNAPSHOT_DB="$SCRIPT_DIR/data/Kairos-Pomodoro.db"
APP_ID="com.kairos.pomodoro.app"
APP_SUPPORT="$HOME/Library/Application Support/$APP_ID"
INSTALL_DIR="$HOME/Applications"
STAMP="$(date +%Y%m%d-%H%M%S)"

fail() {
  printf '\n安装未完成：%s\n' "$1" >&2
  printf '按回车关闭窗口。\n'
  read -r _
  exit 1
}

[ "$(uname -s)" = "Darwin" ] || fail "此安装器只能在 macOS 运行。"
[ "$(uname -m)" = "x86_64" ] || fail "此包专用于 Intel Mac（x86_64），当前机器不是 Intel 架构。"
[ -d "$SOURCE_DIR" ] || fail "安装包不完整：缺少 source 目录。"
[ -f "$SNAPSHOT_DB" ] || fail "安装包不完整：缺少历史数据库。"

if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install || true
  fail "已请求安装 Xcode Command Line Tools。安装完成后请再次运行 Install.command。"
fi

if ! command -v bun >/dev/null 2>&1; then
  printf '正在安装 Bun 构建工具……\n'
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

if ! command -v cargo >/dev/null 2>&1; then
  printf '正在安装 Rust 构建工具……\n'
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi

command -v rustup >/dev/null 2>&1 || fail "找不到 rustup。请重新安装 Rust 后再试。"
rustup target add x86_64-apple-darwin

printf '\n正在构建 Kairos Intel macOS 应用，这一步通常需要数分钟……\n'
cd "$SOURCE_DIR"
bun install --frozen-lockfile
bun run tauri build \
  --target x86_64-apple-darwin \
  --bundles app \
  --config "$SOURCE_DIR/src-tauri/tauri.macos.local.conf.json"

BUILT_APP="$(find "$SOURCE_DIR/src-tauri/target/x86_64-apple-darwin/release/bundle/macos" -maxdepth 1 -name '*.app' -type d -print -quit)"
[ -n "$BUILT_APP" ] || fail "构建结束，但没有找到生成的 .app。"

mkdir -p "$INSTALL_DIR" "$APP_SUPPORT"

if [ -d "$INSTALL_DIR/Kairos-Pomodoro.app" ]; then
  mv "$INSTALL_DIR/Kairos-Pomodoro.app" "$INSTALL_DIR/Kairos-Pomodoro.before-$STAMP.app"
fi

# Close a previous Kairos instance before replacing its database. Failure is
# harmless when this is the first installation.
osascript -e 'tell application "Kairos-Pomodoro" to quit' >/dev/null 2>&1 || true
sleep 1

DATA_BACKUP="$APP_SUPPORT/before-migration-$STAMP"
mkdir -p "$DATA_BACKUP"
for file in Kairos-Pomodoro.db Kairos-Pomodoro.db-wal Kairos-Pomodoro.db-shm; do
  if [ -e "$APP_SUPPORT/$file" ]; then
    mv "$APP_SUPPORT/$file" "$DATA_BACKUP/$file"
  fi
done

ditto "$BUILT_APP" "$INSTALL_DIR/Kairos-Pomodoro.app"
ditto "$SNAPSHOT_DB" "$APP_SUPPORT/Kairos-Pomodoro.db"
xattr -dr com.apple.quarantine "$INSTALL_DIR/Kairos-Pomodoro.app" 2>/dev/null || true

printf '\n安装完成。应用：%s\n' "$INSTALL_DIR/Kairos-Pomodoro.app"
printf '历史数据：%s\n' "$APP_SUPPORT/Kairos-Pomodoro.db"
printf '若原来已有 Mac 数据，备份位于：%s\n' "$DATA_BACKUP"
open "$INSTALL_DIR/Kairos-Pomodoro.app"

