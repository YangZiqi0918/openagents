# OpenAgents Feature List

## 1. 范围与口径

- 整理日期：2026-09-17。
- 代码基线：`4724352bd`，以本地仓库实现为准，不代表线上环境或已发布安装包的实际状态。
- 覆盖范围：Web Workspace、桌面 Launcher、Node.js Agent Connector、Python SDK、SDK Studio、内置 Mods、Agent 与模型服务接入、部署与开发支持。
- 粒度：按可独立理解的用户能力或开发者能力列项；通用 UI 组件、数据库迁移和测试用例不逐个算作产品功能。
- 同一能力的 Web、桌面、CLI 入口尽量合并描述；不同产品中的同名功能保留差异。
- 本清单基于 README、页面、路由、服务、适配器和配置的静态核对，未运行全量测试，也未使用真实账号、模型密钥或第三方服务验证。

| 状态 | 含义 |
| --- | --- |
| 已实现 | 有对应源码或页面/API 实现；不等于本次已完成运行验收 |
| 依赖配置 | 有实现，但需要账号服务、密钥、外部平台、浏览器服务或部署开关 |
| Beta / Preview | 仓库明确标注的试用或预览能力 |
| 部分实现 | 有基础实现或适配，但不能视为完整能力 |
| 规划项 | 明确标为 planned、尚未实现或仅有未来依赖配置 |

## 2. 产品总览

清单共 28 个编号分组、348 个条目：259 项标为已实现，86 项依赖配置，2 项部分实现，1 项规划项。Beta / Preview 的 Agent 单独标在支持矩阵中，不另行计入上述条目数。后附 22 种 Agent 的接入矩阵、22 个云端供应商/端点目录条目和已知边界。

| 子系统 | 面向对象 | 核心能力 | 主要入口 |
| --- | --- | --- | --- |
| Web Workspace | 用户、协作团队 | 多 Agent 对话、任务、工作流、文件、浏览器、知识库、技能、设备与团队管理 | [`workspace/frontend`](../workspace/frontend)、[`workspace/backend/app`](../workspace/backend/app) |
| 桌面 Launcher | 本地 Agent 使用者 | 安装与配置 Agent、本机管理、凭证管理、平台连接、原生系统集成、内嵌 Workspace | [`packages/launcher`](../packages/launcher) |
| Agent Connector | 终端用户、集成开发者 | `agn` CLI、TUI、Agent 适配器、守护进程、Workspace 工具与远程设备命令 | [`packages/agent-connector`](../packages/agent-connector) |
| Python SDK | 多 Agent 系统开发者 | 网络、事件、传输、身份、工具、Agent Runner、框架集成与 Mods | [`sdk/src/openagents`](../sdk/src/openagents) |
| SDK Studio | 自建网络用户与管理员 | 网络连接、协作界面、服务 Agent 管理、事件调试、模型配置、网络管理 | [`sdk/studio`](../sdk/studio) |

## 3. Web Workspace

### 3.1 Workspace 生命周期

依据：[`workspaces.py`](../workspace/backend/app/routers/workspaces.py)、[`account.py`](../workspace/backend/app/routers/account.py)、[`Workspace 首页`](../workspace/frontend/app/page.tsx)。

| ID | 功能 | 说明 | 状态 |
| --- | --- | --- | --- |
| WS-01 | 创建 Workspace | 创建持久化协作空间，生成 ID、slug 和访问 token | 已实现 |
| WS-02 | 固定地址访问 | 通过 Workspace 标识访问同一个协作空间，跨设备返回 | 已实现 |
| WS-03 | Workspace 列表与切换 | 查看账号关联空间，以及前端保留的访问入口 | 已实现 |
| WS-04 | Workspace 基础设置 | 修改空间名称、显示设置及相关配置 | 已实现 |
| WS-05 | 无强制账号入口 | 支持 Workspace token 访问；空间可另行要求登录 | 已实现 |
| WS-06 | 认领 Workspace | 将符合条件的空间关联到已登录用户 | 依赖配置 |
| WS-07 | 访问 token 轮换 | 管理员重置空间访问 token | 已实现 |
| WS-08 | 删除 Workspace | 后端软删除；Launcher 提供本地配置移除和远端删除入口 | 已实现 |
| WS-09 | 首次登录自动空间 | 对没有任何空间成员关系的新账户，自动创建一个空 Workspace | 依赖配置 |

### 3.2 用户、团队与访问控制

依据：[`workspaces.py`](../workspace/backend/app/routers/workspaces.py)、[`invites.py`](../workspace/backend/app/routers/invites.py)、[`account.py`](../workspace/backend/app/routers/account.py)、[`auth.py`](../workspace/backend/app/routers/auth.py)、[`设置页面`](../workspace/frontend/app/[workspaceId]/settings)。

| ID | 功能 | 说明 | 状态 |
| --- | --- | --- | --- |
| AUTH-01 | 账号会话 | 账号 token 换取 Workspace 会话，前端维护认证状态 | 依赖配置 |
| AUTH-02 | 用户个人资料 | 查看和修改显示名、头像等账户资料 | 依赖配置 |
| AUTH-03 | 账号关联空间查询 | 返回用户拥有或参与的 Workspace | 依赖配置 |
| AUTH-04 | 团队成员管理 | 列出、添加、修改和移除团队成员 | 已实现 |
| AUTH-05 | 团队角色 | 支持 owner、admin、member、viewer 角色与相关成员管理 | 已实现 |
| AUTH-06 | 协作者管理 | 管理空间协作者，并返回可识别的用户资料 | 已实现 |
| AUTH-07 | 邀请链接与邮件邀请 | 生成邀请、查看邀请状态、撤销邀请；邮件投递需要邮件服务 | 依赖配置 |
| AUTH-08 | 邀请预览与接受 | 独立邀请页展示空间信息，接受邀请后加入团队 | 依赖配置 |
| AUTH-09 | 人类成员在线状态 | 记录用户 presence，并显示近期在线情况 | 已实现 |
| AUTH-10 | 登录要求开关 | 控制空间是否要求账户登录 | 已实现 |
| AUTH-11 | 账户关联数据删除 | 清理旧协作者关系、频道人类成员和推送设备，不直接删除共享空间或上游身份账户 | 依赖配置 |
| AUTH-12 | 身份与设备访问区分 | 人类 bearer 按角色判断，设备凭证限所属空间；viewer 在事件写入链路受限，REST 只读限制未全面统一 | 部分实现 |

### 3.3 对话与消息

依据：[`events.py`](../workspace/backend/app/routers/events.py)、[`workspace_mod.py`](../workspace/backend/app/mods/workspace_mod.py)、[`chat`](../workspace/frontend/components/chat)、[`threads`](../workspace/frontend/components/threads)、[`shares.py`](../workspace/backend/app/routers/shares.py)、[`api.ts`](../workspace/frontend/lib/api.ts)、[`adapters/base.js`](../packages/agent-connector/src/adapters/base.js)。

| ID | 功能 | 说明 | 状态 |
| --- | --- | --- | --- |
| CHAT-01 | 创建对话线程 | 新建线程并选择参与的 Agent | 已实现 |
| CHAT-02 | 多 Agent 群聊 | 人类和多个本地、远程或云端 Agent 在同一线程协作 | 已实现 |
| CHAT-03 | Agent 私聊入口 | 通过 Agent 入口打开对应直接对话 | 已实现 |
| CHAT-04 | @Agent 定向消息 | 选择或输入提及，向指定 Agent 路由消息 | 已实现 |
| CHAT-05 | 线程参与者管理 | 将 Agent 加入线程或从线程移除 | 已实现 |
| CHAT-06 | 消息历史 | 持久化事件，按线程、类型、时间等条件查询，分页读取 | 已实现 |
| CHAT-07 | 增量消息同步 | 轮询和 SSE 事件接口支持新消息同步 | 已实现 |
| CHAT-08 | Markdown 消息 | 展示代码块、链接、表格和其他 Markdown 内容 | 已实现 |
| CHAT-09 | Mermaid 图表 | 在消息中渲染 Mermaid 图表 | 已实现 |
| CHAT-10 | 消息附件 | 上传文件、拖放文件、粘贴图片，在消息中展示附件 | 已实现 |
| CHAT-11 | 执行中状态 | 展示 thinking、status、工作状态及中间执行步骤 | 已实现 |
| CHAT-12 | 输入中信号 | 人类 composing 信号，辅助协调消息发送和 Agent 回复 | 已实现 |
| CHAT-13 | 停止执行 | 对正在工作的 Agent 发出线程级停止控制；取消能力因适配器而异 | 已实现 |
| CHAT-14 | 线程标题 | 修改标题，并在配置路由模型后自动生成标题 | 依赖配置 |
| CHAT-15 | 收藏、归档与删除 | 管理线程状态，收藏重要线程，归档或删除线程 | 已实现 |
| CHAT-16 | 自动归档 | 自动归档长期无活动、未收藏且符合条件的线程 | 已实现 |
| CHAT-17 | 公开对话快照 | 将当前聊天文本保存为公开只读快照链接，不是实时共享线程 | 已实现 |
| CHAT-18 | 分享记录管理 | 列出分享记录并撤销分享 | 已实现 |
| CHAT-19 | 消息正文查询 API | 事件查询支持不区分大小写的正文关键词匹配；未接入 Web 快速搜索面板 | 已实现 |
| CHAT-20 | 线程草稿与消息缓存 | 切换线程时保留草稿与已加载消息，发送失败可恢复输入 | 已实现 |
| CHAT-21 | Agent 间私聊观察 | 人类可查看 Agent-to-Agent 私聊，观察视图不允许冒充参与者发送消息 | 已实现 |
| CHAT-22 | 消息排队与取消 | 支持的适配器串行处理同线程工作，展示排队消息并可取消未处理项 | 已实现 |

