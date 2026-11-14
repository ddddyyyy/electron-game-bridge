# Data Model: 引擎存档路径兼容

本文件描述待实现结构，不是对现有 library.json 的直接修改。

## 1. Library 与 Game

- 新版接受 schemaVersion=1/2；旧库仍读写 v1，直到第一次明确保存存档策略。升级前独占另存 v1 原件；后续普通 .bak 继续沿用现有行为，不覆盖专用升级原件。
- v2 新增可选 Game.savePolicy。缺失/null 都表示关闭；停用不删除已完成备份。未知版本、未知字段或畸形策略保留原始字节并明确拒绝，不降级成关闭。
- 策略属于原游戏 ID，adapterId 仍为 electron-app，原 runtimeId 自动匹配及 runtime.json 数据绑定规则不变。
- 回退旧程序先关闭游戏，保留 v2 与全部备份，再显式恢复升级前 v1 配置；不得删除 savePolicy 字段来伪装回退。旧程序拒绝 v2 是预期保护。

### savePolicy（仅持久化后端生成值）

| 字段 | 类型/规则 | 含义 |
| --- | --- | --- |
| version | 固定 1 | 策略自身版本，与库版本分开 |
| profileId | 内置枚举，如 tyrano-file-v1 | 已支持的引擎存储规则，不是动态模块路径 |
| evidenceHash | SHA-256 | 已识别 main/首页/引擎声明的组合证据，更新后重新核验 |
| projectId | profile 解析并校验的字符串 | 推导完整存档键；禁止分隔符、空字节、路径跳转 |
| location | install / resources | 固定候选，UI 不传任意目录 |
| directoryIdentity | realPath、dev、ino | 确认的现有目录身份，inode 信息用字符串避免精度问题 |
| backupId | 后端随机 ID | 本次首次应用/位置变更前的完成备份，全空集合也有清单 |
| otherSnapshot | 未选目录身份、文件清单/摘要或不存在状态 | 已确认冲突基线，用于检测另一处新增/变化 |
| hadSaves | boolean | 确认时是否已有存档；与下述持续存在记录共同判断，不能永久沿用初始空状态 |

实际路径由安装目录与 location 派生并与 directoryIdentity 核对。目录实际必须存在；禁止所选目录越出安装树、候选间别名重叠或与另一游戏策略目录重叠。符号链接不能成为跨游戏隔离的绕过手段；存档文件本身必须为独立普通文件，拒绝符号链接及 nlink>1。

策略变化、新旧引擎证据变化、安装路径变化都需要重新扫描、确认和备份，不复用过期确认。旧配置或恢复配置引用的备份缺失/不完整时，启动拒绝并要求重新确认；不能根据 UI 显示值认为已备份。

## 2. SaveInspection（临时扫描结果）

- 关联：游戏 ID 或新增草稿、规范化安装/入口、运行环境身份、profile/evidenceHash、库 revision/token。
- 候选：install 和 resources 两项；含目录真实身份或不存在状态，以及该 profile 受支持文件的 name/size/mtime/hash。UI 仅接收文件名、大小和时间，不接收存档内容。
- scanToken：主进程生成的不可猜随机令牌；绑定完整快照和以上上下文，仅当前操作有效，10 分钟失效；只保留当前编辑草稿的最新令牌，新扫描使旧令牌失效。
- 禁止读取内容作规划研究；实施时用户发起的正式扫描可按功能需要有界读取、校验和计算摘要，不把内容写入日志或发送到 UI。
- 元数据/文件变化、草稿变化、库 token 变化、源证据变化都使令牌无效。应用时重新完整扫描，不只比较 mtime。
- 单个已存在目录必须可读；不存在的 resources 可作为无存档候选显示，但不能被选为写入目标；不自动创建游戏内部目录。安装根目录始终必须存在。

## 3. BackupManifest

存放在 .launcher/games/<game-id>/save-backups/<backup-id>/manifest.json，备份文件为同目录中的 files/<原文件名>；目录 0700、文件 0600。ID、相对文件名全部由后端限制，不从配置拼接任意路径。

清单 version、backupId、gameId、createdAt、profileId、projectId、sourceLocation、sourceDirectoryIdentity、files[]；每项 name/size/sha256/mtime。清单状态为 complete，且所有文件存在、校验一致才可引用。临时目录以独立随机名称创建，不完整目录永远不计成功。

事务：

