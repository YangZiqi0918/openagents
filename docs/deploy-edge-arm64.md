# OpenAgents Launcher：Ubuntu arm64 安装、验收与卸载

适用范围：Ubuntu 24.04 arm64（`uname -m` 为 `aarch64`）的图形桌面客户端。构建机从本仓库源码生成固定版本 `.deb`；目标机只接收成品包及校验文件，**无需克隆仓库、安装 Node/npm 或运行仓库内脚本**。以下步骤以 `1.0.3` 和示例设备 `ubuntu@192.168.3.169` 为例；发布其他版本时，以实际包名和 `dpkg-deb` 查询结果为准。

## 1. 构建机：从源码生成安装包

在本仓库根目录执行。首次构建前根据锁文件安装构建依赖：

```bash
cd /Users/yangziqi/code/haileeClaw/openagents
npm --prefix workspace/frontend ci
npm --prefix packages/launcher ci
./scripts/build-linux-arm64-desktop.sh
```

脚本执行 Launcher TypeScript 检查、内置 Workspace 前端及 Electron 构建，并调用 `electron-builder --linux deb --arm64`。**构建脚本只在构建机运行。**输出目录为 `dist/edge-arm64/desktop/`，交付文件包括：

| 文件 | 用途 |
| --- | --- |
| `OpenAgents-Launcher-<版本>-linux-arm64.deb` | Ubuntu arm64 安装包，内含 Electron 和 Workspace UI |
| 同名 `.deb.sha256` | `.deb` 的 SHA256，使用相对文件名 |
| `SHA256SUMS` | 同时校验 `.deb` 与可选的随包脚本 |
| `install-linux-arm64-deb.sh` | 可选安装/卸载入口；以下主流程不需要它 |

确认实际包名、版本、架构和摘要，再发送到目标机：

```bash
cd dist/edge-arm64/desktop
sha256sum -c SHA256SUMS
# 若构建机有 dpkg-deb：
dpkg-deb -f OpenAgents-Launcher-1.0.3-linux-arm64.deb Package Version Architecture Depends
```

macOS 构建机通常没有 `dpkg-deb`；构建脚本会检查包控制文件中的 `Architecture: arm64` 及 Electron ELF 的 AArch64 架构。构建机依赖 Node/npm 和打包工具；它们不是目标设备运行桌面客户端的前置条件。本地构建产物未完成正式发行签名，不应当作正式签名包发布。SHA256 能发现传输内容变化，但正式分发时应从可信渠道核对摘要或签名。

## 2. SCP 模拟从制品服务器下载

在构建机将成品复制到设备的**独立版本目录**，避免与设备原有包混淆：

```bash
ssh ubuntu@192.168.3.169 'mkdir -p ~/Downloads/openagents-workflow/linux-arm64/1.0.3'
scp dist/edge-arm64/desktop/OpenAgents-Launcher-1.0.3-linux-arm64.deb \
    dist/edge-arm64/desktop/OpenAgents-Launcher-1.0.3-linux-arm64.deb.sha256 \
    dist/edge-arm64/desktop/SHA256SUMS \
    dist/edge-arm64/desktop/install-linux-arm64-deb.sh \
    ubuntu@192.168.3.169:~/Downloads/openagents-workflow/linux-arm64/1.0.3/
```

目标机不需要安装脚本时，可以只发送 `.deb` 和对应 `.deb.sha256`，然后按下一节校验。不要将 SSH 密码、工作区配对码或模型密钥写入命令记录和文档。

## 3. 目标机：校验、安装系统依赖及 `.deb`

登录设备并使用目标桌面账户执行。**不要在安装前清除已有 `~/.openagents` 或账户配置**；升级已有客户端时，先记录当前工作区/节点状态及包版本。

```bash
ssh ubuntu@192.168.3.169
uname -m  # 应为 aarch64
cd ~/Downloads/openagents-workflow/linux-arm64/1.0.3
sha256sum -c SHA256SUMS
# 没有随包脚本时至少运行：
sha256sum -c OpenAgents-Launcher-1.0.3-linux-arm64.deb.sha256
dpkg-deb -f ./OpenAgents-Launcher-1.0.3-linux-arm64.deb Package Version Architecture Depends
```

`Package` 应为 `openagents-launcher`，`Architecture` 应为 `arm64`。使用 APT 一次安装本地包和它声明的系统依赖（需要 sudo 权限及可用的系统软件源）：

```bash
sudo apt-get install ./OpenAgents-Launcher-1.0.3-linux-arm64.deb
dpkg-query -W -f='${Status} ${Version} ${Architecture}\n' openagents-launcher
```