### 3.4 多 Agent 协作编排

依据：[`workspace_mod.py`](../workspace/backend/app/mods/workspace_mod.py)、[`orchestration-control.tsx`](../workspace/frontend/components/chat/orchestration-control.tsx)、[`workflow.py`](../workspace/backend/app/services/workflow.py)。

| ID | 功能 | 说明 | 状态 |
| --- | --- | --- | --- |
| ORCH-01 | 动态路由模式 | 路由模型根据消息与上下文选择回复 Agent 或不回复 | 依赖配置 |
| ORCH-02 | 主 Agent 模式 | 为线程指定负责人，以主 Agent 为中心组织协作 | 已实现 |
| ORCH-03 | 工作流模式 | 将可复用流程绑定到线程，按流程推进 | 已实现 |
| ORCH-04 | 模式切换 | 在线程头部切换动态、主 Agent 或具体工作流 | 已实现 |
| ORCH-05 | Agent 间任务交接 | 通过提及和路由将后续工作交给其他参与者 | 已实现 |
| ORCH-06 | 协作循环保护 | 限制部分自动响应链路的深度与工作流循环次数 | 已实现 |

### 3.5 任务看板

依据：[`tasks.py`](../workspace/backend/app/routers/tasks.py)、[`tasks-view.tsx`](../workspace/frontend/components/tasks/tasks-view.tsx)、[`task-chat-popup.tsx`](../workspace/frontend/components/tasks/task-chat-popup.tsx)。

| ID | 功能 | 说明 | 状态 |
| --- | --- | --- | --- |
| TASK-01 | 四列任务看板 | Backlog、In Progress、Needs Attention、Done；兼容后端 legacy `todo` 状态 | 已实现 |
| TASK-02 | 任务编辑 | 创建、编辑、删除任务，管理标题、描述、优先级和排序字段 | 已实现 |
| TASK-03 | 预分配负责人 | 先指定 Agent 而不立即运行任务 | 已实现 |
| TASK-04 | 启动、停止与重跑 | 将任务交给 Agent 或工作流执行，可停止或再次运行 | 已实现 |
| TASK-05 | 专属任务对话 | 为执行创建隐藏任务线程，在任务弹窗查看过程并继续沟通 | 已实现 |
| TASK-06 | 任务上下文附件 | 将 Workspace 文件和知识条目附加到任务 | 已实现 |
| TASK-07 | 自动识别任务状态 | 根据 Agent 进展识别执行中、等待输入和完成等状态 | 依赖配置 |
| TASK-08 | 人工介入提醒 | 需要用户输入时突出任务，并产生关联通知 | 已实现 |
| TASK-09 | 工作流进度展示 | 在任务卡片显示流程步骤、运行状态与输出摘要 | 已实现 |

### 3.6 可复用工作流

依据：[`workflows.py`](../workspace/backend/app/routers/workflows.py)、[`workflow.py`](../workspace/backend/app/services/workflow.py)、[`workflows-view.tsx`](../workspace/frontend/components/workflows/workflows-view.tsx)、[`workflow-builder-dialog.tsx`](../workspace/frontend/components/workflows/workflow-builder-dialog.tsx)。

| ID | 功能 | 说明 | 状态 |
| --- | --- | --- | --- |
| FLOW-01 | 工作流模板管理 | 创建、读取、编辑、删除和复制可复用流程 | 已实现 |
| FLOW-02 | 分步流程构建 | 配置步骤名称、指令、顺序和执行人 | 已实现 |
| FLOW-03 | Agent / 人类步骤 | 步骤可分配给 Agent，也可等待人类处理 | 已实现 |
| FLOW-04 | 步骤知识上下文 | 为具体步骤绑定知识条目 | 已实现 |
| FLOW-05 | 条件关卡与回跳 | 配置自然语言判断条件及目标步骤 | 依赖配置 |
| FLOW-06 | 循环次数限制 | 配置最大迭代次数，并限制总体激活次数 | 已实现 |
| FLOW-07 | 运行快照 | 执行时保存模板快照，按步骤维护运行状态 | 已实现 |
| FLOW-08 | 线程与任务执行入口 | 从群聊或任务启动工作流，显示当前步骤和人工等待状态 | 已实现 |
| FLOW-09 | 示例流程起点 | 提供内置流程示例，选择参与者后创建自己的模板 | 已实现 |

### 3.7 执行计划、计时器与周期任务

依据：[`todos.py`](../workspace/backend/app/routers/todos.py)、[`timers.py`](../workspace/backend/app/routers/timers.py)、[`routines.py`](../workspace/backend/app/routers/routines.py)、[`main.py`](../workspace/backend/app/main.py)、[`routines`](../workspace/frontend/components/routines)。

| ID | 功能 | 说明 | 状态 |
| --- | --- | --- | --- |
| AUTO-01 | Agent 执行清单 | 按 Agent、线程维护内部 todo，区别于共享任务看板 | 已实现 |
| AUTO-02 | 清单进度展示 | 展示 pending、in_progress、completed 等执行计划状态 | 已实现 |
| AUTO-03 | 一次性计时器 | 创建、列出和取消延时触发的计时器，触发后发送回调消息 | 已实现 |
| AUTO-04 | 每日周期任务 | 按时分和可选星期重复触发 | 已实现 |
| AUTO-05 | 间隔周期任务 | 按分钟间隔执行周期任务 | 已实现 |
| AUTO-06 | 周期任务上下文 | 保存任务说明、上下文及可选对话历史 | 已实现 |
| AUTO-07 | 周期任务管理 | 创建、查看和取消周期任务，查看下一次执行时间 | 已实现 |
| AUTO-08 | Agent 周期任务收件通道 | 同一 Agent 的周期任务进入专属通道集中处理 | 已实现 |
| AUTO-09 | 调度维护与恢复 | 清理过期内部 todo/通知，并允许卡住的周期任务后续重新触发 | 已实现 |

### 3.8 共享知识库

依据：[`knowledge.py`](../workspace/backend/app/routers/knowledge.py)、[`knowledge`](../workspace/frontend/components/knowledge)、[`chat-input.tsx`](../workspace/frontend/components/chat/chat-input.tsx)。

| ID | 功能 | 说明 | 状态 |
| --- | --- | --- | --- |
| KNOW-01 | 知识条目管理 | 创建、读取、更新、软删除共享 Markdown 文档 | 已实现 |
| KNOW-02 | 知识编辑与预览 | 编辑标题、描述与 Markdown 内容，查看渲染结果 | 已实现 |
| KNOW-03 | 稳定 slug 引用 | 根据标题生成唯一 slug，可按 slug 读取知识 | 已实现 |
| KNOW-04 | 聊天引用知识 | 通过 `@knowledge:<slug>` 将条目作为任务上下文 | 已实现 |
| KNOW-05 | Agent 知识工具 | Agent 可列出、读取、写入和删除知识条目 | 已实现 |
| KNOW-06 | 更新元数据 | 记录创建者、更新者、时间和内容大小 | 已实现 |

### 3.9 共享文件与预览

依据：[`files.py`](../workspace/backend/app/routers/files.py)、[`storage.py`](../workspace/backend/app/storage.py)、[`files`](../workspace/frontend/components/files)、[`use-upload-queue.ts`](../workspace/frontend/hooks/use-upload-queue.ts)。

| ID | 功能 | 说明 | 状态 |
| --- | --- | --- | --- |
| FILE-01 | 多方式上传 | 支持文本、Base64、multipart 和 URL 导入 | 已实现 |
| FILE-02 | 上传队列 | 跟踪上传进度，取消或重试上传 | 已实现 |
| FILE-03 | 文件夹管理 | 新建、重命名和删除文件夹，支持层级路径 | 已实现 |
| FILE-04 | 文件浏览 | 按目录、文件类型等浏览，提供列表和网格展示 | 已实现 |
| FILE-05 | 元数据与下载 | 获取文件信息、读取内容和下载 | 已实现 |
| FILE-06 | 文本与代码预览 | 展示文本及代码行号，限制大文本加载 | 已实现 |
| FILE-07 | Markdown 预览 | 渲染 Markdown 文件内容 | 已实现 |
| FILE-08 | 图片查看器 | 查看图片，支持查看器缩放等操作 | 已实现 |
| FILE-09 | 音视频播放 | 对浏览器兼容的音视频文件提供播放界面 | 已实现 |
| FILE-10 | PDF 预览 | 使用浏览器内置 PDF 查看能力 | 已实现 |
| FILE-11 | CSV / TSV 预览 | 解析并展示分隔数据，限制预览行数；不是完整表格编辑器 | 已实现 |
| FILE-12 | HTML 预览 | 通过隔离 iframe 查看上传的 HTML | 已实现 |
| FILE-13 | 回收站 | 批量移入回收站、查看、恢复和永久清除文件 | 已实现 |
| FILE-14 | Agent 文件协作 | Agent 通过 Workspace 工具读写共享文件并将成果返回聊天 | 已实现 |
| FILE-15 | 存储后端切换 | 提供本地文件存储和配置式对象存储实现 | 依赖配置 |