1. 获得主进程操作锁，核对停止状态与配置 token/revision。
2. 重新扫描、检查 scanToken、跨游戏归属和目标写入条件。写入条件探测仅在明确应用后，使用独占临时文件，关闭后只删除本次探测文件。
3. 在独立私有目录写入备份并校验；前后复核源文件与目录身份，fsync 文件/清单及必要父目录，再原子改名为完成备份。
4. 最后复核候选与配置 token，再调用既有原子配置提交。首个 v2 提交前另存 v1 原件。
5. 成功后作废 scanToken；失败保留原配置/源存档，完成备份即使尚未引用也保留，不自动删除。不会形成“配置已启用但备份未完成”。

备份是首次应用/切换时的快照，不是持续备份。选定存档正常保存不会触发每次重新备份或重新确认；每次启动仍验证文件格式、目录身份及未选候选基线。文件被外部程序并发更改不属于锁的保护范围，可检测变化必须拒绝，不能声称消除所有外部写入竞态。

## 4. SavePresence（最小存在记录）

每次确认对应 .launcher/games/<id>/save-state/<backup-id>.json，保存 version、gameId、backupId、profile/evidenceHash、directoryIdentity、seenKeys。文件为 0600，使用与其他元数据相同的原子保存；不是存档内容备份，不创建周期备份功能。

确认时以选定集合初始化，在提交策略之前完成；启动前结合该记录验证曾存在的键仍可读取。首次新增某键时，guard 必须先持久化 seenKeys，再写对应存档；记录更新失败则不写存档。即使新文件最终没写成功，下一次也安全拒绝并要求核对，不把未知状态当空进度。

记录缺失、损坏、与当前策略或目录不匹配时要求重新确认；不能用空记录自动重建。游戏正常保存仅更新自己的键存在信息，不改库 revision 或让其他游戏策略失效。本期不支持引擎清空/删除存档；遇到删除请求保持原文件并报不支持，避免“合法清空”与异常丢失无法区分。

## 5. LaunchSaveContext（一次启动的私有描述）

只在策略启用时创建；含 gameId、profile/evidence、选定目录与键集合、备份引用、实际运行环境身份、一次性 nonce。置于该游戏 .launcher 私有目录，0600 独占写入；不复用旧描述，不接受用户参数覆盖；仅清理本次创建的临时文件。

子进程通过固定 main-hook 读取描述。使用 child_process 的额外单向 stdio 管道（fd 3）发送有界 JSON 行状态，stdout/stderr 继续写现有日志；不会从日志文本解析授权状态。未启用游戏保留原有 stdio 和 argv。

## 6. 状态转换

- 编辑：disabled → inspecting → awaiting-confirmation → backing-up → committed；取消回到原已提交状态；任意失败保留输入和原配置。
- 启动：validating → starting → adapting → running → exited。进程 PID 出现不等于适配就绪；握手最长 10 秒。
- 页面读写门禁：closed → installed/read-validated → open。任一识别/读取/解码/解析/写入错误触发 poisoned，后续所有受支持写入和删除一律拒绝，然后终止游戏并报告 failed。不得因游戏捕获异常而解除 poisoned。
- main-hook 在原 main 之前安装监听；guard preload 同步拦截受支持方法赋值，不能等页面就绪。preload 仅安装属性拦截器时状态为 armed，不能报告 running；全部必需方法定义被识别并接管、选定集合验证成功且保护已建立才发送 adapter-ready。缺少方法或超时保持关闭。adapter-ready 仍不作为真实续玩验收。
- 运行期间已选目录身份改变、意外存档消失或出现不受支持键时同样进入 poisoned。

不提供跨进程沙箱、自动迁移或完整存档恢复状态机；人工恢复流程见 quickstart。

## 7. 运行中存档写入

受控写入采用同目录独占临时文件，先完整编码、写入、校验、fsync 并关闭，再复核源与目录身份后 rename 替换；不直接以截断方式打开原存档。rename 前任何失败保留旧文件，失败锁定本次会话。替换后的目录 fsync 失败属于提交结果不确定：报告失败并停止，不自动删除新文件或回滚覆盖；保留已完成的首次使用前备份及可用临时材料，供核对恢复。

清空/删除操作本期拒绝执行；不能以“存在首次备份”为由允许未验证删除规则。临时文件只有确认属于本次操作才可清理。一次 rename 仅保证单文件替换，不宣称多个存档文件形成原子事务；游戏写多文件中途退出时用完整集合备份恢复，不自动混合新旧文件。