成功时状态为 `install ok installed 1.0.3 arm64`。APT 自动处理 `.deb` 的 `Depends`；不要把某版本的依赖清单硬编码进通用流程。若必须使用 `dpkg`，可执行 `sudo dpkg --install ./OpenAgents-Launcher-1.0.3-linux-arm64.deb`；**dpkg 不负责下载缺失依赖**，依赖未满足时由 APT 解决后重新核对 `dpkg-query`，不可把 `dpkg` 报错当作安装成功。

安装目录是 `/opt/OpenAgents Launcher`，系统桌面入口为 `/usr/share/applications/openagents-launcher.desktop`。Launcher 自带 Electron；首次安装 Agent Runtime 可能需要另外下载运行时，因此业务配置阶段仍需可用网络或经批准的镜像源。图形桌面的 D-Bus、Wayland/X11 变量由登录会话提供，不要把 SSH 会话中的临时 socket 配置到系统环境。

## 4. 图形界面与业务验证

在设备的**真实 Ubuntu 图形登录会话**，从应用菜单启动 **OpenAgents Launcher**。记录窗口截图/录屏、测试时间及实际结果，依次确认窗口渲染、账户登录、正确的工作区、设备节点配对、Agent 安装/创建、连接及至少一次真实任务。系统安装成功和 Electron 进程存在，只证明安装或启动；不能代替上述 GUI 和业务验证。工作区配对码、账户密码及模型密钥不应出现在截图或运行报告中。

如果需要从 SSH 触发启动，应保证命令运行在已登录的图形会话环境中；在普通 SSH shell 直接执行 `openagents-launcher` 可能缺少 `DISPLAY`。GUI 截图/操作仍须通过设备本地桌面或可用的远程桌面完成。当前这台 Edge 的 GNOME Wayland 会话拒绝 SSH 发起的截图，因此其 GUI 内容与业务功能**尚未通过验收**。

## 5. 系统卸载与残留检查

完成 GUI 测试后，退出 Launcher，在设备上用 Ubuntu 系统命令卸载：

```bash
sudo dpkg --remove openagents-launcher
# 等价的包管理器路径：sudo apt-get remove openagents-launcher
dpkg-query -W -f='${Status}\n' openagents-launcher 2>/dev/null || true
ls -ld '/opt/OpenAgents Launcher' /usr/share/applications/openagents-launcher.desktop /usr/bin/openagents-launcher 2>/dev/null || true
pgrep -a -u "$(id -u)" -f '^/opt/OpenAgents Launcher/openagents-launcher( |$)' || true
```

合格条件：不再是 `install ok installed`；`/opt/OpenAgents Launcher`、桌面入口、命令入口都已消失；该用户没有 Launcher 进程。`dpkg-query` 可能显示 `deinstall ok config-files`，表示已移除程序但仍可能有包级配置记录；仅在确认要清除**该包级配置**时使用 `sudo dpkg --purge openagents-launcher`，并重新检查。普通卸载不会删除用户数据 `~/.openagents`、`~/.config/OpenAgents Launcher`、Agent Runtime 或独立 Connector；这些与系统安装包分开管理，不能为了“无残留”而未经备份直接删除。

若卸载只是安装验收的一环，而设备最终仍需运行客户端，可以保留卸载现场检查证据，随后按第 3 节从同一份已校验的 `.deb` 重装，并在报告中分别记录**卸载时无系统安装残留**与**最终已安装状态**。后续升级按固定新版本重新构建、复制、校验并运行 `sudo apt-get install ./<新包>.deb`。

## 6. 本次实测状态与记录

2026-09-24，构建机已生成 `OpenAgents-Launcher-1.0.3-linux-arm64.deb`，SHA256 为 `df1287e46ce873cf55cb8cf1e7cbfbeefaf6bc69c370e4d6b85a88968e85c61d`。Edge 接收端校验通过；实际执行过 `dpkg --remove`，移除后上述系统安装目录和入口消失、节点数据保留；随后从 SCP 接收目录重新安装并在图形登录会话启动。当前设备最终状态为 `install ok installed 1.0.3 arm64`，Launcher 主进程运行。由于尚无可见 GUI 操作，账户、工作区和任务功能不能标为通过。

完整的逐次证据见 [Ubuntu arm64 运行报告](workflow-runs/2026-09-23-linux-arm64/report.md)。每个版本都应按[标准构建—分发—GUI—卸载工作流](desktop-release-standard-workflow.md)建立自己的运行记录。macOS、Windows 和 Linux x64 的包形式与入口见[平台部署总览](desktop-platform-deployment.md)。独立常驻 Connector 属于另一交付单元，不随此桌面 `.deb` 安装或卸载。