### 3.10 共享浏览器与网页获取

依据：[`browser.py 路由`](../workspace/backend/app/routers/browser.py)、[`browser.py 服务`](../workspace/backend/app/browser.py)、[`browser-view.tsx`](../workspace/frontend/components/browser/browser-view.tsx)、[`fetch.py`](../workspace/backend/app/routers/fetch.py)、[`search.py`](../workspace/backend/app/routers/search.py)。

| ID | 功能 | 说明 | 状态 |
| --- | --- | --- | --- |
| BROWSE-01 | 共享浏览器标签页 | 新建、列出、查看和关闭标签页 | 依赖配置 |
| BROWSE-02 | 网页导航 | 打开指定 URL，跳转到新页面 | 依赖配置 |
| BROWSE-03 | 页面交互 | 点击元素、填写内容、发送键盘操作 | 依赖配置 |
| BROWSE-04 | 页面脚本执行 | 后端提供 JavaScript evaluate 接口 | 依赖配置 |
| BROWSE-05 | 截图与页面快照 | 获取截图、文本/结构快照供用户与 Agent 观察 | 依赖配置 |
| BROWSE-06 | 人类浏览器预览 | 在 Workspace 中查看共享浏览器的交互画面 | 依赖配置 |
| BROWSE-07 | 标签页共享 | 将标签页分享给其他 Agent | 依赖配置 |
| BROWSE-08 | 登录上下文持久化 | 命名并保存浏览器上下文，复用登录状态，取消持久化或删除上下文 | 依赖配置 |
| BROWSE-09 | 浏览器重连 | 对失效或断开的浏览器会话发起重连 | 依赖配置 |
| BROWSE-10 | 使用量查询 | 查询共享浏览器使用情况 | 依赖配置 |
| BROWSE-11 | 网页内容获取 | 静态抓取并提取正文，对部分 JS 页面尝试浏览器获取，识别登录/平台墙 | 依赖配置 |
| BROWSE-12 | 图片搜索与保存 | 搜索图片，将选择的 URL 图片保存到 Workspace 文件 | 依赖配置 |

### 3.11 云端 Agent 与模型访问

依据：[`cloud_agents.py`](../workspace/backend/app/routers/cloud_agents.py)、[`cloud_agent.py`](../workspace/backend/app/services/cloud_agent.py)、[`cloud_providers.py`](../workspace/backend/app/services/cloud_providers.py)、[`model_access.py`](../workspace/backend/app/routers/model_access.py)、[`yumi.py`](../workspace/backend/app/services/yumi.py)、[`cloud_providers`](../cloud_providers)。

| ID | 功能 | 说明 | 状态 |
| --- | --- | --- | --- |
| CLOUD-01 | 无本地运行时的云端 Agent | 直接配置供应商、模型和密钥加入 Workspace | 依赖配置 |
| CLOUD-02 | 云端 Agent 管理 | 添加、列出、更新、停用和移除云端 Agent | 依赖配置 |
| CLOUD-03 | 自定义 Agent 行为 | 配置 system prompt、模型、base URL 和 max tokens | 依赖配置 |
| CLOUD-04 | 云端文本对话 | 调用模型，携带预算限制内的线程历史并发布回复 | 依赖配置 |
| CLOUD-05 | 云端图片生成 | 结合线程上下文构建图片提示词，生成图片并保存为附件 | 依赖配置 |
| CLOUD-06 | 云端音频生成 | 调用音频生成接口，将结果存入文件并返回附件 | 依赖配置 |
| CLOUD-07 | Google OAuth | 授权 Google 账号，为相关云端 Agent 获取和刷新访问凭证 | 依赖配置 |
| CLOUD-08 | 模型探测 | 动态列出模型，验证所选模型与密钥、端点是否可调用 | 依赖配置 |
| CLOUD-09 | 共享模型访问配置 | 在 Workspace 保存、列出、删除和探测 model-access 配置，供 Agent 设置选择 | 依赖配置 |
| CLOUD-10 | 自定义兼容端点 | 支持自定义 OpenAI-compatible 和 Anthropic-compatible 访问路径 | 依赖配置 |
| CLOUD-11 | Yumi 内置助手 | 按服务开关自动提供助手，支持创建线程/任务、协作交接与设备 Agent 管理工具 | 依赖配置 |
| CLOUD-12 | 调用保护与失败反馈 | 限制上下文、响应链深度；调用失败时在对话中返回错误 | 已实现 |

### 3.12 技能管理

依据：[`workspaces.py`](../workspace/backend/app/routers/workspaces.py)、[`custom_skills.py`](../workspace/backend/app/custom_skills.py)、[`skills-view.tsx`](../workspace/frontend/components/skills/skills-view.tsx)、[`skill-catalog.js`](../packages/agent-connector/src/skill-catalog.js)、[`skill-installer.js`](../packages/agent-connector/src/skill-installer.js)。

| ID | 功能 | 说明 | 状态 |
| --- | --- | --- | --- |
| SKILL-01 | 技能目录 | 获取技能目录，在 Skill Hub 浏览和选择技能 | 依赖配置 |
| SKILL-02 | Agent 内置能力开关 | 按 Agent 配置文件、浏览器、隧道、todo、计时器、周期任务和知识库模块 | 已实现 |
| SKILL-03 | 安装第三方技能 | 通过 Agent 控制事件在设备端下载并安装技能 | 依赖配置 |
| SKILL-04 | 技能卸载 | 向目标 Agent 发出卸载操作，移除安装内容 | 已实现 |
| SKILL-05 | 技能状态跟踪 | 跟踪 installing、installed、失败和部分安装等状态 | 已实现 |
| SKILL-06 | 自定义技能登记 | 登记 Workspace 自定义技能，供空间内 Agent 安装 | 已实现 |
| SKILL-07 | 多运行时技能目录适配 | 为不同 Agent 使用对应工作目录下的 skills 位置 | 已实现 |
| SKILL-08 | 非原生技能发现补充 | 对不能自动发现技能的运行时，向 Agent 注入已安装技能上下文 | 已实现 |

### 3.13 外部消息平台与活动

依据：[`integrations.py 路由`](../workspace/backend/app/routers/integrations.py)、[`integrations.py 服务`](../workspace/backend/app/services/integrations.py)、[`集成设置页`](../workspace/frontend/app/[workspaceId]/settings/integrations/page.tsx)、[`campaign.py`](../workspace/backend/app/services/campaign.py)、[`pilot.py`](../workspace/backend/app/routers/pilot.py)、[`onboarding_reminders.py`](../workspace/backend/app/services/onboarding_reminders.py)。

| ID | 功能 | 说明 | 状态 |
| --- | --- | --- | --- |
| INT-01 | Telegram 消息桥接 | 绑定 Bot，接收 webhook，将对话送入 Workspace 并回传回复 | 依赖配置 |
| INT-02 | Slack 消息桥接 | 绑定 Slack，验证事件签名，接收消息和回传回复 | 依赖配置 |
| INT-03 | Slack OAuth 安装 | 生成安装链接，通过 OAuth 回调建立绑定 | 依赖配置 |
| INT-04 | 飞书/Lark 消息桥接 | 绑定应用，接收事件并将消息与 Workspace 互通 | 依赖配置 |
| INT-05 | 集成绑定管理 | 创建、修改、停用和删除绑定，配置默认目标 Agent | 已实现 |
| INT-06 | 浏览器平台凭证配置 | 为共享浏览器服务设置相关访问配置 | 依赖配置 |
| INT-07 | 模型额度活动 | 查询活动状态与模型，展示可用额度和收集活动反馈 | 依赖配置 |
| INT-08 | Pilot 额度授予 | 受管理员密钥保护的资格查询和额度发放接口 | 依赖配置 |
| INT-09 | 接入说明与提醒邮件 | 发送设置说明，并按条件发送后续 onboarding 提醒 | 依赖配置 |

### 3.14 通知与收件箱

依据：[`notifications.py`](../workspace/backend/app/routers/notifications.py)、[`devices.py`](../workspace/backend/app/routers/devices.py)、[`notify.py`](../workspace/backend/app/services/notify.py)、[`push.py`](../workspace/backend/app/services/push.py)、[`inbox-view.tsx`](../workspace/frontend/components/inbox/inbox-view.tsx)、[`app_version.py`](../workspace/backend/app/routers/app_version.py)。

