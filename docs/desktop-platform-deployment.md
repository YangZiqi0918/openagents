# OpenAgents 桌面客户端：各平台构建与产物部署

统一原则：**仓库负责从源码构建目标平台的安装包；目标机器只接收安装包、校验文件及随包安装入口（如有），并使用自身的安装机制完成安装、升级和卸载。**目标机器无需克隆仓库、安装前端构建工具或运行仓库内的 SSH 部署脚本。安装包与运行时 Agent/工作区配对是不同阶段。

| 平台 | 仓库中的构建入口 | 面向用户的安装产物 | 目标平台安装与卸载 |
| --- | --- | --- | --- |
| macOS arm64/x64 | `./scripts/build-mac.sh --arch arm64` 或 `--arch x64`（在 macOS 构建） | `packages/launcher/dist/local-mac/<架构>/` 的 DMG 和 ZIP，附 `SHA256SUMS` | 打开 DMG，将应用拖入“应用程序”；卸载时退出并从“应用程序”移除 |
| Windows x64 | 仓库 CI `.github/workflows/desktop-build.yml` 中 `npm run build:win`（在 Windows runner 构建） | `packages/launcher/dist/` 的 NSIS `.exe` 和 MSI `.msi`；便携 `.exe` 不按系统安装包处理 | 运行 `.exe`/`.msi` 安装；在“已安装的应用”中卸载，或用 MSI 系统卸载入口 |
| Linux x64 | 仓库 `packages/launcher` 中 `npm run build:linux`（Linux runner） | `packages/launcher/dist/` 的 `.deb` 和 AppImage | Debian/Ubuntu 用 APT 安装 `.deb`、`dpkg --remove openagents-launcher` 卸载；AppImage 是免安装运行文件 |
| Ubuntu arm64 | `./scripts/build-linux-arm64-desktop.sh`（可在已验证的 macOS 构建机交叉打包） | `dist/edge-arm64/desktop/` 的 `.deb`、`.deb.sha256`、`SHA256SUMS` 和随包安装脚本 | 将四件文件复制到设备，用随包脚本安装/卸载，或使用 `apt-get`/`dpkg`；见 [Ubuntu arm64 手册](deploy-edge-arm64.md) |

上述表格列的是**仓库现有构建入口与制品形式**。本地已实测 macOS arm64 和 Ubuntu arm64 构建；Windows 与 Linux x64 的命令来自仓库配置和 CI，当前手册未声称在本机完成这些平台的打包及目标设备验收。Windows 正式签名依赖 CI 的独立签名步骤；本地未签名测试包不得标作正式签名包。macOS 本地构建使用 ad-hoc 签名，未公证，首次打开可能受系统安全策略限制。

## 构建机操作

在与目标平台匹配的构建环境使用上述仓库入口。先核对源码版本、锁文件和构建机依赖，构建后核对安装包名称、架构、版本及 SHA256。发布时交付**固定版本**的产物和校验文件，不以 `latest` 的文件名代替版本证据。构建时的 Node.js、npm、Electron Builder 等属于构建机，不应要求普通目标设备安装它们来运行桌面客户端。各平台签名、公证、证书和发布权限按仓库 CI 处理。

## 目标平台操作

先验证收到的包和系统架构，再使用对应系统安装机制：macOS DMG、Windows 安装程序、Ubuntu `.deb`。安装过程中系统依赖由目标平台包管理器或安装器处理；桌面会话变量从用户登录继承。打开 Launcher 后再完成账户登录、工作区选择、节点配对和 Agent Runtime/模型配置。检查包管理器记录与窗口启动属于安装验收；“节点在线”和“能执行任务”需要各自额外验证。

卸载优先走该平台的安装管理入口，并默认保留用户数据。桌面安装包不自动卸载独立 Connector、Agent Runtime 或删除 `~/.openagents` 等用户配置。需要彻底重置时必须另行列出数据清理范围，不能把其混入普通卸载命令。

持续执行的构建、SCP 分发、GUI 验收与卸载证据规则见 [标准工作流](desktop-release-standard-workflow.md)。
