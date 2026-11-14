# Development guidelines

- 使用 JavaScript/CommonJS、Node 标准库和原生 HTML/CSS/DOM；共享代码兼容 Node 12，不新增无依据的框架或构建工具。
- 遵循 `.specify/memory/constitution.md`。启动器与具体游戏解耦，不能加入私有默认游戏、安装目录、引擎补丁或故事场景。
- 默认是空游戏库；运行时由用户本地提供，版本由可靠证据识别及实际探针复核。
- 测试只用合成应用和专用临时数据。禁止读取玩家存档内容或以回归为由清理用户目录。
- 核心检查：`node tests/core.test.js`，以及自备 Electron 的 Node 模式运行同一脚本。
- 图形检查：`./启动游戏库.command --library-smoke-test --test-root=<absolute-isolated-directory>`，用 LAUNCHER_ELECTRON 指定运行时。
- 发布检查：`node scripts/audit-publication.js`、`git diff --check`。不要虚构 npm test/lint 命令。
- 配置、存档、缓存、日志、截图和本地运行时不进入版本控制，文档和夹具不得包含真实用户名、个人目录或账户标识。
- 若根目录存在 `.codegraph/`，理解或定位代码前优先用 `codegraph explore` / `codegraph node`；不存在则跳过，不主动索引。
