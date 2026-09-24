# Ubuntu arm64 客户端标准工作流试运行（2026-09-23）

- 构建机：macOS；仓库提交 `1b3e73c9a5516494428a401b40f2a9cac457e3d7`，工作区存在未提交修改，见 `source-status.txt`。
- 包：`OpenAgents-Launcher-1.0.3-linux-arm64.deb`，`Architecture: arm64`，Electron ELF 为 AArch64。
- SHA256：df1287e46ce873cf55cb8cf1e7cbfbeefaf6bc69c370e4d6b85a88968e85c61d
- 本地构建：此前已完成 TypeScript、Workspace 和 Electron 构建，本轮再核对安装包和随包安装脚本的 `SHA256SUMS`；通过。
- SCP 模拟下载：首次因 SSH 认证失败未上传；后续配置本机 Ed25519 公钥后，已免密连接目标 `ubuntu@192.168.3.169`，SCP 四件产物到目标机，远端 `SHA256SUMS` 校验两个文件均 OK，`.deb` 架构为 arm64。
- 目标机安装与版本：只读核查发现此前已安装 `openagents-launcher 1.0.3 arm64`（`install ok installed`），程序、桌面入口、Workspace 资源及进程均存在。本轮尚未执行从新传输包的重新安装，不能归因为本轮新包安装成功。
- GUI 功能：GNOME Wayland 登录会话 active，Launcher 主进程和 renderer 存在，日志显示 Workspace bundle 服务和 API bridge；无法通过 SSH 截图（GNOME Screenshot 返回 AccessDenied），没有可见 GUI 的操作与截图证据。
- 卸载：本轮未执行；没有包管理器、进程、目录残留的远端结果。
- 节点：`agn node status` 显示本地已配对 `My Workspace (5fa5acb9)`，Connector 用户服务当前 inactive；这两种状态不等同于实时在线。
- 结论：SSH 免密和 SCP 接收端校验完成；GUI 可见交互、用新包重新安装及卸载未执行，本轮端到端验收未通过。

## 2026-09-24 续跑前核查

- 本机免密 SSH、目标设备 `aarch64` 与 `sudo -n` 均通过；远端接收目录的 `SHA256SUMS` 对 `.deb` 和随包脚本均为 OK。
- 系统当前已有 `openagents-launcher 1.0.3 arm64`，同名桌面 GUI 进程正在 GNOME Wayland 会话中运行；现有用户身份和节点数据均在。
- `apt-get -s remove openagents-launcher` 仅计划移除该一个包。
- GNOME 的 `org.gnome.Shell.Screenshot.ScreenshotWindow` 拒绝 SSH 发起的截图请求（AccessDenied），本轮没有可见 GUI 测试证据。当前图形会话正在运行客户端；本轮尚未执行安装、卸载，故不能把包生命周期标记为通过。后续需在有可见 GUI 控制的验收窗口完成实际交互，再按流程移除包和检查残留。

## 2026-09-24 验收入口纠错

- `desktop-release-workflow.sh verify/uninstall-check` 的远端 `dpkg-query -f` 字段引用曾被 shell 提前展开，导致空状态；现已修正并实连确认 `install ok installed 1.0.3 arm64`。卸载前检查显示包的安装目录和桌面入口仍在，Launcher 主进程仍运行，符合“尚未卸载”的实际状态。
- 目标机 `gnome-remote-desktop` 服务处于 disabled/inactive；GNOME 截图接口从 SSH 访问仍返回 `AccessDenied`。这些只读检查不能证明窗口 UI 功能。
- 2026-09-24 只读复查仍为 `install ok installed 1.0.3 arm64`，GNOME Wayland 会话 active；本次没有执行卸载操作。GUI 和卸载验收仍为待完成，不得写为通过。

## 2026-09-24 实际包生命周期续跑

- **卸载**：在目标机已经接收的 `~/Downloads/openagents-workflow/linux-arm64/1.0.3/` 目录执行 `bash ./install-linux-arm64-deb.sh uninstall --yes`，退出码 0。`dpkg --remove` 移除 `openagents-launcher (1.0.3)`。卸载后包状态为 `deinstall ok config-files`，`/opt/OpenAgents Launcher`、`/usr/share/applications/openagents-launcher.desktop`、`/usr/bin/openagents-launcher` 均不存在；节点文件 `~/.openagents/node.json` 仍在。`deinstall ok config-files` 不是已安装状态，但提示 dpkg 可能保留包级配置元数据；本次未使用 purge 清理用户目录。
- **从已传输产物重装**：同目录运行 `bash ./install-linux-arm64-deb.sh install`，SHA256 校验 OK；APT 显示仅新增 `openagents-launcher` 一个包，结束时为 `install ok installed 1.0.3 arm64`，安装目录与桌面入口恢复。目标 GNOME Wayland 登录会话仍 active。
- **启动**：通过该用户图形会话的 `gtk-launch openagents-launcher` 启动，主进程与 renderer/GPU 子进程出现；这证明桌面会话内进程启动，不能证明窗口渲染内容、工作区选择、配对和任务执行。尝试仅传入 `WAYLAND_DISPLAY` 的首次启动缺少 X server 环境而退出；通过 `gtk-launch` 的桌面环境启动后主进程保持运行。
- **残留检查入口**：仓库工作流的 `uninstall-check` 已改为检查包、目录、桌面入口、命令入口和本用户进程，有残留即返回非零。在最终重装状态实测返回 1，正确拒绝把已安装设备误判为卸载通过。该步骤的卸载时现场结果如上；最终设备保持已安装。
- **GUI 状态**：SSH 会话调用 GNOME Screenshot 被 `AccessDenied` 拒绝；本机计算机控制工具仅能访问本机 macOS 应用，无法观察该 Ubuntu 设备窗口，因此实际 GUI 功能验收仍受阻。尚无截图、可见窗口操作、登录/工作区及任务执行的证据。
- **结论**：Ubuntu arm64 构建产物、SCP 及双端 SHA256、目标机卸载后的系统文件检查、同一产物重装和图形会话启动均已实测；端到端 GUI 功能和其他平台的目标机验收仍未通过，不能宣称全平台流程完成。
