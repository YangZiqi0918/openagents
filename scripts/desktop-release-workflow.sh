#!/usr/bin/env bash
# 仓库侧可复用交付入口：构建、SCP 分发、目标机只读验收与运行报告。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNS="$ROOT/dist/workflow-runs"
usage() {
  cat <<'USAGE'
用法：./scripts/desktop-release-workflow.sh build|ship|verify|uninstall-check 平台 [参数]
平台：mac-arm64、mac-x64、windows-x64、linux-x64、linux-arm64
参数：--artifact 文件（Windows build/ship 必填） --host user@host（ship/远端检查必填）
      --run-dir 目录（从 build/ship 输出复制，用于持续写入同一次验收记录）
说明：build 仅在匹配平台的构建机运行；ship 仅分发构建产物，安装和卸载在目标平台完成。
USAGE
}
ACTION="${1:-}"
PLATFORM="${2:-}"
[ "$#" -lt 2 ] || shift 2
case "$ACTION" in build|ship|verify|uninstall-check) ;; -h|--help) usage; exit 0 ;; *) usage >&2; exit 2 ;; esac
case "$PLATFORM" in mac-arm64|mac-x64|windows-x64|linux-x64|linux-arm64) ;; *) usage >&2; exit 2 ;; esac
HOST=''
RUN_DIR=''
ARTIFACT=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --host) [ "$#" -ge 2 ] || exit 2; HOST="$2"; shift 2 ;;
    --run-dir) [ "$#" -ge 2 ] || exit 2; RUN_DIR="$2"; shift 2 ;;
    --artifact) [ "$#" -ge 2 ] || exit 2; ARTIFACT="$2"; shift 2 ;;
    *) usage >&2; exit 2 ;;
  esac
done
for tool in node shasum git; do command -v "$tool" >/dev/null || { echo "缺少 $tool" >&2; exit 1; }; done
version="$(node -p "require('$ROOT/packages/launcher/package.json').version")"
case "$PLATFORM" in
  mac-arm64|mac-x64) default_artifact="$ROOT/packages/launcher/dist/local-mac/${PLATFORM#mac-}/OpenAgents-Launcher-$version-mac-${PLATFORM#mac-}.dmg" ;;
  linux-arm64) default_artifact="$ROOT/dist/edge-arm64/desktop/OpenAgents-Launcher-$version-linux-arm64.deb" ;;
  linux-x64) default_artifact="$ROOT/packages/launcher/dist/OpenAgents-Launcher-$version-linux-amd64.deb" ;;
  windows-x64) default_artifact='' ;;
esac
if [ "$ACTION" = build ]; then
  case "$PLATFORM" in
    mac-*) "$ROOT/scripts/build-mac.sh" --arch "${PLATFORM#mac-}" ;;
    linux-arm64) "$ROOT/scripts/build-linux-arm64-desktop.sh" ;;
    linux-x64)
      [ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ] || {
        echo 'Linux x64 需要 Linux x86_64 构建机或仓库 CI。' >&2; exit 1;
      }
      (cd "$ROOT/packages/launcher" && npm run typecheck && npm run build:linux) ;;
    windows-x64)
      [[ "$(uname -s)" == MINGW* ]] || { echo 'Windows x64 需要 Windows 构建机或仓库 CI。' >&2; exit 1; }
      (cd "$ROOT/packages/launcher" && npm run typecheck && npm run build:win) ;;
  esac