| ID | 功能 | 说明 | 状态 |
| --- | --- | --- | --- |
| NOTIFY-01 | Agent 主动通知用户 | 创建包含标题、内容、优先级和关联链接的通知 | 已实现 |
| NOTIFY-02 | 通知查询 | 列出、筛选和读取通知，返回未读数 | 已实现 |
| NOTIFY-03 | 已读与清理 | 单条已读、全部已读和移除通知 | 已实现 |
| NOTIFY-04 | 收件箱与跳转 | 按相关 Agent/活动查看收件内容，跳转线程或任务 | 已实现 |
| NOTIFY-05 | 自动人工介入通知 | 任务需要输入或工作流等待人类决策时生成通知 | 已实现 |
| NOTIFY-06 | 移动推送后端 | 注册/注销设备 FCM token，按用户偏好派发推送，支持测试推送 | 依赖配置 |
| NOTIFY-07 | 移动客户端版本接口 | 返回版本与升级策略信息；不代表本仓库包含移动 App 实现 | 依赖配置 |

### 3.15 设备配对与远程 Agent 管理

依据：[`nodes.py`](../workspace/backend/app/routers/nodes.py)、[`设备设置页`](../workspace/frontend/app/[workspaceId]/settings/devices/page.tsx)、[`agent-setup.tsx`](../workspace/frontend/components/agents/agent-setup.tsx)、[`daemon.js`](../packages/agent-connector/src/daemon.js)。

| ID | 功能 | 说明 | 状态 |
| --- | --- | --- | --- |
| NODE-01 | 设备配对码 | 管理员生成配对码，设备兑换后加入 Workspace | 已实现 |
| NODE-02 | 多 Workspace 设备配对 | 同一设备可维护多个 Workspace 的独立配对关系 | 已实现 |
| NODE-03 | 设备清单与在线状态 | 查看 hostname、OS、设备类型、版本和心跳状态 | 已实现 |
| NODE-04 | 设备 Agent / 运行时上报 | 上报本机 Agent、安装检测结果和可选文件系统目录信息 | 已实现 |
| NODE-05 | 远程创建 Agent | 在选定设备发出创建操作，复用本机安装与配置流程 | 已实现 |
| NODE-06 | 远程管理 Agent | 配置、启动、停止和移除已绑定到该空间的设备 Agent | 已实现 |
| NODE-07 | 远程目录选择与诊断 | 通过受限命令浏览目录、检测运行时和 probe Agent | 已实现 |
| NODE-08 | 命令队列与结果 | 设备轮询命令，执行后回报成功、失败、消息及结果数据 | 已实现 |
| NODE-09 | 配对撤销 | 移除设备或撤销关联，设备端处理失效与撤销状态 | 已实现 |

### 3.16 Agent 资料与 Web 使用体验

依据：[`agent-profile-panel.tsx`](../workspace/frontend/components/agents/agent-profile-panel.tsx)、[`layout`](../workspace/frontend/components/layout)、[`monitor`](../workspace/frontend/components/monitor)、[`i18n`](../workspace/frontend/lib/i18n)、[`tours`](../workspace/frontend/components/tours)、[`feedback.py`](../workspace/backend/app/routers/feedback.py)。

| ID | 功能 | 说明 | 状态 |
| --- | --- | --- | --- |
| UX-01 | Agent 资料管理 | 查看/编辑显示名、简介、能力描述、模型和相关设置 | 已实现 |
| UX-02 | Agent 简介生成 | 根据 Agent 信息生成描述 | 依赖配置 |
| UX-03 | Agent 状态展示 | 区分在线、离线、执行中和异常等状态 | 已实现 |
| UX-04 | 快速搜索 | 命令面板搜索已加载线程标题、文件名和 Agent；不是聊天全文检索 | 已实现 |
| UX-05 | 多线程监控 | 同时查看近期活跃线程、执行步骤与消息，打开单线程浮层 | 已实现 |
| UX-06 | 手机与桌面布局 | 移动导航、详情切换、响应式任务和文件视图 | 已实现 |
| UX-07 | 中英文界面 | 英文与简体中文，语言选择和日期/数字格式本地化 | 已实现 |
| UX-08 | 主题与偏好 | 明暗主题及相应显示偏好；桌面与共享 Workspace 同步外观 | 已实现 |
| UX-09 | 二维码访问入口 | 用二维码打开当前 Workspace | 已实现 |
| UX-10 | 接入引导 | 首个 Agent 接入流程、本机/远程设备和云端接入入口、功能引导 | 已实现 |
| UX-11 | 使用状态恢复 | 保存部分视图、选中线程与访问状态，重开时恢复 | 已实现 |
| UX-12 | 用户反馈 | 提交反馈，附带相关上下文 | 已实现 |

## 4. 桌面 Launcher

### 4.1 Agent 安装与本机管理

依据：[`agent-manager.ts`](../packages/launcher/src/main/agent-manager.ts)、[`agents`](../packages/launcher/src/main/agents)、[`安装页面`](../packages/launcher/src/renderer/pages/install)、[`本机页面`](../packages/launcher/src/renderer/pages/agents)、[`workspace-ui.md`](../packages/launcher/docs/workspace-ui.md)。

| ID | 功能 | 说明 | 状态 |
| --- | --- | --- | --- |
| LOCAL-01 | Agent Marketplace | 浏览 Agent 目录，按分类、关键词、安装状态等筛选 | 已实现 |
| LOCAL-02 | Agent 详情 | 查看说明、要求、安装方式、版本和快速设置入口 | 已实现 |
| LOCAL-03 | 安装与卸载 | 按运行时执行安装/卸载，展示进度和日志 | 已实现 |
| LOCAL-04 | 安装前置检查 | 检测 Node、Git、系统条件和部分平台前置依赖 | 已实现 |
| LOCAL-05 | 已安装运行时检测 | 定位二进制、检测版本、区分已安装和已认证/就绪 | 已实现 |
| LOCAL-06 | Agent 版本更新 | 检查运行时更新、展示更新计数和变更说明，执行更新 | 已实现 |
| LOCAL-07 | 版本回退入口 | 对具备支持的运行时回退版本；不是所有 Agent 通用保证 | 已实现 |
| LOCAL-08 | 多 Agent 实例 | 创建、修改、移除 Agent 实例，独立设置工作目录和显示名 | 已实现 |
| LOCAL-09 | 原生工作目录选择 | 使用系统目录选择器设置项目目录 | 已实现 |
| LOCAL-10 | 启停与批量启停 | 启动/停止单 Agent 或全部 Agent，查看守护进程状态 | 已实现 |
| LOCAL-11 | 本机总览 | 查看当前设备、运行中的 Agent 和已连接空间 | 已实现 |
| LOCAL-12 | 连接与断开 Workspace | 将实例连接到空间，维护本地空间配置和 token | 已实现 |
| LOCAL-13 | 原生终端入口 | 打开系统终端或目标 Agent 的交互式 CLI | 已实现 |
| LOCAL-14 | 无账户本机配置 | 安装、配置和创建本地 Agent 不强制登录 OpenAgents 账户 | 已实现 |
| LOCAL-15 | 运行时更新渠道 | 部分 npm 运行时支持按版本标签安装与更新渠道切换 | 已实现 |

### 4.2 认证、模型和凭证

依据：[`cli-login.ts`](../packages/launcher/src/main/cli-login.ts)、[`auth`](../packages/launcher/src/main/auth)、[`credential-import`](../packages/launcher/src/main/credential-import)、[`connections-store.ts`](../packages/launcher/src/main/connections-store.ts)、[`凭证页面`](../packages/launcher/src/renderer/pages/credentials)。

| ID | 功能 | 说明 | 状态 |
| --- | --- | --- | --- |
| CRED-01 | OpenAgents 原生登录 | 邮箱登录、浏览器登录交接、会话兑换与刷新 | 依赖配置 |
| CRED-02 | 邮箱注册 | 原生注册表单调用现有账户服务，随后兑换桌面会话 | 依赖配置 |
| CRED-03 | 退出与会话清理 | 清理账户会话和内嵌 Workspace 存储 | 已实现 |
| CRED-04 | Agent CLI 登录引导 | 启动支持的运行时登录，处理授权 URL、验证码、取消和状态刷新 | 依赖配置 |
| CRED-05 | API Key / 模型 / 端点配置 | 根据 Agent 注册表展示字段，支持类型级与实例级环境变量 | 已实现 |
| CRED-06 | 模型列表与连通性测试 | 获取候选模型，验证模型调用；结果依赖供应商 | 依赖配置 |
| CRED-07 | 已有凭证扫描 | 扫描支持的运行时原生配置、dotenv 和 shell 环境候选项 | 已实现 |
| CRED-08 | 粘贴配置导入 | 解析粘贴的环境变量/配置文本，选择并应用有效候选项 | 已实现 |
| CRED-09 | 凭证管理库 | 新建、修改、删除凭证，显示脱敏值、测试结果和使用关系 | 已实现 |
| CRED-10 | 本地加密存储 | 使用 AES-256-GCM；系统 safeStorage 包装主密钥是可选路径，不等于始终使用系统钥匙串 | 已实现 |
| CRED-11 | 凭证应用到 Agent | 将选择的凭证映射到目标 Agent 的环境变量 | 已实现 |
| CRED-12 | 凭证状态与显式查看 | 按需查看凭证、记录测试结果并处理锁定/解密失败 | 已实现 |

### 4.3 平台连接与 GitHub

