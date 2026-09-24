#!/usr/bin/env bash
# 随 .deb 一同分发；目标设备无需仓库源码。Ubuntu arm64 一键安装和卸载。
set -euo pipefail

usage() {
  cat <<'USAGE'
用法：bash install-linux-arm64-deb.sh install|uninstall|status [--package 路径] [--sha256 路径] [--yes]
  install   校验安装包，使用 apt 安装 .deb 及其系统依赖。
  uninstall 使用 dpkg 移除桌面客户端，保留用户数据和独立 Connector。
  status    查看包安装状态、架构及登录会话。
USAGE
}

ACTION="${1:-}"
if [ "$#" -gt 0 ]; then shift; fi
case "$ACTION" in install|uninstall|status) ;; -h|--help) usage; exit 0 ;; *) usage >&2; exit 2 ;; esac
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE=''
CHECKSUM=''
YES=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --package) [ "$#" -ge 2 ] || { usage >&2; exit 2; }; PACKAGE="$2"; shift 2 ;;
    --sha256) [ "$#" -ge 2 ] || { usage >&2; exit 2; }; CHECKSUM="$2"; shift 2 ;;
    --yes) YES=1; shift ;;
    *) usage >&2; exit 2 ;;
  esac
done
[ "$(uname -s)" = Linux ] && [ "$(uname -m)" = aarch64 ] || {
  echo '此安装包只适用于 Linux arm64 (aarch64)。' >&2; exit 1;
}
for tool in dpkg-query dpkg-deb; do
  command -v "$tool" >/dev/null || { echo "缺少 $tool" >&2; exit 1; }
done

case "$ACTION" in
  status)
    dpkg-query -W -f='${Status} ${Version} ${Architecture}\n' openagents-launcher 2>/dev/null || {
      echo 'openagents-launcher 未安装。'; exit 0;
    }
    if command -v loginctl >/dev/null; then loginctl list-sessions --no-legend || true; fi
    ;;
  uninstall)
    if dpkg-query -W -f='${Status}' openagents-launcher 2>/dev/null | grep -qx 'install ok installed'; then
      [ "$YES" -eq 1 ] || { echo '卸载会关闭客户端；确认后追加 --yes。' >&2; exit 2; }
      command -v pkill >/dev/null && pkill -u "$(id -u)" -f '^/opt/OpenAgents Launcher/openagents-launcher( |$)' || true
      sudo dpkg --remove openagents-launcher
      if dpkg-query -W -f='${Status}' openagents-launcher 2>/dev/null | grep -qx 'install ok installed'; then
        echo '卸载后包仍处于已安装状态。' >&2; exit 1
      fi
    fi
    echo '客户端已卸载；未清除 ~/.openagents 和桌面用户配置。'
    ;;
  install)
    command -v sha256sum >/dev/null || { echo '缺少 sha256sum' >&2; exit 1; }
    command -v apt-get >/dev/null || { echo '缺少 apt-get' >&2; exit 1; }
    if [ -z "$PACKAGE" ]; then
      shopt -s nullglob
      packages=("$SCRIPT_DIR"/OpenAgents-Launcher-*-linux-arm64.deb)
      [ "${#packages[@]}" -eq 1 ] || { echo '脚本同目录必须有且仅有一个 arm64 .deb，或指定 --package。' >&2; exit 1; }
      PACKAGE="${packages[0]}"
    fi
    [ -f "$PACKAGE" ] || { echo "找不到安装包：$PACKAGE" >&2; exit 1; }
    PACKAGE="$(cd "$(dirname "$PACKAGE")" && pwd)/$(basename "$PACKAGE")"
    CHECKSUM="${CHECKSUM:-$PACKAGE.sha256}"
    [ -f "$CHECKSUM" ] || { echo "缺少校验文件：$CHECKSUM" >&2; exit 1; }
    # 校验文件在制品目录中使用相对文件名，可单独复制整个交付目录。
    expected_name="$(basename "$PACKAGE")"
    checksum_name="$(awk 'NR==1 {print $2}' "$CHECKSUM")"
    [ "$checksum_name" = "$expected_name" ] && [ "$(awk 'END {print NR}' "$CHECKSUM")" -eq 1 ] || {
      echo '校验文件与安装包不匹配。' >&2; exit 1;
    }
    expected_digest="$(awk 'NR==1 {print $1}' "$CHECKSUM")"
    [[ "$expected_digest" =~ ^[0-9a-fA-F]{64}$ ]] || { echo 'SHA256 格式不正确。' >&2; exit 1; }
    actual_digest="$(sha256sum "$PACKAGE" | awk '{print $1}')"
    [ "${actual_digest,,}" = "${expected_digest,,}" ] || { echo '安装包 SHA256 不匹配。' >&2; exit 1; }
    echo "$expected_name: OK"
    [ "$(dpkg-deb -f "$PACKAGE" Package)" = openagents-launcher ] || {
      echo 'Debian 包名不正确。' >&2; exit 1;
    }
    [ "$(dpkg-deb -f "$PACKAGE" Architecture)" = arm64 ] || {
      echo 'Debian 包架构不正确。' >&2; exit 1;
    }
    # apt 读取包自身的 Depends 字段并安装系统库；无需仓库或 Node/npm。
    sudo apt-get install -y "$PACKAGE"
    version="$(dpkg-deb -f "$PACKAGE" Version)"
    status="$(dpkg-query -W -f='${Status}' openagents-launcher)"
    installed="$(dpkg-query -W -f='${Version}' openagents-launcher)"
    [ "$status" = 'install ok installed' ] && [ "$installed" = "$version" ] || {
      echo "安装状态异常：$status $installed（预期 $version）" >&2; exit 1;
    }
    dpkg-query -W -f='${Status} ${Version} ${Architecture}\n' openagents-launcher
    echo '请从当前用户的 Ubuntu 图形桌面应用菜单打开 OpenAgents Launcher。'
    ;;
esac
