# Contracts: 引擎存档路径兼容

固定的管理 IPC 和子进程适配协议；不提供网络 API、任意脚本加载或插件协议。

## 1. 管理 IPC

继续使用 launcher:request 的 {action,payload} 与 {ok,value}/{ok:false,code,message,fieldErrors} 响应，维持当前管理窗口 sender 与 URL 校验。扫描令牌、指纹和路径身份由后端生成，UI 不能提交可信值。

### inspectSavePolicy（新增）

输入：{revision,token,game}，game 为现有设置草稿（不含 runtimeId 和后端策略字段），可以含已有 id。只读操作，不启用、不备份、不创建游戏内部目录。

输出：{status,profileLabel,candidates,scanToken,message}。status 为 supported / unsupported / invalid；仅 supported 返回令牌。candidates 含 location、displayPath、exists、files[{name,size,mtime}] 和可选异常说明，不返回存档内容。

运行中可以显示已有已提交位置，但不发起会产生确认令牌的重新扫描。界面输入、安装目录或入口变更即丢弃令牌；采用序号检查忽略旧异步响应，避免把前一游戏的扫描结果显示到当前游戏。

### saveGame（扩展现有操作）

输入：{revision,token,game,saveChoice?}。

- 无 saveChoice：既有游戏保留已提交策略；新游戏关闭。已有策略与草稿路径/证据冲突时拒绝并要求重新确认，不能偷偷删掉策略。
- saveChoice={enabled:false}：停止后明确停用；不删备份，提示后续原始引擎可能读取其他位置。
- saveChoice={enabled:true,location,scanToken}：从两候选选择一项；未选、无效、过期或扫描变化拒绝。空集合只允许默认 install，只有 resources 有旧存档时须显式确认 resources。
- game 不接受 savePolicy、profileId、backupId、可信指纹或任意存档路径；由后端完整构造保存的策略。

后端顺序：单操作锁 → 停止/配置冲突检查 → 原有运行环境探测与数据绑定校验 → 重新扫描与归属检查 → 完成备份 → 再核对 → 原子保存配置。锁在任意异步等待期间持续生效；失去 UI 焦点不等于取消已开始的提交。

管理窗口另接收固定 launcher:save-progress 事件，载荷为 {gameId,phase}，phase 仅为 checking / backing-up / saving；只报告实际进入的阶段，不发送存档内容。preload 暴露 onSaveProgress，界面只在本次保存进行时消费，完成/失败后忽略迟到事件。

响应沿用现有快照和 savedGameId。只有备份与配置均成功后关闭编辑面板；失败保留当前输入。备份成功但配置失败的副本保留并显示可恢复提示，不宣称启用成功。

### readLibrary / launchGame / restoreConfig

- readLibrary 对 v1 不自动写入；快照增加每游戏 saveStatus 只读摘要（enabled、实际目录、profileLabel、备份状态或需重新确认原因）。运行中不读取并解析不断变化的存档内容来刷新摘要。
- launchGame 仍只接受游戏 ID。先核对配置、实际运行环境及数据绑定，再验证策略、备份和目录；已启用适配通过握手后才报告 running。普通游戏保持现有流程及“进程已启动不代表完整验收”的含义。
- restoreConfig 不恢复存档；恢复后必须使临时扫描令牌全部失效，下一次启动重新核对策略。v1 备份恢复不自动迁移文件；明确提示其中策略为关闭。

## 2. 并发与错误

管理主进程单操作锁涵盖 saveGame、saveRuntime、restoreConfig、launchGame 的准备阶段；Runner.busy 涵盖子进程生命周期。无论 UI 是否禁用按钮，后端独立阻止重入。扫描与提交交错令牌失效；不可将恢复配置视作绕过策略验证的途径。