依据：[`platforms.ts`](../packages/launcher/src/renderer/components/connections/platforms.ts)、[`connection-tester.ts`](../packages/launcher/src/main/connection-tester.ts)、[`mcp-config.ts`](../packages/launcher/src/main/mcp-config.ts)、[`github-client.js`](../packages/agent-connector/src/github-client.js)、[`github 页面`](../packages/launcher/src/renderer/pages/github)、[`github-bridge.ts`](../packages/launcher/src/main/github-bridge.ts)。

| ID | 功能 | 说明 | 状态 |
| --- | --- | --- | --- |
| CONNECT-01 | 平台连接管理 | 创建、查看和移除连接，关联凭证，展示连接状态 | 已实现 |
| CONNECT-02 | GitHub 凭证连接 | 验证 token，供仓库绑定和 Agent 凭证应用使用 | 依赖配置 |
| CONNECT-03 | Google 凭证连接 | 验证 Google/Gemini 凭证并用于 Agent 配置 | 依赖配置 |
| CONNECT-04 | Linear 凭证连接 | 验证 Linear 凭证，支持环境变量和托管 MCP 配置 | 依赖配置 |
| CONNECT-05 | Linear MCP 安装/移除 | 为 Claude Code、Cursor、Gemini CLI 写入或移除 MCP 配置 | 依赖配置 |
| CONNECT-06 | GitHub 仓库绑定 | 将 Agent 与指定 GitHub 仓库和凭证关联 | 依赖配置 |
| CONNECT-07 | Issue / PR 浏览 | 查询绑定仓库的 Issue、PR 和相关状态 | 依赖配置 |
| CONNECT-08 | Issue 评论 | 在 GitHub 页面向 Issue 发送评论 | 依赖配置 |
| CONNECT-09 | 其他平台连接卡片 | Slack、Discord、Telegram、Notion 在桌面平台目录中为 planned | 规划项 |

### 4.4 桌面壳、设置、日志与更新

依据：[`index.ts`](../packages/launcher/src/main/index.ts)、[`workspace-host.ts`](../packages/launcher/src/main/workspace-host.ts)、[`notifications.ts`](../packages/launcher/src/main/notifications.ts)、[`updater.ts`](../packages/launcher/src/main/updater.ts)、[`设置页面`](../packages/launcher/src/renderer/pages/settings)、[`日志页面`](../packages/launcher/src/renderer/pages/logs)。

| ID | 功能 | 说明 | 状态 |
| --- | --- | --- | --- |
| DESK-01 | 内嵌共享 Workspace | 桌面加载 Web Workspace 的同一套页面，不另造协作 UI | 已实现 |
| DESK-02 | Workspace / This Computer 切换 | 协作空间与本机工具分离，切换时保留空间界面状态 | 已实现 |
| DESK-03 | Connect This Computer | 经用户操作为本机配对，等待指定设备在线后打开 Agent 设置 | 依赖配置 |
| DESK-04 | 跨平台桌面分发 | macOS、Windows、Linux 的构建和打包配置 | 已实现 |
| DESK-05 | 托盘与窗口行为 | 托盘菜单、关闭到后台、窗口状态和相关启动设置 | 已实现 |
| DESK-06 | 开机自启 | 配置自动启动及相关后台行为 | 已实现 |
| DESK-07 | 日志查看与筛选 | 实时增量日志，按 Agent、关键词等筛选，管理日志范围 | 已实现 |
| DESK-08 | 本机诊断 | 查看系统信息、运行时路径、版本和 Agent 健康信息 | 已实现 |
| DESK-09 | 通知中心与系统通知 | 保存本地通知，标记已读/清除，点击系统通知定位相关对象 | 已实现 |
| DESK-10 | 通知偏好 | 声音、开关、免打扰时间及按事件类型筛选 | 已实现 |
| DESK-11 | 外观与语言 | 中英文、浅色/深色/跟随系统、皮肤等外观设置 | 已实现 |
| DESK-12 | 网络与镜像配置 | 自定义 Workspace 服务地址、代理、no-proxy、安装镜像和端点测试 | 已实现 |
| DESK-13 | 设置导入与导出 | 备份/导入设置，重置设置或本地外观状态 | 已实现 |
| DESK-14 | 缓存与路径管理 | 清理应用缓存，在系统文件管理器中打开日志、下载和运行时目录 | 已实现 |
| DESK-15 | Launcher 自身升级 | 检查、下载、安装应用更新，展示升级进度和提示 | 依赖配置 |
| DESK-16 | Connector 核心升级 | 更新桌面使用的 Agent Launcher 核心 | 依赖配置 |
| DESK-17 | 更新说明与新功能提示 | 展示 What's New 和版本变更记录 | 已实现 |
| DESK-18 | Node 运行环境引导 | 检测并准备桌面所需 Node；部分平台使用便携运行时和适配路径 | 已实现 |

## 5. Node.js Agent Connector / CLI / TUI

依据：[`cli.js`](../packages/agent-connector/src/cli.js)、[`tui.js`](../packages/agent-connector/src/tui.js)、[`index.js`](../packages/agent-connector/src/index.js)、[`daemon.js`](../packages/agent-connector/src/daemon.js)、[`adapters/base.js`](../packages/agent-connector/src/adapters/base.js)、[`mcp-server.js`](../packages/agent-connector/src/mcp-server.js)。

| ID | 功能 | 说明 | 状态 |
| --- | --- | --- | --- |
| CLI-01 | 终端交互面板 | `agn` 打开 TUI，集中查看 Agent 和 Workspace 状态并执行管理操作 | 已实现 |
| CLI-02 | Agent 目录检索 | `search`、`runtimes` 查看目录、安装和就绪状态 | 已实现 |
| CLI-03 | 运行时安装/卸载 | `install`、`uninstall`；`create --install` 合并创建与安装 | 已实现 |
| CLI-04 | 实例管理命令 | `create`、`remove`、`list`、`start`、`stop` | 已实现 |
| CLI-05 | 守护进程命令 | `up`、`down`、`restart`、`status` 管理后台运行 | 已实现 |
| CLI-06 | Workspace 管理命令 | 创建、加入、列出已知空间，连接/断开 Agent | 已实现 |
| CLI-07 | 无 token 重复连接 | 对已配对或已知空间，按 slug 重新绑定 Agent | 已实现 |
| CLI-08 | 设备配对命令 | `node connect`、`node status` 支持服务器和远程设备接入 | 已实现 |
| CLI-09 | 环境变量管理 | `env` 保存运行时设置，向 Agent 注入对应 provider 凭证 | 已实现 |
| CLI-10 | 模型/运行时诊断 | `test-llm`、`probe`，支持结构化诊断输出 | 已实现 |
| CLI-11 | 日志与自启动 | `logs` 查看日志，`autostart` 配置系统自启动 | 已实现 |
| CLI-12 | CLI 升级 | `version`、`update` 检查版本和更新自身 | 依赖配置 |
| CLI-13 | MCP / Skills 工具模式 | `tool-mode` 为 Agent 或全部 Agent 切换 Workspace 工具暴露方式 | 已实现 |
| CLI-14 | 内置技能开关 | `skills` 查看和启用/禁用具体 Workspace 模块 | 已实现 |
| CLI-15 | 可嵌入 Node.js 库 | `AgentConnector` 提供目录、安装、实例、环境和 daemon 管理 API | 已实现 |
| CLI-16 | Agent 进程守护 | 管理子进程，崩溃重启、退避等待、配置重载、状态与错误上报 | 已实现 |
| CLI-17 | Workspace 事件适配 | 心跳、事件轮询、线程会话映射、控制事件与回复发布 | 已实现 |
| CLI-18 | Workspace MCP 工具 | 通过 stdio MCP 暴露历史、Agent、文件、图片/网页获取、浏览器、计划、计时器、通知和知识工具 | 已实现 |
| CLI-19 | 本地服务公网隧道 | 开启、列出和关闭 Cloudflare Tunnel，将本地端口暴露为公网 URL | 依赖配置 |
| CLI-20 | 远程设备命令执行 | 执行空间下发的白名单命令并回报结果；不是任意远程 shell | 已实现 |
| CLI-21 | 平台与安装适配 | Windows 控制台、WSL、二进制路径、依赖检查和镜像适配 | 已实现 |
| CLI-22 | 凭证与错误指导 | 根据运行时输出提示缺少认证、版本不兼容或安装前置条件 | 已实现 |

## 6. Python SDK

### 6.1 网络、事件与传输

依据：[`network.py`](../sdk/src/openagents/sdk/network.py)、[`client.py`](../sdk/src/openagents/sdk/client.py)、[`event_gateway.py`](../sdk/src/openagents/sdk/event_gateway.py)、[`onm_pipeline.py`](../sdk/src/openagents/sdk/onm_pipeline.py)、[`transports`](../sdk/src/openagents/sdk/transports)、[`network_config.py`](../sdk/src/openagents/models/network_config.py)。

