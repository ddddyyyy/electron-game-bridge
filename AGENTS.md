# Development guidelines

- 使用 JavaScript/CommonJS、Node 标准库和原生 HTML/CSS/DOM；共享代码兼容 Node 12，不新增无依据的框架或构建工具。
- 遵循 `.specify/memory/constitution.md`。启动器与具体游戏解耦，不能加入私有默认游戏、安装目录或故事场景；不得持久改写游戏包。显式启用的引擎存档兼容仅留在适配边界。
- 默认是空游戏库；运行时可由用户本地登记或从 Electron 官方下载精确版本；版本由可靠证据识别、SHA-256 与实际探针复核，缓存按版本/架构共享。
- 测试只用合成应用和专用临时数据。禁止读取正式玩家存档内容或以回归为由清理用户目录。仅有明确授权时，可在专用隔离副本中验收真实存档；原件保持不动。
- 核心检查：`node tests/core.test.js`、`node tests/save-policy.test.js`、`node tests/runtime-manager.test.js`，以及自备 Electron 的 Node 模式运行这些脚本。
- 图形检查：`./启动游戏库.command --library-smoke-test --test-root=<absolute-isolated-directory>`，用 LAUNCHER_ELECTRON 指定运行时。
- 发布检查：`node scripts/audit-publication.js`、`git diff --check`。不要虚构 npm test/lint 命令。
- 配置、存档、缓存、日志、截图和本地运行时不进入版本控制，文档和夹具不得包含真实用户名、个人目录或账户标识。
- 若根目录存在 `.codegraph/`，理解或定位代码前优先用 `codegraph explore` / `codegraph node`；不存在则跳过，不主动索引。

## Active Technologies

- JavaScript/CommonJS；共享代码兼容 Node 12 语法和 API + 现有 Electron、Node fs/path/crypto/child_process/assert、HTML/CSS/原生 DOM；无新增包依赖或构建工具 (002-engine-save-compat)
- 现有 .launcher/library.json；按游戏归属的私有存档备份、最小键存在记录及临时启动描述，不写游戏包或运行环境 (002-engine-save-compat)

## Recent Changes

- 002-engine-save-compat: 已实现按引擎复用的文件存档适配、显式双候选选择、备份、首读前保护、原清档及逐页面重载保护；普通启动保持原入口。两版本合成验收与真实隔离结果见 `specs/002-engine-save-compat/validation.md`，不能据此宣称任意 Tyrano 游戏兼容。

- 隔离故障测试以退出码 1 判断受控拒绝，不能把 SIGSEGV 等原生崩溃当作测试通过。macOS 测试子进程通过专用命令行偏好避免异常退出恢复弹窗；不修改全局恢复状态或普通启动参数。

- 窗口生命周期检查：`node tests/lifecycle-smoke.js <Electron-executable>`。全部游戏窗口关闭后通过通用主进程模块请求正常退出；保留原退出/保存回调，Runner 仅在实际进程结束后释放锁。不要用 UI 强制解锁或强杀代替正常退出。