| 错误码 | 场景 | 必须行为 |
| --- | --- | --- |
| SAVE_UNSUPPORTED | 引擎、窗口或运行环境不在已验证范围 | 不启动适配，不降级权限 |
| SAVE_CONFIRM_REQUIRED | 未选位置、新冲突、目录/证据变化 | 返回设置重新确认 |
| SAVE_SCAN_STALE | 确认令牌过期、输入/文件/配置变化 | 重新扫描，源不变 |
| SAVE_DIRECTORY_INVALID | 目录消失、越界、被替换或不可写 | 不换目录，不覆盖旧文件 |
| SAVE_DIRECTORY_SHARED | 与其他游戏真实目录相同 | 阻止启用 |
| SAVE_FORMAT_INVALID | 未知键、损坏/不支持编码或格式 | 禁止写入，不能按空进度继续 |
| SAVE_BACKUP_FAILED | 复制/校验/fsync/rename/清单失败 | 不提交策略、不启动游戏 |
| SAVE_HOOK_FAILED / SAVE_HOOK_TIMEOUT | preload 接入或握手失败 | 写入门禁保持关闭并终止子进程 |
| SAVE_CLEAR_FAILED | 原清档操作或完成状态提交失败 | 保留操作前备份和未完成记录，不报告成功，阻止后续写入 |
| SAVE_READ_FAILED / SAVE_WRITE_FAILED | 已启用会话存档访问失败 | poisoned，停止读写并结束游戏 |
| OPERATION_BUSY | 保存、恢复、启动准备相互重入 | 不排队执行过期输入，提示重试 |

继续保留 CONFIG_CONFLICT、CONFIG_WRITE_FAILED、ALREADY_RUNNING 等既有错误。日志只记游戏 ID、profile、运行环境身份和阶段；本机必要路径可用于本机诊断，但不记录存档内容、不进入公开验证资料。

## 3. 子进程和页面协议

- argv 仅在启用时增加固定 --require 和 launcher 自带 main-hook 的绝对路径，位于原始游戏应用参数之前。游戏自身 args 不能覆盖预载、私有描述、目录或状态管道参数。
- main-hook 用专用环境变量读取本次私有描述位置；clearEnv 之后由后端设置，未启用时删除继承的该变量。描述属于该游戏、nonce 与当前启动匹配，不接受任意路径或动态 require。
- 通过固定额外 stdio 管道 fd 3 写入一行一个 JSON 的有界状态（单行最多 8 KiB、每次页面接入最多 64 KiB，接收缓冲有界且不累计保存历史消息），不依赖 process.send；接收方须缓冲跨块行并拒绝超限/畸形帧。消息为 {type:'save-adapter',gameId,nonce,documentGeneration,phase,code?,message?}；主进程核对子进程实例、nonce、当前页面代次及状态顺序；旧代次消息丢弃，不能让新页面误报就绪。日志里相同文字不能伪造成功；管道不是身份授权边界。启用会话的 stdio 为 [ignore,log,log,pipe]，父进程及时消费 fd 3；就绪前 EOF、畸形/乱序/超限消息或发送 EPIPE 均为失败，不能当正常完成。
- 主模块在原 main 前安装 ready、web-contents 与失败监听；ready 时保留已有 Session preloads 并添加固定 guard。只支持经过核验的默认 Session、主框架、本地入口、既有 nodeIntegration 开启且 contextIsolation/sandbox 关闭的组合。
- guard 与子主进程使用固定私有 IPC，校验 sender/frame、预期页面及描述。不会向游戏暴露管理器文件能力。保留原游戏 preload；若它抢先读写存档且无法保护，该 profile 不受支持。
- guard 在引擎存储方法赋值时同步安装有界实现；文件键与编码只能来自内置 profile，不能执行配置中代码。读前验证整个已选存档集合，读失败后即使游戏捕获异常，也不能写入/删除旧存档。
- guard 自身 require/安装失败必须同步终止页面继续执行并报告子主进程；子主进程终止游戏。仅监听 preload-error 后异步退出不满足要求。固定 guard 的语法和完整性在 spawn 前校验；具体致命失败路径必须先通过两种 Electron 的“下一条页面语句未执行、存档无变化”测试。
- 只有全部必需引擎存储定义均已接管、已选集合验证通过且写保护建立后的 adapter-ready 消息使 Runner 从 adapting 进入 running；guard-armed 只表示拦截器已安装，不可作为 ready。任意失败保持 busy 直到子进程确认退出，不能仅收到失败就允许另一启动交错。超时亦须终止并等待退出。

