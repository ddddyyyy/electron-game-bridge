# Plan

- JavaScript/CommonJS，fs/path/crypto/child_process/assert，原生 HTML/CSS/DOM；共享代码兼容 Node 12。
- main.js 默认启动管理窗口；library-main/preload 提供固定 IPC、sender 校验、单实例和忙状态保护。
- core/config 管理版本化 JSON、稳定身份、冲突、备份和恢复；core/launch 探测本地运行时、校验数据绑定和使用 shell=false 参数数组调度。
- adapters 仅描述通用 Electron 应用。版本证据为精确 package 依赖，或随附 PE 程序的唯一 Electron 标记/架构；冲突和未知不猜测。默认 `.` 可定位 resources/app.asar，仍执行其原始主入口。
- 默认配置无游戏和运行时。用户登记本地资源；配置及游戏状态位于被 Git 忽略的 .launcher，日志和运行时也不提交。
- UI 为浅色卡片、左侧导航和下方详情；设置同窗口独立打开；版本只读自动匹配。
- 本机数据可保留，但不通过公开仓库传递。发布历史使用经授权的匿名干净起点，旧历史私有备份不在仓库内。

验证入口见 README；只有合成应用测试，不依赖商业游戏、个人目录或固定运行时二进制。
