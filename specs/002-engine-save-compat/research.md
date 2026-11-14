# Research: 引擎存档路径兼容

**Date**: 2026-11-14  
**Status**: 设计决策完成；未执行真实存档读写或引擎时序实测。

## 1. 现有路径与接入范围

**Decision**: 保留 adapters/index.js 中原始入口解析和 Electron 数据目录，另设显式启用的文件存档策略。首期识别 Tyrano 的已知文件存储 profile，不按游戏名称或仅凭扩展名启用。

**Rationale**: 当前 Runner 用安装目录作为默认 cwd，并设置每游戏 userData；这无法改变引擎自行从应用归档位置推算文件存档路径的逻辑。已读取的两个本地样本均有按平台计算目录的 Tyrano 代码及 configSave=file；本轮只采用机制结论，不将游戏代码、名字、路径和内容带入公共夹具。

**Alternatives considered**: 调 cwd 或 userData 无法覆盖这类引擎规则；复制根目录存档到 resources 产生双份进度维护问题；重打包违背游戏包完整性。

## 2. 保留原入口的主进程预载

**Decision**: 仅对启用的 profile，在 Electron 原始应用路径前传入固定 --require main-hook.js。该模块同步安装必要监听，然后由 Electron 自己完成包元数据与原始 main 的加载；不引入替代应用入口或手动加载 main。

**Rationale**: Electron 7.1.2 与 26.6.10 的 default_app 启动源码均在加载目标包前执行 --require 模块。这样保留原始应用路径、包名称与版本、主模块和窗口创建流程。进程参数增加的预载项须列入合成兼容测试；不能声称 argv 与未启用时相同。

**Alternatives considered**: bootstrap 应用再 require 游戏容易改变 getAppPath、require.main 或名称；NODE_OPTIONS 被现有 cleanEnv 清除；不使用未文档化的 app.setAppPath 来模拟原始启动。