fi
if [ "$ACTION" = build ] || [ "$ACTION" = ship ]; then
  if [ "$PLATFORM" = windows-x64 ] && [ -z "$ARTIFACT" ]; then
    echo 'Windows 构建含 NSIS、MSI 和便携包，请用 --artifact 指定要交付的 .exe 或 .msi。' >&2; exit 2;
  fi
  ARTIFACT="${ARTIFACT:-$default_artifact}"
  [ -f "$ARTIFACT" ] || { echo "安装包不存在：$ARTIFACT" >&2; exit 1; }
  ARTIFACT="$(cd "$(dirname "$ARTIFACT")" && pwd)/$(basename "$ARTIFACT")"
  case "$PLATFORM:$ARTIFACT" in
    windows-x64:*.exe|windows-x64:*.msi|mac-arm64:*.dmg|mac-x64:*.dmg|linux-arm64:*.deb|linux-x64:*.deb) ;;
    *) echo '安装包格式与平台不匹配。' >&2; exit 2 ;;
  esac
  RUN_DIR="${RUN_DIR:-$RUNS/$(date +%Y%m%d-%H%M%S)-$PLATFORM}"
  if [ "$ACTION" = ship ]; then
    [ -n "$HOST" ] || { echo 'ship 必须提供 --host user@host。' >&2; exit 2; }
    [[ "$HOST" =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9._:-]+$ ]] || { echo '主机参数格式错误。' >&2; exit 2; }
  fi
  if [ "$ACTION" = ship ] && [ ! -f "$RUN_DIR/report.md" ]; then
    echo 'ship 需要 --run-dir 指向已有 build 的 report.md；先执行 build。' >&2; exit 2
  fi
  mkdir -p "$RUN_DIR"
  hash="$(shasum -a 256 "$ARTIFACT" | awk '{print $1}')"
  if [ -f "$RUN_DIR/report.md" ]; then
    recorded="$(sed -n 's/^- SHA256：//p' "$RUN_DIR/report.md" | head -1)"
    [ "$recorded" = "$hash" ] || { echo '既有记录属于不同产物，请创建新的 --run-dir。' >&2; exit 1; }
  fi
  printf '%s  %s\n' "$hash" "$(basename "$ARTIFACT")" > "$RUN_DIR/artifact.sha256"
  if [ ! -f "$RUN_DIR/report.md" ]; then
    {
      echo "# $PLATFORM 构建—安装—GUI—卸载验收记录"
      echo
      echo "- 创建时间：$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      echo "- 源码提交：$(git -C "$ROOT" rev-parse HEAD)"
      echo "- 工作区修改：见 source-status.txt"
      echo "- 产物：$(basename "$ARTIFACT")"
      echo "- SHA256：$hash"
      echo "- 目标设备：${HOST:-待填写}"
      echo "- 构建结果：已生成产物；详见构建日志"
      echo "- SCP 与接收端 SHA256：待验证"
      echo "- 系统安装与版本：待验证"
      echo "- GUI 截图/录屏及测试步骤：待验证"
      echo "- 系统卸载与残留检查：待验证"
      echo "- 用户数据保留/清理边界：待验证"
    } > "$RUN_DIR/report.md"
    git -C "$ROOT" status --short > "$RUN_DIR/source-status.txt"
  fi
  if [ "$ACTION" = build ]; then echo "构建记录：$RUN_DIR/report.md"; exit 0; fi
  command -v ssh >/dev/null && command -v scp >/dev/null || { echo '缺少 ssh 或 scp。' >&2; exit 1; }
  remote_rel="Downloads/openagents-workflow/$PLATFORM/$version"
  ssh "$HOST" "mkdir -p \"\$HOME/$remote_rel\""
  files=("$ARTIFACT")
  if [ "$PLATFORM" = linux-arm64 ]; then
    for extra in "$ARTIFACT.sha256" "$(dirname "$ARTIFACT")/SHA256SUMS" "$(dirname "$ARTIFACT")/install-linux-arm64-deb.sh"; do
      [ -f "$extra" ] || { echo "缺少随包文件：$extra" >&2; exit 1; }
      files+=("$extra")
    done
  fi
  scp "${files[@]}" "$HOST:~/$remote_rel/"
  case "$PLATFORM" in
    linux-*)
      remote_hash="$(ssh "$HOST" "sha256sum \"\$HOME/$remote_rel/$(basename "$ARTIFACT")\"" | awk '{print $1}')"
      [ "$remote_hash" = "$hash" ] || { echo '目标机 SHA256 不一致。' >&2; exit 1; }
      if [ "$PLATFORM" = linux-arm64 ]; then
        ssh "$HOST" "cd \"\$HOME/$remote_rel\" && sha256sum -c SHA256SUMS && dpkg-deb -f '$(basename "$ARTIFACT")' Architecture"
      fi ;;
    mac-*)
      remote_hash="$(ssh "$HOST" "shasum -a 256 \"\$HOME/$remote_rel/$(basename "$ARTIFACT")\"" | awk '{print $1}')"
      [ "$remote_hash" = "$hash" ] || { echo '目标机 SHA256 不一致。' >&2; exit 1; } ;;
    windows-x64)
      echo 'Windows SSH/PowerShell 接收端哈希请在目标机执行 Get-FileHash 并写入运行记录。' ;;
  esac
  printf '\n- SCP 时间：%s\n- SCP 目标：%s:%s\n- 接收端 SHA256：%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$HOST" "~/$remote_rel" "${remote_hash:-待用平台命令核验}" >> "$RUN_DIR/report.md"
  echo "分发记录：$RUN_DIR/report.md"
  exit 0
fi
[ -n "$RUN_DIR" ] && [ -f "$RUN_DIR/report.md" ] || { echo '需要 --run-dir 指向已有运行记录。' >&2; exit 2; }
if [ "$ACTION" = verify ]; then
  [ -n "$HOST" ] || { echo 'verify 需要 --host；GUI 验收结果须另行记录。' >&2; exit 2; }
  if [ "$PLATFORM" = linux-arm64 ] || [ "$PLATFORM" = linux-x64 ]; then
    ssh "$HOST" 'dpkg-query -W -f='"'"'${Status} ${Version} ${Architecture}\n'"'"' openagents-launcher; pgrep -a -u "$(id -u)" -f "^/opt/OpenAgents Launcher/openagents-launcher( |$)" || true' | tee "$RUN_DIR/install-state.txt"
  else
    echo '请在目标平台 GUI 中检查安装包版本、窗口、登录及核心功能，并将截图/录屏与结果写入 report.md。'
  fi
  exit 0
fi
if [ "$ACTION" = uninstall-check ]; then
  [ -n "$HOST" ] || { echo 'uninstall-check 需要 --host。' >&2; exit 2; }
  if [ "$PLATFORM" = linux-arm64 ] || [ "$PLATFORM" = linux-x64 ]; then
    ssh "$HOST" 'status="$(dpkg-query -W -f='"'"'${Status}'"'"' openagents-launcher 2>/dev/null || true)"; printf "包状态: %s\n" "${status:-absent}"; failed=0; [ "$status" != "install ok installed" ] || failed=1; for path in "/opt/OpenAgents Launcher" /usr/share/applications/openagents-launcher.desktop /usr/bin/openagents-launcher; do if [ -e "$path" ] || [ -L "$path" ]; then printf "残留: %s\n" "$path"; failed=1; else printf "已移除: %s\n" "$path"; fi; done; if pgrep -a -u "$(id -u)" -f "^/opt/OpenAgents Launcher/openagents-launcher( |$)"; then failed=1; else echo "运行进程: 无"; fi; exit "$failed"' | tee "$RUN_DIR/uninstall-state.txt"
  else
    echo '请在目标平台核查系统卸载记录、安装路径、进程和用户数据边界，并填入 report.md。'
  fi
fi
