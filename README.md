# Electron Game Bridge

在 macOS 上运行仅提供 Windows EXE 发行包的 Electron 游戏。

项目面向游戏没有提供 macOS 版本、但 Windows 发行目录中保留了 Electron 应用资源的场景。
启动器识别游戏所需的 Electron 版本，匹配用户提供的 macOS 运行环境，加载游戏资源及其原始 JavaScript 主入口。
EXE 用于提供版本和架构证据，实际游戏进程由 macOS Electron 运行。

支持本地多游戏管理、独立启动配置和运行数据隔离。默认打开空游戏库；仓库不包含游戏、存档、预设安装目录或 Electron 二进制。
使用 JavaScript/CommonJS、HTML/CSS 和原生 DOM，共享代码兼容 Node 12；无需新增构建系统。

## 适用范围

- 优先支持完整 Windows 发行目录中包含 `resources/app.asar` 的 Electron 游戏。添加游戏时选择整个安装目录，并保留随附 EXE 和其他资源。
- 如果只有单个 EXE，且没有当前启动器能够读取的应用资源，本项目不会自动提取该 EXE 中的游戏。
- 游戏原始主入口、preload 和初始化流程必须能在相应 macOS Electron 中工作。依赖 Windows 专属组件或不兼容原生模块的游戏可能无法运行。
- 不修改、重打包游戏，不自动下载运行环境，也不承诺 Windows 存档能够跨平台直接续用。

## 启动

自行准备可运行的原始 Electron macOS 发行包，然后指定管理界面的运行环境：

```sh
LAUNCHER_ELECTRON='/path/to/Electron.app' ./启动游戏库.command
```

也可将自备运行环境放到本机 `runtime/Electron.app` 后双击脚本。`runtime/` 不进入 Git。
管理器使用哪个 Electron 启动，与各游戏实际使用的运行环境分别配置；无需 npm install。

## 使用

1. 在“运行环境”入口选择电脑上的 Electron.app 或其中的可执行文件，点击“检测并保存”。游戏运行环境就是用于运行游戏的 Electron，版本由程序自动识别。
2. 点击“添加游戏”，填写名称、安装目录和启动设置。图片可选；目录内有 resources/app.asar 时，默认入口 `.` 自动定位该归档。
3. 程序识别所需精确版本并自动匹配已登记运行环境，不提供手选版本下拉框。选择卡片后，在下方详情启动游戏。
4. 游戏停止后才可编辑。点击保存才提交，关闭/取消不保存；独立保存的运行环境登记单独生效。

游戏使用自身的 Electron 主入口、窗口、preload 和初始化流程。启动器不注入引擎补丁或修改游戏包。
版本证据来自 package.json 中精确的 dependencies/devDependencies.electron，或随附 Windows PE 程序的唯一 Electron 标记及架构。
只有版本范围、游戏自身版本号、缺失或冲突的证据不会被猜成可用版本；缺少运行环境应另行登记本地文件。
不自动下载运行环境，也不承诺兼容任意游戏或原生模块。

## 数据与恢复

- 游戏库配置：`.launcher/library.json`；最后有效备份：同目录 `.bak`。
- 管理界面状态：`.launcher/ui-data`；每游戏默认 userData：`.launcher/games/<id>/userdata`。
- 实际运行环境绑定：`.launcher/games/<id>/runtime.json`。保存和启动均检查兼容性；未知旧数据或不兼容身份不会被重置、迁移或换目录。
- 保存使用冲突检测和原子替换；显式恢复先保留故障原件，再恢复有效备份。
- 日志：`logs/launcher.log` 及 `logs/games/<id>.log`。配置、日志、运行环境、图片和存档属于本地资料，不应提交。

游戏可能自行覆盖数据目录，因此 userData 参数不构成文件系统沙箱。接入实际游戏时应在隔离副本上确认其数据位置，尤其是跨平台存档语义。

## 验证

```sh
node tests/core.test.js
```

同时使用自备 Electron 的 Node 模式验证共享代码：

```sh
ELECTRON_RUN_AS_NODE=1 '/path/to/Electron.app/Contents/MacOS/Electron' tests/core.test.js
```

图形回归只使用仓库自有合成应用，并从空游戏库开始：

```sh
LAUNCHER_ELECTRON='/path/to/Electron.app' ./启动游戏库.command --library-smoke-test --test-root='/absolute/isolated/test-directory'
```

测试根必须与正式配置和已登记游戏目录分离。没有 npm test 或 lint 脚本。

## 公开发布

发布前运行 `node scripts/audit-publication.js`，检查全部可达 Git 历史的敏感路径、生成数据和常见凭据格式。
审计不代替人工检查自定义秘密或第三方内容权利。隐私处理范围见 [公开发布记录](docs/PUBLICATION.md)，治理见 [Constitution](.specify/memory/constitution.md)。