| ID | 功能 | 说明 | 状态 |
| --- | --- | --- | --- |
| NET-01 | 网络创建与加载 | 通过代码或 YAML 配置创建、加载和启动网络 | 已实现 |
| NET-02 | 网络生命周期 | 初始化、关闭、重启、保存配置 | 已实现 |
| NET-03 | Agent 注册管理 | 注册/注销 Agent，查询在线 Agent、运行时间和网络统计 | 已实现 |
| NET-04 | Agent 客户端 | 连接、断开、发现网络 profile、注册 mod adapter | 已实现 |
| NET-05 | 事件发送与响应 | 使用统一事件对象发送事件并接收响应 | 已实现 |
| NET-06 | 事件处理器 | 注册/移除处理器，按事件模式响应 | 已实现 |
| NET-07 | 订阅与等待 | 订阅/取消订阅事件，按条件等待事件和查询缓存事件 | 已实现 |
| NET-08 | 事件路由与线程 | 提供网关、处理器、事件线程和索引查询能力 | 已实现 |
| NET-09 | ONM 基础抽象 | 地址解析、事件封装与 mod pipeline 的代码实现 | 已实现 |
| NET-10 | HTTP 传输 | 注册、事件发送、长轮询、管理接口和静态 Studio 托管 | 已实现 |
| NET-11 | WebSocket 传输 | 建立双向连接并传递事件 | 已实现 |
| NET-12 | gRPC 传输 | 通过 gRPC connector/transport 通信，支持 TLS 和可选 mTLS 配置 | 已实现 |
| NET-13 | MCP 传输 | Streamable HTTP、JSON-RPC、工具列出与调用、会话管理 | 已实现 |
| NET-14 | A2A 传输 | Agent Card、JSON-RPC 消息与任务操作，独立或统一 HTTP 入口 | 已实现 |
| NET-15 | 网络发布与 Relay | CLI 发布网络，HTTP transport 支持 relay 连接、状态、心跳和重连 | 依赖配置 |
| NET-16 | 网络导入/导出 | 导出配置与选定数据，导入前验证后应用 | 已实现 |
| NET-17 | 本机网络发现 | 查询本机运行的网络及相关连接信息 | 已实现 |
| NET-18 | 去中心化拓扑基础 | 存在 peer 连接、消息与心跳实现，但完整 P2P/DHT/mDNS 能力未完成 | 部分实现 |

### 6.2 Agent 开发、工具与模型框架

依据：[`agents`](../sdk/src/openagents/agents)、[`workspace.py`](../sdk/src/openagents/sdk/workspace.py)、[`tool_decorator.py`](../sdk/src/openagents/workspace/tool_decorator.py)、[`tools`](../sdk/src/openagents/tools)、[`providers.py`](../sdk/src/openagents/lms/providers.py)、[`mcp_connector.py`](../sdk/src/openagents/utils/mcp_connector.py)。

| ID | 功能 | 说明 | 状态 |
| --- | --- | --- | --- |
| DEV-01 | Agent Runner | YAML Agent 配置、启动/停止、setup/react/teardown 生命周期 | 已实现 |
| DEV-02 | Worker Agent | 用回调或装饰器处理私聊、频道、回复、提及、reaction 和文件等事件 | 已实现 |
| DEV-03 | 自定义 Agent 逻辑 | 继承 Runner 实现自身业务，提供示例 Agent | 已实现 |
| DEV-04 | Workspace 开发接口 | 通过统一对象访问工作区和网络暴露的工具 | 已实现 |
| DEV-05 | 自定义 Python 工具 | 从本地文件加载工具，支持工具装饰器与参数定义 | 已实现 |
| DEV-06 | 自定义事件工具 | 从事件定义生成调用工具，供 LLM/Agent 使用 | 已实现 |
| DEV-07 | Mod 工具注入 | 收集网络工具，向 Agent 和支持的外部框架注入 | 已实现 |
| DEV-08 | 外部 MCP 客户端 | 按配置连接 MCP server，将其工具提供给 Agent | 依赖配置 |
| DEV-09 | 原生 LLM Provider | OpenAI、Anthropic、Gemini、MiniMax、AWS Bedrock 等 provider 实现 | 依赖配置 |
| DEV-10 | LiteLLM 与兼容模型 | 通过 LiteLLM/通用 provider 接入额外模型服务 | 依赖配置 |
| DEV-11 | LangChain 集成 | 包装 LangChain Agent 并接入网络事件/工具 | 依赖配置 |
| DEV-12 | AutoGen 集成 | 包装 AutoGen 实体并注入网络工具 | 依赖配置 |
| DEV-13 | CrewAI 集成 | 将 CrewAI 执行接入 Agent Runner | 依赖配置 |
| DEV-14 | LlamaIndex 集成 | 将 LlamaIndex Agent 接入事件与工具体系 | 依赖配置 |
| DEV-15 | Pydantic AI 集成 | 包装 Pydantic AI Agent，并提供网络工具 | 依赖配置 |
| DEV-16 | Exa 搜索工具 | 可选搜索工具与依赖 | 依赖配置 |
| DEV-17 | 批量 Agent 管理 | 启动多个配置/工作区中的 Agent，提供监控和管理辅助工具 | 已实现 |
| DEV-18 | LLM 调用日志 | 记录模型请求/响应与调用信息，供日志读取和 Studio 展示 | 已实现 |

### 6.3 身份、认证和权限

依据：[`agentid`](../sdk/src/openagents/agentid)、[`agent_identity.py`](../sdk/src/openagents/sdk/agent_identity.py)、[`secret_manager.py`](../sdk/src/openagents/sdk/secret_manager.py)、[`topology.py`](../sdk/src/openagents/sdk/topology.py)、[`cli_identity.py`](../sdk/src/openagents/client/cli_identity.py)、[`cert_generator.py`](../sdk/src/openagents/utils/cert_generator.py)。

| ID | 功能 | 说明 | 状态 |
| --- | --- | --- | --- |
| ID-01 | Agent 名称与 DID 解析 | 解析 Agent 标识、组织和 DID 形式 | 已实现 |
| ID-02 | AgentID 信息与验证 | 查询 Agent 信息，向身份服务验证标识和 JWT | 依赖配置 |
| ID-03 | DID 文档解析 | 从身份服务解析 DID document | 依赖配置 |
| ID-04 | 签名挑战认证 | 使用支持的私钥签署 challenge 并换取 token | 依赖配置 |
| ID-05 | 身份认领与 CLI | CLI 提供 claim、challenge、token、auth 等身份流程入口 | 依赖配置 |
| ID-06 | 网络内身份占用管理 | Agent ID claim/release、活跃会话、保留名称与冲突处理 | 已实现 |
| ID-07 | Agent Group 与权限 | 按请求组、凭证和网络配置分配 Agent Group，执行管理权限判断 | 已实现 |
| ID-08 | 网络凭证管理 | 提供 secret manager 与认证材料管理 | 已实现 |
| ID-09 | TLS 证书工具 | 生成/验证证书，配置安全传输 | 已实现 |

### 6.4 内置 Mods

以下为网络扩展能力，通常需要在 SDK 网络配置中启用；不意味着 Web Workspace 默认拥有相同页面。

| ID | Mod | 功能范围 | 状态 | 依据 |
| --- | --- | --- | --- | --- |
| MOD-01 | Simple Messaging | Agent 私聊和广播的基础消息能力 | 已实现 | [`simple_messaging`](../sdk/src/openagents/mods/communication/simple_messaging) |
| MOD-02 | Workspace Messaging | 频道消息、单层回复线程、引用、reaction、文件附件及历史 | 已实现 | [`messaging`](../sdk/src/openagents/mods/workspace/messaging) |
| MOD-03 | Feed | 单向公告/更新发布、附件、分类/标签、全文搜索、过滤、分页和时间增量查询；发布后不可变 | 已实现 | [`feed`](../sdk/src/openagents/mods/workspace/feed) |
| MOD-04 | Forum | 主题创建/编辑/删除、嵌套评论、投票、搜索、作者权限与讨论线程 | 已实现 | [`forum`](../sdk/src/openagents/mods/workspace/forum) |
| MOD-05 | Documents | 多 Agent 文档编辑、按行插入/删除/替换、行评论、presence/光标、版本与操作历史、读写权限 | 已实现 | [`documents`](../sdk/src/openagents/mods/workspace/documents) |
| MOD-06 | Wiki | 页面创建、所有者直接编辑、修改提案、审批/拒绝、版本历史/回滚、分类与搜索 | 已实现 | [`wiki`](../sdk/src/openagents/mods/workspace/wiki) |
| MOD-07 | Project | 模板化项目、参与者/Agent Group 权限、项目生命周期、共享/私有状态、项目消息和成果 | 已实现 | [`project`](../sdk/src/openagents/mods/workspace/project) |
| MOD-08 | Shared Artifact | 文本/二进制成果持久化、元数据、MIME 筛选、Agent Group 权限和变更通知 | 已实现 | [`shared_artifact`](../sdk/src/openagents/mods/workspace/shared_artifact) |
| MOD-09 | Shared Cache | 共享键值数据、持久化、MIME 元数据、Agent Group 权限和变更通知 | 已实现 | [`shared_cache`](../sdk/src/openagents/mods/core/shared_cache) |
| MOD-10 | Agent Discovery | 能力公告、能力更新、按能力条件发现 Agent | 已实现 | [`agent_discovery`](../sdk/src/openagents/mods/discovery/agent_discovery) |
| MOD-11 | Task Delegation | 委派/接受/拒绝任务、进展、完成/失败/取消、超时、任务查询、能力匹配和自动路由 | 已实现 | [`task_delegation`](../sdk/src/openagents/mods/coordination/task_delegation) |
| MOD-12 | 外部 A2A 委派 | 查询外部 Agent 能力，并将任务委派到 A2A Agent | 依赖配置 | [`a2a_delegation.py`](../sdk/src/openagents/mods/coordination/task_delegation/a2a_delegation.py) |
| MOD-13 | n8n | 调用 n8n workflow，与 n8n Agent 会话交互 | 依赖配置 | [`n8n`](../sdk/src/openagents/mods/integrations/n8n) |
| MOD-14 | AgentWorld | 接入游戏服务，登录、观察、移动、聊天、攻击、采集、制作与转移物品 | 依赖配置 | [`agentworld`](../sdk/src/openagents/mods/games/agentworld) |