- 保留原游戏已有的本地主页面刷新/重新加载及 profile 已识别的页面流转；新页面加载前关闭存档门禁，分配新 documentGeneration、重新安装和校验，收到当前代次 adapter-ready 才恢复 running。每次加载均限 10 秒，进程互斥不释放；不能沿用旧 ready，也不能自动清除 poisoned。未知或远程页面不获得文件能力，不能以禁止正常刷新/重载代替适配。
- 受控保存先持久化键存在记录，再使用同目录临时文件、校验/fsync 和原子替换；失败不得截断原文件。替换后同步失败明确报告结果不确定，停止而不自动回滚。清空/删除及重置写入由受控实现保留原游戏语义和确认流程；必须在操作前完成独立备份并持久化 pendingClear，成功后同步 seenKeys，取消/备份失败不执行，操作中断保留备份并报告未完成。读取失败后的自动清档仍拒绝。

该通道用于协作状态，不是对恶意游戏的安全认证或文件系统沙箱。

## 4. UI 契约

沿用现有暖白/森林绿 C 界面、游戏卡片、下方详情和同窗口设置。

- 游戏设置增加“存档兼容”区域：只读引擎识别结果、显式启用开关、两个候选单选项、实际路径及文件名/时间列表、备份和不合并提示。unsupported 显示原因且不能启用；原启动功能仍可在未启用时按原行为使用。
- 有旧存档时无默认选中项；两处为空时显示“将在游戏目录创建新进度”，仍须启用与保存确认。选择只表示当前表单输入，不写任何存档。
- 保存中显示扫描/备份/保存阶段并锁定相关操作；取消/关闭在提交前不保存，提交期间不可关闭。失败保留输入，过期令牌要求重新扫描。无持久草稿。
- 游戏详情显示“存档兼容：未启用”或“存档位置：实际路径”，与尚未保存的表单分开。不把 Electron userData 冒充文件存档位置。
- 键盘可访问开关、单选和错误提示；沿用焦点约束、关闭后返回焦点、aria-live 状态和 textContent 输出。窄窗口换行，不为此更换 UI 框架或导航结构。
- 提供停用和人工恢复说明链接/文案，不增加完整恢复面板或自动覆盖按钮。

## 5. 原游戏操作保留

不在管理界面增加清档按钮，也不改变原游戏已有的确认步骤。清档支持范围必须覆盖原功能实际触及的受支持键；未知清档边界不能按成功放行。需要新建窗口或重新加载页面的原有流程，应在 profile 中明确识别并验证；未完成相关适配的组合不能标记兼容交付完成。

清档成功后重新加载页面、保存新进度和重启续读均须通过。清档备份失败时不调用实际删除/重置；中途失败时保留可恢复材料。页面刷新/重载不触发目录重新选择或重复首次启用备份，只重新核对当前策略并建立新页面保护；外部目录变化等真实冲突仍按原规则处理。

## 5. 已确认来源标识

子进程内部固定 storage 操作增加 read-confirmed，仅接收当前页面代次和 profile 中已支持的键；由核心 readConfirmed 先核对完整完成备份，再返回对应原始内容，备份中无此键返回 null。管理 UI 不获得此能力或存档内容。

适配层在原初始化前核对已识别初始化/路径方法与 projectID。已有文件标识与当前 localStorage 来源键不同时，只有其与确认备份的标识相同才更新这个来源键；其余 localStorage、存档文件及原校验保持原行为。无法核对时致命拒绝，提示停止后重新检查并确认存档位置，不进入引擎的删除存档建议流程。
