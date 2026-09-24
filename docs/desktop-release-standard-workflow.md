# 桌面客户端标准持续交付与卸载验收工作流

本工作流适用于每一次 OpenAgents Launcher 版本交付。**构建机使用本仓库源码；目标机仅接收已经构建的包、校验文件和随包安装入口；每一阶段留下可复核的记录。**SCP 在验收中模拟“从分发服务器下载”：构建机相当于制品服务器，目标机通过 SSH/SCP 接收字节相同的版本包。正式分发改为 HTTP/制品库时仍要求目标端复核版本和 SHA256。

## 平台与执行边界

| 平台 | 构建机与入口 | 目标机安装 | 目标机卸载 |
| --- | --- | --- | --- |
| macOS arm64/x64 | macOS：`./scripts/desktop-release-workflow.sh build mac-arm64` 或 `mac-x64` | 验证 DMG 的 SHA256，挂载 DMG，将 `OpenAgents Launcher.app` 拷贝到 `/Applications`；从该路径启动 | 退出应用，移除 `/Applications/OpenAgents Launcher.app`，弹出 DMG |
| Windows x64 | Windows runner：仓库 CI 或 `npm run build:win`；分发时明确选择 NSIS `.exe` 或 MSI `.msi` | 验证 SHA256；运行所选安装器并通过 Windows“已安装的应用”核对 | Windows“已安装的应用”卸载；MSI 可使用记录的产品码执行 `msiexec /x` |
| Ubuntu/Linux x64 | Linux x86_64：`npm run build:linux`（`.deb` 为本流程安装包；AppImage 单独验收） | 核对架构和 SHA256，`sudo apt-get install ./<包>.deb` | `sudo dpkg --remove openagents-launcher` |
| Ubuntu arm64 | 本仓库：`./scripts/desktop-release-workflow.sh build linux-arm64` | 接收 `.deb`、`.sha256`、`SHA256SUMS`、随包脚本；校验后 `bash install-linux-arm64-deb.sh install` | `bash install-linux-arm64-deb.sh uninstall --yes` 或 `sudo dpkg --remove openagents-launcher` |

运行入口在仓库侧，目标机不必持有仓库。Windows 的 SCP 接收端通常是 Windows OpenSSH 的 PowerShell 环境：`ship windows-x64` 负责传输，接收端需执行 `Get-FileHash <安装包> -Algorithm SHA256` 并将摘要填入报告；具体 SSH shell/路径要在目标机验证。Windows 正式签名与 macOS 正式公证分别取决于 CI 的签名配置；本地测试包不可冒充正式签名包。没有对应平台构建机或可见 GUI 时，该平台只能停在“待验收”，不能填写“通过”。Ubuntu arm64 上已有真实账户与节点身份时，先记录当前会话，再做破坏性包生命周期测试；不可把当前运行的进程误归因为本轮交付。

## 一次验收的顺序

1. **冻结输入与构建。**记录 Git 提交、未提交改动（必要时导出补丁）、Node/构建机平台、Launcher 版本及构建日志；类型检查和打包失败立即停止。只以实际生成且已检查架构的固定版本包进入下一步。Ubuntu arm64 示例：

   ```bash
   cd /Users/yangziqi/code/haileeClaw/openagents
   ./scripts/desktop-release-workflow.sh build linux-arm64
   ```

   输出 `dist/workflow-runs/<时间>-<平台>/report.md`，后续用同一 `--run-dir` 续记。构建完成的 arm64 安装单元包含 `.deb`、同名 `.sha256`、`SHA256SUMS` 和 `install-linux-arm64-deb.sh`。记录文件本身属于验收归档，不随安装包分发。

2. **模拟制品下载。**通过 SCP 将**同一构建产物**发到目标机的独立版本目录，避免被旧包或 `latest` 别名混淆；接收端再次核对 SHA256、包名与架构。

   ```bash
   ./scripts/desktop-release-workflow.sh ship linux-arm64 \
     --host ubuntu@192.168.3.169 \
     --run-dir dist/workflow-runs/<时间>-linux-arm64
   ```

   实际生产分发若使用服务器，应记录服务器 URL、服务器文件摘要和目标设备重新下载的摘要。不要在仓库或报告中记载 SSH 密码、配对码或模型密钥。