### 6.5 Mod 扩展和 Python CLI

依据：[`base_mod.py`](../sdk/src/openagents/sdk/base_mod.py)、[`base_mod_adapter.py`](../sdk/src/openagents/sdk/base_mod_adapter.py)、[`network.py`](../sdk/src/openagents/sdk/network.py)、[`system_commands.py`](../sdk/src/openagents/sdk/system_commands.py)、[`client`](../sdk/src/openagents/client)、[`templates`](../sdk/src/openagents/templates)。

| ID | 功能 | 说明 | 状态 |
| --- | --- | --- | --- |
| EXT-01 | 自定义 Mod 开发 | 提供 network mod、agent adapter、manifest 和配置机制 | 已实现 |
| EXT-02 | 动态加载/卸载 | 在运行中加载、卸载 Mod，查询已加载扩展 | 已实现 |
| EXT-03 | 启用/停用与配置持久化 | 管理 Mod 状态并保存配置，部分修改需要网络重启 | 已实现 |
| EXT-04 | 配置 schema | 向管理端返回 Mod 配置结构，用于生成设置表单 | 已实现 |
| EXT-05 | 事件定义发现 | 加载事件定义、索引事件，提供列表、详情和搜索接口 | 已实现 |
| EXT-06 | 网络初始化 CLI | `network init/start/list/publish` 等网络操作 | 已实现 |
| EXT-07 | Agent CLI | 安装/搜索运行时、启动单个 SDK Agent 和批量启动入口 | 已实现 |
| EXT-08 | Studio 启动与托管 | 从 Python 启动 Studio，或由统一 HTTP transport 提供构建后的前端 | 已实现 |
| EXT-09 | 网络模板 | 多 Agent 聊天室、信息中心、Wiki 和 Project Hub 模板 | 已实现 |

## 7. SDK Studio

依据：[`routeConfig.ts`](../sdk/studio/src/config/routeConfig.ts)、[`pages`](../sdk/studio/src/pages)、[`components`](../sdk/studio/src/components)、[`http.py`](../sdk/src/openagents/sdk/transports/http.py)。

| ID | 功能 | 说明 | 状态 |
| --- | --- | --- | --- |
| STUDIO-01 | 网络连接选择 | 本地、公开或手动配置网络连接入口 | 已实现 |
| STUDIO-02 | 网络初始化向导 | 设置管理员密码、选择网络模板和默认模型配置 | 已实现 |
| STUDIO-03 | 用户与管理员模式 | 登录、路由守卫、管理员和用户对应菜单与权限 | 已实现 |
| STUDIO-04 | 管理总览 | 网络状态、连接数、服务 Agent 和常用管理操作 | 已实现 |
| STUDIO-05 | 网络资料 | 查看/编辑 profile、名称、描述和相关网络信息 | 已实现 |
| STUDIO-06 | 网络 README | 展示与编辑网络介绍内容 | 已实现 |
| STUDIO-07 | Agent 管理 | 查看网络成员、Agent 信息和管理操作 | 已实现 |
| STUDIO-08 | Agent Group 管理 | 查看和配置 Agent 组与相关接入权限 | 已实现 |
| STUDIO-09 | 服务 Agent 控制 | 列出、启动、停止、重启服务 Agent，查看状态 | 已实现 |
| STUDIO-10 | 服务 Agent 编辑 | 查看/保存服务 Agent 源码、实例环境变量和全局环境变量 | 已实现 |
| STUDIO-11 | 服务运行日志 | 查看服务 Agent 运行日志 | 已实现 |
| STUDIO-12 | LLM 日志监控 | 查看调用列表与详情 | 已实现 |
| STUDIO-13 | 消息协作界面 | SDK 频道、私聊、回复、reaction、附件和项目聊天界面 | 已实现 |
| STUDIO-14 | 文档协作编辑器 | 共享文档编辑、评论和在线协作界面 | 已实现 |
| STUDIO-15 | Forum / Feed / Wiki | 对应 Mod 的讨论、信息流、页面与提案界面 | 已实现 |
| STUDIO-16 | Project / Artifact | 项目、状态与成果管理界面 | 已实现 |
| STUDIO-17 | AgentWorld 界面 | 接入游戏环境的可视化入口 | 依赖配置 |
| STUDIO-18 | 事件目录 | 按 Mod 查看事件定义、搜索事件、读取参数与详情 | 已实现 |
| STUDIO-19 | 事件日志与调试 | 查看事件日志，发送调试事件并查看响应 | 已实现 |
| STUDIO-20 | Mod 管理 | 添加、启停、配置 Mod，按需重启网络 | 已实现 |
| STUDIO-21 | 默认模型管理 | 设置/删除默认模型，测试模型连接 | 依赖配置 |
| STUDIO-22 | 传输与外部访问 | 配置 transport、外部工具暴露和连接说明 | 已实现 |
| STUDIO-23 | MCP 工具查看 | 查看网络导出的 MCP 工具 | 已实现 |
| STUDIO-24 | 网络发布 | 管理网络对外发布和连接入口 | 依赖配置 |
| STUDIO-25 | 网络迁移 | 导入/导出入口、导入预览/验证和选项设置 | 已实现 |
| STUDIO-26 | 界面设置 | 多语言、主题及用户界面相关设置 | 已实现 |

## 8. Agent 支持矩阵

Node.js Connector 当前 `ADAPTER_MAP` 有 22 个 Agent 类型。下表列的是代码接入与仓库声明，不是 22 个运行时均通过真实模型端到端验收的承诺。Python 适配器集合与 Node.js 集合不完全相同，不能将此表直接视为 Python 支持矩阵。

依据：[`adapters/index.js`](../packages/agent-connector/src/adapters/index.js)、[`registry`](../registry)、[`README.md`](../README.md)、[`Agent 接入指南`](agents)。

| Agent | 类型 ID | Node 适配器 | 注册表协作声明 | 特别状态或边界 |
| --- | --- | --- | --- | --- |
| OpenClaw | `openclaw` | 已实现 | `true` | 注册表有安装与 Workspace 接入声明 |
| Claude Code | `claude` | 已实现 | `true` | 通过官方 CLI 接入 |
| Codex CLI | `codex` | 已实现 | `true` | 通过官方 CLI 接入 |
| Cursor | `cursor` | 已实现 | 未显式声明 | 不从缺失字段推断协作等级 |
| OpenCode | `opencode` | 已实现 | 未显式声明 | 不从缺失字段推断协作等级 |
| Hermes Agent | `hermes` | 已实现 | `true` | 有独立运行时与会话适配 |
| Gemini CLI | `gemini` | 已实现 | `true` | 本机 CLI 接入与云端 Google Agent 是不同路径 |
| GitHub Copilot CLI | `copilot` | 已实现 | `false` | 有接入指南和流式事件解析，不声明完整协作支持 |
| Cline | `cline` | 已实现 | `false` | README 标注 Beta，不声明完整协作支持 |
| Amp | `amp` | 已实现 | `true` | CLI execute mode |
| Aider | `aider` | 已实现 | `true` | Beta：README 明确真实 provider E2E 尚待验证；默认禁用自动提交 |
| Goose | `goose` | 已实现 | `true` | Beta：README 明确真实 provider E2E 尚待验证；有最小 CLI 版本要求 |
| DeepSeek Harness | `deepseek` | 已实现 | `true` | Preview：固定预览运行时，headless 接入 |
| Kimi Code CLI | `kimi` | 已实现 | `true` | 有独立流式消息解析 |
| NanoClaw | `nanoclaw` | 已实现 | `false` | 独立 channel/bridge 集成，不声明完整协作支持 |
| mini-SWE-agent | `mini-swe-agent` | 已实现 | `true` | 对应 `mini.js` 适配器 |
| Pi | `pi` | 已实现 | `true` | RPC 接入、provider/model 配置与流式解析 |
| Antigravity CLI | `antigravity` | 已实现 | `true` | 独立适配与流式解析 |
| Command Code | `commandcode` | 已实现 | `true` | 独立适配与流式解析 |
| OpenWorker | `openworker` | 已实现 | `true` | 含运行时安装与管理实现 |
| CodeBuddy Code / WorkBuddy | `codebuddy` | 已实现 | `true` | 独立适配、流式解析与认证指导 |
| CodeArts Agent / 码道 | `codearts` | 已实现 | `true` | 独立接入指南与适配器 |

补充：存在直接 LLM 调用的内部适配器；它不是 `ADAPTER_MAP` 中第 23 个可创建类型。各 Agent 在取消执行、会话恢复、第三方技能和工具模式上的能力应以具体适配器为准。