Sources: [Electron 7.1.2 default_app](https://github.com/electron/electron/blob/v7.1.2/default_app/main.ts), [Electron 26.6.10 default_app](https://github.com/electron/electron/blob/v26.6.10/default_app/main.ts)。这是基于版本源码的接入选择，不是对所有发行包的兼容承诺。

## 3. 首读前生效，而非加载后补丁

**Decision**: 预载主模块在游戏 ready 监听注册前安装自己的 ready 监听，向受支持的默认 Session 添加固定 preload，并保留原 Session preload 列表。页面必须是已核验游戏入口、nodeIntegration=true、contextIsolation=false、非 sandbox 且使用默认 Session；不符合则拒绝本适配，不主动放宽权限或覆盖游戏 preload。

**Rationale**: 版本文档说明 Session preload 先于正常窗口 preload 执行。preload 必须在引擎赋值已知存储函数时同步绑定受控函数，覆盖首个同步调用，不能依靠 DOM 就绪、定时器或轮询。安装过程限定页面主框架和已识别文件页面，不向远程导航、子框架或其他窗口暴露文件能力。

适配 profile 校验页面加载顺序和函数形状；若初始化时机无法证明先于存档访问，或自定义 preload 在门禁前已经操作存档，则该 profile 不受支持。读写保护无法可靠安装时必须停用发布该组合，不能靠事后关窗口补救已发生的写入。

**Alternatives considered**: did-finish-load/executeJavaScript 太晚；CDP 注入新增调试器依赖和异步就绪竞态；替换 BrowserWindow 或游戏 preload 会扩大兼容影响。

Sources: [Electron 7.1.2 Session.setPreloads](https://github.com/electron/electron/blob/v7.1.2/docs/api/session.md#sessetpreloadspreloads), [Electron 26.6.10 Session](https://github.com/electron/electron/blob/v26.6.10/docs/api/session.md), [Electron context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)。文档证明 API 顺序，不证明具体游戏读取时序。

## 4. 有界 profile 与读取失败保护

**Decision**: profile 静态核对原始 main、首页脚本顺序、引擎存储函数特征及唯一的 projectID/configSave=file 声明；只解析受限的已知声明，不 eval 游戏元数据。源证据在扫描和启动时重新核对。缺失、冲突、动态声明、未知插件存储或不匹配窗口条件均拒绝启用。profile 必须覆盖原游戏已有的刷新/重新加载及受支持本地页面流转；每次加载使用独立页面代次重新安装保护，不沿用旧文档就绪消息。未知或远程页面不能获得存档能力。

profile 推导完整的已支持键集合与文件编码；只处理该游戏的文件，不扫描/备份所有 .sav。发现项目命名空间下未知存储文件或不受支持格式时拒绝，不能忽略后继续。限制为至多 128 文件、64 MiB/文件、256 MiB/集合；引擎识别所读每个文本文件最多 5 MiB，超限报错。

preload 在引擎赋值已支持存储方法时同步安装本地路径及受控读/写操作，并在原清档流程边界保护清空/删除和重置写入；只处理 profile 列出的键。已存在的受支持集合在任何写入前完成格式验证，不把读取/解码/解析失败交回会清档的原始异常恢复分支。失败锁定该进程全部受支持存档写入，向管理器报告并退出；写入时亦拒绝未知键、路径逃逸、符号链接、硬链接别名与目录身份变化。修改仅存在当前子进程，不改平台值、fs 模块或游戏包。

**Rationale**: 只安装赋值拦截器的 armed 状态不能报告 ready；必需方法全部接管、集合验证成功并建立保护后才报告就绪。只改 getExePath 不能满足 FR-008；引擎可能把读取失败当空值，并在后续覆盖旧进度。安全保证仅覆盖经过识别的存储路径，不是未知代码沙箱。

运行中写入使用同目录临时文件、校验/fsync/关闭后原子替换，不截断旧文件；替换后同步失败报告提交不确定并停止，保留备份，不自动回滚。根据用户在 2026-11-14 选择 B 的明确要求，清空/删除、刷新/重载均须保留原功能并验收；不能以首期禁用代替实现。清档前使用独立完成备份及 pendingClear 记录，操作完成后更新 seenKeys；中断保留恢复材料，读取异常后的自动重置仍拒绝。

**Alternatives considered**: 全局 fs 拦截影响其他资源；只校验 .sav 存在不足以判断引擎与格式；事后检测错误无法保证旧文件未覆盖。

## 5. 配置版本与候选确认

**Decision**: 新程序读取 schemaVersion 1/2，v1 不在 read/snapshot 时改写。首次明确保存存档策略时写 v2，并独立保留 v1 原件；缺失策略表示关闭。旧程序原有版本拒绝逻辑会阻止其读取 v2，避免无视新策略启动。

两候选位置用 install/resources 枚举，后端派生路径。scanToken 绑定配置 revision/token、游戏草稿与引擎证据、目录身份及两个完整文件快照。确认前重新扫描，变化拒绝；不信任 UI 指纹或任意路径。

正常保存会改变选定文件内容，不能使每次续玩都强制再次确认。长期保存目录身份、支持证据和未选候选的已确认快照；选定文件允许正常更新但启动前重新验证可读性/格式。未选候选新增或变化、已选目录被替换或已有存档异常消失时重新确认，不回退或合并。

空目录首次使用后，不能继续永久相信“初始为空”。按确认批次维护小型 SavePresence 键存在记录；首个新键写入前先原子保存记录，失败不写存档。后续缺失已知键或记录损坏要求核对，不猜测新游戏。合法清档完成后须按实际结果更新 seenKeys，且中断操作不能直接清空记录；正常刷新不得清除进程级 poisoned。无需每次保存都改 library.json 或新增持续备份。

**Alternatives considered**: 保持 v1 并增加未知字段会让回退行为不明确；把整个扫描内容哈希永久当不可变绑定会阻断游戏正常保存；忽略另一个目录变化会掩盖新冲突。

## 6. 备份事务与互斥

**Decision**: 复用配置 store 的 revision/token 和原子提交；在管理主进程使用一个覆盖配置写操作与启动准备的互斥标志，跨异步运行环境探测保持占用，Runner.busy 继续覆盖游戏进程阶段。准备启动与保存策略不能交错。

备份置于 .launcher/games/<id>/save-backups/<random-id>/。先创建私有临时目录、独占创建文件并校验内容 hash，fsync 文件及清单，完成后原子改名；配置只能引用完成且可验证的备份。单文件内容与前后元数据均核对，目录同步失败也视为未完成。全空集合也有完成清单。配置提交失败保留独立备份，不动源；不完整备份不算成功，不自动删除可能唯一的恢复资料。

**Rationale**: 单独 copyFile 不保证原子性；先完成备份再提交配置，不需要跨多文件分布式事务。主进程锁弥补 UI 锁无法阻止的 IPC 并发。此锁不声称能锁住玩家在其他程序中的写入；扫描/复制/启动前重查可检测变化，实测要求其他程序停止使用该目录。

**Alternatives considered**: 保存配置后再备份存在无备份启用窗口；直接覆盖备份路径会破坏恢复副本；每次启动自动周期备份超出范围。

Source: [Node 12 fs](https://nodejs.org/docs/latest-v12.x/api/fs.html#fs_fs_copyfilesync_src_dest_flags)。沿用 fs.open/fsync/rename，不使用新版 fs.cp/fs.rm。

## 7. 恢复与 UI 范围

**Decision**: 现有游戏设置面板增加“存档兼容”区域，沿用浅色卡片和森林绿按钮，不新增导航。支持状态只读，明确开关、候选单选、实际位置、备份说明和保存确认。取消不写；已保存位置在详情显示。

只提供按说明人工恢复，不新增存档恢复服务、云备份或管理中心。恢复前关闭游戏和启动器，完整备份当前受支持集合，核对游戏/来源/清单，按文件还原，保留所有副本；配置恢复不等于存档恢复。

**Alternatives considered**: 自动择新、自动合并、显示剧情进度优劣均没有可靠依据；任意目录选择扩大支持范围。

## 8. 子进程状态传输

**Decision**: 仅对启用会话增加 stdio fd 3 单向 pipe，由 main-hook 写有界 JSON 行，父进程逐行解析并验证 nonce/游戏/当前页面代次/状态；stdout/stderr 继续日志。页面与子主进程使用固定私有 Electron IPC 转发适配状态。

**Rationale**: 只需子进程报告就绪/失败，无需请求服务或双向 RPC；额外 pipe 不依赖 Electron 主进程是否初始化 Node process.send。

**Alternatives considered**: 从日志解析成功会与游戏输出混淆；Node IPC 初始化另有版本条件；本地 socket 服务增加无用生命周期管理。

Source: [Node 12 child_process stdio](https://nodejs.org/docs/latest-v12.x/api/child_process.html#child_process_options_stdio)。管道仅报告状态，不是对恶意游戏的认证。

## 9. 验证边界

**Decision**: 自有夹具模拟两种引擎函数/配置布局及原 main/preload 初始化标记；不复制商业引擎源码。两版本 Electron 做合成时序与错误验证，两个授权真实游戏隔离副本做续玩验收，三者各自记录证据。

**Rationale**: 普通 API 可用不代表真实游戏可用；进程已启动也不代表旧存档已读到。仅规划阶段不读取正式存档内容、不执行真实游戏。

**Alternatives considered**: 仅用本机 Node 测试、只看启动截图或把一个游戏成功推广到所有 Tyrano 均不足以验收。

## 10. 用户确认后的清档与重载范围

**Decision**: 保留原游戏的清档确认、作用范围及刷新/重新加载入口，不增加原游戏没有的清档管理功能。profile 需识别完整清档边界、涉及键和完成条件，而非把任意 delete 调用或读取失败当作玩家授权；接入代码、操作前备份、存在记录提交及中断恢复必须一起验证。

刷新/重载沿用已提交目录和进程互斥，新文档分配 documentGeneration，重新执行 guard、集合验证与握手，旧消息不能放行新页面。清档后合法缺失不误报，清档失败或进程 poisoned 不能通过重载绕过。本条原为设计判断；现已完成的实现与隔离验证见 validation.md，仍不推广至未知实现。

**Rationale**: 用户明确选择 B，首期也必须保留这些原功能；只提供路径补丁或禁用按钮不能满足交付要求。

**Alternatives considered**: 暂时禁止清档/刷新被用户否决；不备份直接删除或沿用旧页面 ready 会削弱已确认的数据保护。