3. **在目标机安装。**以图形登录账户执行安装，优先使用系统包管理器；Ubuntu arm64：

   ```bash
   cd ~/Downloads/openagents-workflow/linux-arm64/<版本>
   sha256sum -c SHA256SUMS
   bash ./install-linux-arm64-deb.sh install
   bash ./install-linux-arm64-deb.sh status
   ```

   APT 读取 `.deb` 的依赖并安装；Launcher 自带 Electron。图形桌面会话提供 D-Bus、Wayland/X11 环境变量，不要把某次 SSH 的临时 socket 写入系统环境。记录安装命令及退出码、`dpkg-query` 输出、版本、桌面入口和首次启动日志。

4. **GUI 功能验收。**在目标机的真实图形会话通过可见 GUI 操作，截图/录屏或 GUI 工具观察确认：应用启动与窗口渲染、账户登录、目标工作区选择、节点配对、Agent 安装/创建、连接与至少一次实际任务。若缺少工作区配对码、模型凭据或可见 GUI 控制权限，对该步骤标记“受外部条件阻塞”，不能以进程存在或安装成功替代功能通过。保留截图路径、操作时间、操作账户（不要存凭据）、期望与实际结果。仓库侧只读检查入口：

   ```bash
   ./scripts/desktop-release-workflow.sh verify linux-arm64 \
     --host ubuntu@192.168.3.169 \
     --run-dir dist/workflow-runs/<时间>-linux-arm64
   ```

   `verify` 只采集包状态与进程；GUI 操作结果必须单独写入同一报告。`uninstall-check` 在包、安装入口或进程仍存在时返回非零；若为了保持目标机可用而再安装，需把该次卸载通过的证据与最终安装状态分别记录。连接工作区、Agent 执行属于业务验收，不能仅靠包管理器验证。

5. **系统卸载并核对边界。**结束 GUI 测试后，在目标机执行该平台的系统卸载命令；Ubuntu arm64：

   ```bash
   cd ~/Downloads/openagents-workflow/linux-arm64/<版本>
   bash ./install-linux-arm64-deb.sh uninstall --yes
   ```

   随后核对包管理器不再显示 `install ok installed`、桌面入口和程序安装目录消失、该用户无 Launcher 进程。记录卸载命令退出码与这些实际输出：

   ```bash
   ./scripts/desktop-release-workflow.sh uninstall-check linux-arm64 \
     --host ubuntu@192.168.3.169 \
     --run-dir dist/workflow-runs/<时间>-linux-arm64
   ```

   “自身不留残留”在标准卸载中指**应用安装包拥有的文件、桌面入口、进程与自启动项**。`~/.openagents`、账户配置、Agent Runtime、Connector 等用户或其他安装单元的数据应单独列出并保留，不应默默删除。若目标是恢复出厂，先对这些数据做备份/范围清单并作为独立流程验收；系统包卸载通常不会删除用户主目录文件。

6. **封存运行记录。**将 `report.md` 从“待验证”逐项改为通过、失败或受阻，并附构建日志、双端 SHA256、包管理器状态、GUI 截图/录屏路径及卸载检查输出。失败或受阻保留真实状态，修复后重新构建固定版本包并生成**新的运行记录**；不可把旧包的 GUI 测试结果挪给新包。

## 当前执行证据与限制

截至 2026-09-24，本机已构建并校验 Ubuntu arm64 `OpenAgents-Launcher-1.0.3-linux-arm64.deb`，随包脚本和 `SHA256SUMS` 在脱离仓库的临时目录校验通过。本轮工作流已在 Edge 完成 SCP 和接收端校验；首次非交互 SSH 密码认证失败，配置公钥后已免密通过。目标设备当前安装了 1.0.3 且处于图形会话，但 GNOME 拒绝通过 SSH 截图，因此未完成可见 GUI 操作；2026-09-24 已在该设备上实测卸载并从 SCP 接收目录重装，卸载时安装目录与系统入口消失、节点数据保留，重装后 `dpkg` 状态为 `install ok installed 1.0.3 arm64`，从图形会话启动后 Electron 主进程和 renderer 存在。GUI 窗口内容及业务功能仍未获得可见操作证据。Windows 和 Linux x64 的构建与目标 GUI 验收也需要对应机器/CI；报告中必须保持“待验证”，不得将设计步骤视为完成记录。

本轮真实试运行记录存放于 [2026-09-23 Ubuntu arm64 报告](workflow-runs/2026-09-23-linux-arm64/report.md)，归档文件位于仓库 `docs/workflow-runs/`；`dist/workflow-runs/` 是运行时暂存目录，默认为 Git 忽略，正式归档前需复制报告与证据并删除敏感信息。

详见 [平台构建总览](desktop-platform-deployment.md) 和 [Ubuntu arm64 安装手册](deploy-edge-arm64.md)。