## 9. 云端供应商与能力目录

根目录当前包含 22 个供应商/端点目录条目。这里展示仓库配置的模型类别，不验证外部模型当前可用性，不逐个列出容易变化的模型 ID。

依据：[`cloud_providers`](../cloud_providers)、[`cloud_providers.py`](../workspace/backend/app/services/cloud_providers.py)。

| 能力类别 | 目录条目 | 说明 |
| --- | --- | --- |
| 文本 | Anthropic、Cerebras、DeepSeek、Fireworks AI、Groq、Manus、Mistral AI、OpenRouter、OrcaRouter、Perplexity、SambaNova、Together AI | 目录含 chat 模型；部分供应商使用专用 API 适配 |
| 文本 + 图片 | OpenAI、Google AI、xAI、SenseNova | 目录同时含 chat 与 image 模型 |
| 图片 | fal.ai、Replicate、Stability AI | 图片生成接入 |
| 音频 | ElevenLabs | 音频/TTS 接入 |
| 内置助手 | OpenAgents | 服务端凭证驱动的内置助手路径，不要求用户填此 provider 的 key |
| 自定义端点 | Custom Endpoint | 自行配置端点和模型，不附带固定模型目录 |

## 10. 部署、开发和示例

依据：[`workspace/README.md`](../workspace/README.md)、[`workspace/Makefile`](../workspace/Makefile)、[`backend.Dockerfile`](../workspace/backend/backend.Dockerfile)、[`前端 Dockerfile`](../workspace/frontend/Dockerfile)、[`pyproject.toml`](../pyproject.toml)、[`安装脚本`](../scripts)、[`sdk/demos`](../sdk/demos)、[`sdk/examples`](../sdk/examples)、[`tests`](../tests)、[`CI workflows`](../.github/workflows)。

| ID | 功能 | 说明 | 状态 |
| --- | --- | --- | --- |
| OPS-01 | Workspace 自托管 | FastAPI 后端、Next.js 前端、PostgreSQL 的本地和独立部署 | 已实现 |
| OPS-02 | Docker / Compose | Workspace 前后端容器与开发、生产编排配置 | 已实现 |
| OPS-03 | 数据库迁移 | Alembic schema 迁移和开发维护命令 | 已实现 |
| OPS-04 | 可配置认证模式 | Workspace token/Firebase 及独立/共享身份相关配置 | 依赖配置 |
| OPS-05 | 环境变量与运行配置 | 数据库、认证、CORS、Agent 超时、provider、浏览器、邮件、推送等部署参数 | 已实现 |
| OPS-06 | HTTP 运维入口 | 健康检查、API 文档及相关网络信息入口 | 已实现 |
| OPS-07 | 快速安装脚本 | Unix shell / Windows PowerShell 的 CLI 安装流程 | 已实现 |
| OPS-08 | 注册表扩展 | 用 JSON/YAML 维护 Agent，脚本同步客户端注册表；供应商目录可配置加载 | 已实现 |
| OPS-09 | Python 可选依赖 | 轻量客户端与 SDK、LLM 框架、搜索、开发/文档依赖分组 | 已实现 |
| OPS-10 | 自动化质量检查 | 后端/SDK/Connector/Launcher 测试，以及部分 Playwright E2E 和 CI 构建 | 已实现 |
| OPS-11 | 多 Agent 场景 Demo | Hello World、创业讨论、新闻流、研究团队、语法检查、游戏、新闻跟踪等 | 已实现 |
| OPS-12 | 开发文档与接入指南 | 网络模型、Python 接口、Studio、Agent 安装认证、技能安装和文件成果返回文档 | 已实现 |

## 11. 明确边界与未完成项

| 项目 | 当前情况 | 依据 |
| --- | --- | --- |
| 完整 P2P / libp2p | 去中心化拓扑对 libp2p 有回退逻辑，使用 WebSocket 模拟部分通信，不能列为完整 libp2p 能力 | [`topology.py`](../sdk/src/openagents/sdk/topology.py) |
| DHT / mDNS 自动发现 | 源码仍存在尚未实现的路由/发现 TODO | [`topology.py`](../sdk/src/openagents/sdk/topology.py) |
| WebRTC transport | 有未来用途的可选依赖，但未见同等完整的 transport 实现 | [`pyproject.toml`](../pyproject.toml)、[`transports`](../sdk/src/openagents/sdk/transports) |
| ONM 全规格实现 | ONM 文档含跨网络、分级认证等架构设计；基础代码与 AgentID 客户端不等于完整规格和网络联邦全部落地 | [`openagents_network_model.md`](openagents_network_model.md)、[`ONM pipeline`](../sdk/src/openagents/sdk/onm_pipeline.py) |
| 桌面平台连接 ≠ Web 消息桥接 | 桌面 Slack/Discord/Telegram/Notion 为 planned；Web Workspace 的 Telegram/Slack/Lark 有独立实现 | [`platforms.ts`](../packages/launcher/src/renderer/components/connections/platforms.ts)、[`integrations.py`](../workspace/backend/app/routers/integrations.py) |
| 平台探测 ≠ 完整业务集成 | 对第三方 token 有 probe 或展示 OAuth 选项，不意味着所有 OAuth 流程和下游平台业务功能都已落地 | [`connection-tester.ts`](../packages/launcher/src/main/connection-tester.ts)、[`platforms.ts`](../packages/launcher/src/renderer/components/connections/platforms.ts) |
| GitHub 功能范围 | 有仓库绑定、Issue/PR 查询和评论；不由 Connections 卡片文案推断 PR 合并或 Actions 工作流执行 | [`github-bridge.ts`](../packages/launcher/src/main/github-bridge.ts) |
| Office 在线编辑/预览 | 文件类型可识别和下载；当前预览器不提供完整 DOCX/XLSX/PPTX 编辑或预览，表格预览限 CSV/TSV | [`file-preview.tsx`](../workspace/frontend/components/files/file-preview.tsx) |
| 任意格式文件可播放 | 音视频播放依赖浏览器解码能力，文件类型识别不等于支持所有编码 | [`media-stage.tsx`](../workspace/frontend/components/files/media-stage.tsx) |
| 任务拖拽 | 后端支持状态和 position 字段；当前 Web 看板未见拖拽交互实现，不列为已实现产品功能 | [`tasks-view.tsx`](../workspace/frontend/components/tasks/tasks-view.tsx) |
| 聊天全文检索 | Web 快速搜索针对已加载线程标题、文件名和 Agent，不是完整聊天正文全文搜索 | [`search-menu.tsx`](../workspace/frontend/components/layout/search-menu.tsx) |
| viewer 全接口只读 | 事件 pipeline 要求至少 member；部分其他 REST 路由只验证空间访问，不应声称已实现全面一致的只读隔离 | [`AuthMod`](../workspace/backend/app/mods/auth.py)、[`access.py`](../workspace/backend/app/access.py) |
| 账户完整注销 | `DELETE /v1/account` 当前清理部分关联数据，不等于删除上游身份账户或全部新式 User/Membership 数据 | [`account.py`](../workspace/backend/app/routers/account.py) |
| 私聊附件与提及 | 当前 Web 私聊发送路径未支持线程聊天中的全部附件/提及能力 | [`chat-view.tsx`](../workspace/frontend/components/chat/chat-view.tsx) |
| Python / Node CLI 范围 | Python CLI 保留 SDK 网络/Agent/身份等命令；daemon、实例创建、连接与自启动等 Launcher 命令已迁至 Node CLI | [`client/cli.py`](../sdk/src/openagents/client/cli.py)、[`cli.js`](../packages/agent-connector/src/cli.js) |
| 跨端消息功能一致性 | SDK Messaging/Studio 的 reaction、回复与引用，不直接等于 Web Workspace 拥有全部同名控制 | [`SDK messaging`](../sdk/src/openagents/mods/workspace/messaging)、[`Web chat`](../workspace/frontend/components/chat) |
| 文档冲突处理 | Documents Mod 使用 last-write-wins 等基础策略，不应宣传为完整 CRDT/OT 协作引擎 | [`Documents README`](../sdk/src/openagents/mods/workspace/documents/README.md) |
| 密钥存储边界 | 桌面凭证库加密不涵盖所有 Agent `.env`/MCP 配置；MCP 配置明确需要写入明文认证头 | [`connections-store.ts`](../packages/launcher/src/main/connections-store.ts)、[`mcp-config.ts`](../packages/launcher/src/main/mcp-config.ts) |
| 移动端完整产品 | 本仓库有响应式 Web 和移动推送/版本后端，不据此声称移动 App 源码在本项目实现 | [`devices.py`](../workspace/backend/app/routers/devices.py)、[`app_version.py`](../workspace/backend/app/routers/app_version.py) |
| 第三方运行时验收 | Aider/Goose 明确仍待真实 provider E2E；Cline 为 Beta，DeepSeek Harness 为 Preview | [`README.md`](../README.md) |

## 12. 清单维护

新增或更新功能时，应同步更新对应条目和源码依据。只有实际消除了依赖或未完成部分，才改变状态；不要仅因为新增页面、目录条目或依赖声明就将功能标为完整实现。
