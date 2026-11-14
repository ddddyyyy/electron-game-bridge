# Tasks: 引擎存档路径兼容

**Input**: [spec.md](spec.md)、[plan.md](plan.md)、[research.md](research.md)、[data-model.md](data-model.md)、[契约](contracts/save-compat.md)、[quickstart.md](quickstart.md)。  
**Branch**: `002-engine-save-compat`  
**Status**: 实现与隔离验收完成；样本 A 的旧进度是系统/解锁数据，无非空旧剧情槽。详细边界见 validation.md。

## Format & execution rules

任务使用 `- [ ] Tnnn [P?] [USn?] 描述及路径`。路径相对于仓库根目录；新增文件会明确标注。`[P]` 仅表示在所属阶段前置条件完成后可与不同文件的任务并行，不表示跳过依赖。

沿用 JavaScript/CommonJS、Node 12 API、原生 DOM 和脚本交付；不增加包依赖、构建工具或插件平台。引擎规则留在 adapters，默认游戏库仍为空。测试先写出能揭示目标问题的断言，再实现；仅业务断言的预期失败可先记录，依赖加载异常不能代替有效失败证据。

存档保护是启用前置条件。合成应用与真实游戏验收分开；正式玩家存档不可用作测试输入、清理目标或公开夹具。运行环境或真实样本不可用时，关联验证任务保持未完成，记录原因，不降低标准或宣告通过。

## Phase 1: Setup — 基线与自有夹具

**Goal**: 记录已有普通游戏行为，准备完全自有的隔离样本；不初始化新的项目或迁移技术栈。

- [X] T001 执行既有 `tests/core.test.js`、自备 Electron 的 Node 模式检查及 `tests/library-smoke.js` 隔离入口，在新增 `specs/002-engine-save-compat/validation.md` 记录环境版本、原始入口/窗口/preload、argv/cwd/userData 基线及未执行项；不记录私人路径或真实存档。
- [X] T002 [P] 在新增 `tests/fixtures/tyrano-save/package.json`、`tests/fixtures/tyrano-save/main.js`、`tests/fixtures/tyrano-save/preload.js`、`tests/fixtures/tyrano-save/index.html` 和自有存储脚本中构造最小合成引擎；复现 macOS 目录推算差异、首个同步存档访问及初始化标记，所有进度只在测试根生成，不复制商业源码。

**Checkpoint**: 基线明确；夹具能在匹配运行环境中按原 main/preload 启动，并可制造两候选目录及故障。

## Phase 2: Foundational — 所有场景共用的安全基础

**Goal**: 证明首读前接入可行，再提供有界识别、版本化配置和完成备份事务。此阶段不向玩家开放兼容开关。

### 接入门槛与配置

- [X] T003 在 `tests/core.test.js` 增加引擎识别回归：唯一 projectID、file 模式、已知 main/脚本顺序/存储函数、未知或动态声明、5 MiB 文本上限、文件键越界；证明不能凭名称或 `.sav` 扩展名认定支持。
- [X] T004 在新增 `adapters/tyrano-save/profile.js` 实现固定内置 profile、有界只读识别、证据摘要、支持的完整键集合及格式校验；不 eval 游戏声明，不在 core 引用引擎内部对象，未知插件存储明确拒绝。
- [X] T005 在 `tests/library-smoke.js` 与 `tests/fixtures/tyrano-save/` 增加接入门槛用例（隔离驱动为 `tests/save-hook-smoke.js`）：原始主模块/应用路径/包身份和原 preload 保留、首个同步访问、刷新/重载代次重新接入与旧消息失效、guard require/安装/语法失败、缺失方法、隔离上下文/sandbox/定制 Session；断言失败后下一条页面语句不执行且存档零写入。
- [X] T006 在新增 `adapters/tyrano-save/main-hook.js` 实现可信 `--require` 主模块：先于原 main 注册 ready/失败监听，保留 Session preload 列表并添加固定 guard；验证默认 Session、主框架和有效窗口偏好，不替换游戏入口/preload、不放宽权限；为每次原刷新/重载分配并校验 documentGeneration，向固定 fd 3 报告有界状态。
- [X] T007 在新增 `adapters/tyrano-save/preload.js` 实现首读前同步方法赋值接管和 guard 致命失败处理；限定已识别页面/键，区分 armed 与 adapter-ready，尚未完成存档校验时读写门禁保持关闭；原刷新/重载及已识别本地页面流转每次分配新 documentGeneration 并重新接入，忽略旧代次消息，未知/远程页面不获得存档能力，不使用 dom-ready 轮询、全局 fs 或平台伪装。
- [X] T008 分别用 Electron 7.1.2、26.6.10 执行 T005 门槛，验证 fd 3 继承、主进程/renderer 时序以及原刷新/重载前门禁重新关闭、旧 ready 不复用，在 `specs/002-engine-save-compat/validation.md` 记录证据；任何组合不能保证首读前安装或失败零写入时，停止开放该组合，不能用修改游戏包或权限绕过。
- [X] T009 在 `tests/core.test.js` 增加 v1/v2、缺失/null 策略为关闭、未知字段与版本拒绝、升级原件另存、普通编辑保留策略及配置恢复回归，验证读取 v1 时字节不变。
- [X] T010 在 `core/config.js` 实现 schemaVersion 1/2 读取与策略校验；仅首次明确保存策略才写 v2 并独占保留升级前 v1 原件，沿用 revision/token、备份和原子提交；不吞掉畸形策略或通过删除字段伪装回退。

### 扫描与备份事务

- [X] T011 在新增 `tests/save-policy.test.js` 编写纯 Node 可运行的扫描、目录身份、令牌及备份断言：两个候选、摘要与集合变化、10 分钟过期、未知键/损坏格式、128 文件/64 MiB 单文件/256 MiB 集合限制、符号链接/硬链接/目录替换/跨游戏别名、open/write/close/fsync/hash/rename 及父目录同步故障。
- [X] T012 在新增 `core/save-policy.js` 实现固定 install/resources 候选扫描、目录真实身份、跨游戏归属检查及主进程临时 scanToken；绑定草稿/引擎/运行环境证据与配置 token、两处完整快照，最新令牌替代旧令牌，应用前重新扫描；UI 不提交任意路径或可信指纹。
- [X] T013 在 `core/save-policy.js` 实现私有随机目录中的完整集合备份、manifest、校验/fsync/完成改名及 SavePresence 原子初始化，并复用完成备份机制提供清档前 pre-clear 快照及归属信息；全空集合仍生成清单，配置仅可引用完成备份；配置失败保留独立备份，源存档不动，不完整资料不算成功也不自动清理。
- [X] T014 在 `library-main.js` 增加覆盖 saveGame/saveRuntime/restoreConfig/launchGame 准备阶段的单操作锁，跨异步探测保持占用，保留既有 sender/URL 校验和 Runner.busy；恢复配置使扫描令牌失效，运行中禁止产生新确认令牌，后端不依赖 UI 禁用按钮。

**Checkpoint**: T008 必须有合成证据，T009/T011 的安全断言通过后才能进入用户场景。锁不保护其他程序对游戏目录的外部写入；检测到变化必须拒绝，不能声称形成文件系统沙箱。

## Phase 3: User Story 1 — 使用游戏目录中的旧存档续玩 (P1)

**Goal**: 提供可独立演示的单候选安全续玩闭环；已完成的共用备份机制必须生效。

**Independent Test**: 只有安装根目录存在合成旧进度，启用并确认后完成读取、保存、退出、重启续读；两处为空时确认新进度位置。格式/接入失败不写入，普通入口不被替换。

### Tests first

- [X] T015 [P] [US1] 在 `tests/core.test.js` 增加启用描述与 Runner 契约断言：固定 --require 位于原入口前、原 cwd/userData/运行环境绑定不变、私有描述不可被 args/继承环境覆盖、fd 3 跨块/畸形/乱序/超限/就绪前 EOF、10 秒超时和终止前互斥。
- [X] T016 [P] [US1] 在 `tests/library-smoke.js` 增加 inspectSavePolicy/saveGame 契约及单候选 UI 闭环：扫描只读、旧存档明确确认、空目录默认 install、保存成功才启用、详情显示已提交位置；取消/失败保留输入，未确认不得发生存档写入。

### Implementation

- [X] T017 [US1] 在 `library-main.js` 与 `library-preload.js` 增加固定 inspectSavePolicy 操作及 saveGame 的 saveChoice 扩展；后端分配稳定游戏 ID、重新核对令牌、先完成备份/存在记录再提交配置；无 saveChoice 保留旧策略，新游戏默认关闭，前端不能注入 savePolicy 字段。复用基础层已实现的双候选显式确认与备份规则，不增加阶段开关；完整双候选界面/故障验收仍由 US2 完成。
- [X] T018 [US1] 在 `adapters/tyrano-save/preload.js` 完成受控文件存储：全部必需方法接管与集合格式验证后才 ready；首次新键先持久化 SavePresence，保存用同目录临时文件、完整编码/校验/fsync/关闭后原子替换；读取/解析失败永久 poisoned，游戏捕获异常后仍禁写，保留原清档确认及作用范围，先完成 pre-clear 备份与 pendingClear 记录，再受控删除/重置，完成后同步 seenKeys；取消/备份失败不清档，清档中断保留副本并禁写，读取失败后的自动清档仍拒绝，替换后同步失败报告结果不确定且不自动回滚。
- [X] T019 [US1] 在 `adapters/index.js` 与 `adapters/tyrano-save/main-hook.js` 组合已确认策略的启动描述、固定预载参数、0600 一次性描述和 nonce；只对启用游戏设置私有描述环境，未启用时清除继承残留；复核备份/存在记录、引擎证据、目录及未选候选基线，不能用原始启动静默回退。
- [X] T020 [US1] 在 `core/launch.js` 集成策略验证及 adapting 生命周期；仅启用会话新增 fd 3 单向状态管道，按契约限制单行 8 KiB/每次页面接入 64 KiB；状态消息核对当前 documentGeneration，原刷新/重载时保持 busy 并重新 adapting/握手，旧代次 ready 与 PID/armed 不当作当前就绪，超时/EPIPE/消息错误终止并等待退出后释放 busy，保留 stdout/stderr 日志及实际运行环境检查。
- [X] T021 [US1] 在 `ui/index.html` 与 `ui/styles.css` 的原游戏设置面板加入存档兼容开关、只读识别、单候选确认、备份说明和详情实际位置，沿用暖白/森林绿 C 风格，不新增导航、任意目录选择或恢复管理面板。
- [X] T022 [US1] 在 `ui/library.js` 接入扫描/确认/保存状态，丢弃旧异步响应和过期草稿令牌；显示扫描/备份/保存阶段，取消不提交、失败保留输入、停止后才可操作，并保持键盘/焦点/aria-live/textContent 与独立运行环境登记行为。
- [X] T023 [US1] 扩展并运行 `tests/save-policy.test.js` 与 `tests/library-smoke.js`，在两种 Electron 完成单候选/空集合续玩、首次新键存在记录失败、后续异常丢失、正常保存不反复确认、损坏后捕获异常仍禁写，以及临时文件写入/替换故障回归；覆盖原刷新/重载后的同目录续读、原清档取消/失败/成功后新进度与重启，刷新不能清除 poisoned；将结果写入 `specs/002-engine-save-compat/validation.md`。

**Checkpoint / MVP**: 单目录旧进度与新进度均可安全续玩；备份和失败保护不能从 MVP 裁掉。双候选冲突在 Phase 4 交付前保持明确拒绝。此里程碑仅是合成演示，不代表两个真实游戏验收通过。

## Phase 4: User Story 2 — 选择两处已有存档并保留恢复副本 (P1)

**Goal**: 在已有安全提交链路上开放双候选显式选择、位置变更及人工恢复说明。

**Independent Test**: 两候选中分别放入不同合成进度，选择任一处后只读写该处，未选目录逐文件摘要不变；取消/失败保持原配置与原文件，完成备份可恢复到启用前集合。

### Tests first

- [X] T024 [P] [US2] 在 `tests/save-policy.test.js` 增加两处相同/不同进度、仅 resources、scan 后内容变而 mtime 不变、源在备份时变化、新候选/目录身份变化、过期令牌及备份完成但配置失败用例，断言不自动择新、合并或覆盖；补充 pre-clear 备份失败、删除/重置中断及 seenKeys/pendingClear 提交故障，可从操作前副本恢复。
- [X] T025 [P] [US2] 在 `tests/library-smoke.js` 增加双候选及停止后更换位置/停用的 UI 与直接 IPC 契约测试：必须显式选择，展示文件名/时间，取消零写入，保存失败保持输入，恢复配置后重新核验；验证原游戏清档确认取消不改文件、成功只影响所选目录，刷新/重载后可读写新进度。

### Implementation

- [X] T026 [US2] 在 `core/save-policy.js` 完成双候选选择和长期冲突基线：同内容也不自动选择；正常选定文件更新可续玩，未选集合新增/变化或旧目录替换要求重新确认；仅 resources 有存档时确认该处，禁止空集合选择不存在目录。
- [X] T027 [US2] 在 `library-main.js` 与 `core/config.js` 扩展显式位置变更、重新确认及停用事务：重新备份后提交，保留旧备份，配置恢复不当作存档恢复；禁止无 saveChoice 的普通编辑丢失策略，也不信任已恢复配置中的过期备份引用。
- [X] T028 [US2] 在 `ui/index.html`、`ui/library.js` 与 `ui/styles.css` 开放两个候选的单选和文件/时间展示；有旧文件无默认选中，提示不合并、备份及停用后可能读取另一位置；保留同窗口布局、失败输入和焦点，不新增持久草稿或自动覆盖按钮。
- [X] T029 [US2] 按 `specs/002-engine-save-compat/quickstart.md` 在合成隔离集合演练人工恢复与 v2→v1 程序回退，将先保留当前进度、清单/hash 校验、多余存档另存、SavePresence 不匹配需重确认、未完成 pendingClear 还原核对及配置/存档分开恢复的实测结果和可复现步骤记录到 `specs/002-engine-save-compat/validation.md`；不新增恢复服务。
- [X] T030 [US2] 运行 `tests/save-policy.test.js` 的 Node 12 兼容与故障矩阵、`tests/library-smoke.js` 的双候选/取消/备份失败/配置失败/恢复交错回归，核对两种运行环境中未选集合和原配置保持不变，在 `specs/002-engine-save-compat/validation.md` 逐项记录通过或未执行。

**Checkpoint**: 两处存档可由用户选择；安全恢复可复现。单文件原子替换不能宣称多文件事务，备份也不是周期备份。

## Phase 5: User Story 3 — 同类游戏复用且普通游戏保持原有行为 (P2)

**Goal**: 证明同一适配能力可服务两个不同配置样本，并保持未启用应用的原有行为。

**Independent Test**: 两个不同 projectID/入口配置的样本及普通 Electron 应用依次启动，存档、备份与存在记录归属独立；两个真实样本另在授权隔离副本中完成续玩验收。

### Tests first

- [X] T031 [P] [US3] 在 `tests/fixtures/tyrano-save/` 增加第二种已识别布局/配置和初始化标记，沿用自有代码，通过测试时复制/参数化生成不同 projectID、安装路径与候选进度，不复制启动器或真实游戏源码。
- [X] T032 [P] [US3] 在 `tests/core.test.js` 增加普通/缺失策略/明确停用游戏的 argv、stdio、cwd、userData、初始化与环境清理对照；补充跨游戏规范目录别名冲突、策略字段保留、准备阶段重入和运行中保存/恢复拒绝断言。

### Implementation and acceptance

- [X] T033 [US3] 在 `adapters/tyrano-save/profile.js` 固定支持经门槛验证的第二种布局（须逐版本复用 T005 的首读/失败门槛，验证前不开放），在 `tests/library-smoke.js` 接入两个配置复用同一适配的顺序续玩与跨游戏归属断言；不在 `core/config.js` 或 `core/launch.js` 添加游戏名称判断，不为样本新增专属启动器。
- [X] T034 [US3] 分别在 Electron 7.1.2/26.6.10 运行 `tests/library-smoke.js` 的双合成样本/普通应用/未启用回归，验证停用、运行中锁定、原有清档/刷新/重载功能和逐页面保护、旧消息失效、合法清档后新进度、版本/数据绑定检查及独立运行环境登记未退化，结果写入 `specs/002-engine-save-compat/validation.md`；只验证受后续修改影响的用例，不无依据重复全部检查。
- [X] T035 [US3] 仅在真实样本隔离验证已有明确授权时，按 `specs/002-engine-save-compat/quickstart.md` 对两个真实游戏副本分别执行旧进度读取→新进度保存→退出→重启续读及备份恢复；对原本具备清档/刷新/重载功能的样本同时验收其取消、成功、新进度和重新加载，原无对应功能如实记录不适用；核对正式原件与未选集合不变，在 `specs/002-engine-save-compat/validation.md` 仅记样本 A/B、精确运行环境/profile 和结果。缺少授权、适配证据或样本时保持任务未完成，不以合成通过替代 SC-001，不强行用另一 Electron 版本启动真实游戏。

**Checkpoint**: 两个不同配置样本复用同一核心；普通与未启用应用基线保持。T035 未完成时不能宣告完整双游戏交付通过。

## Phase 6: Polish & cross-cutting concerns

**Goal**: 公开交付说明与可追溯验证，不加入新功能。

- [X] T036 [P] 在 `README.md` 更新存档兼容的启用/确认/实际位置、备份与恢复、停用和程序回退说明，明确支持矩阵、首次备份并非周期备份、原游戏清档/刷新/重载保留及操作前备份、未知页面不获得文件能力，不承诺任意引擎或跨平台存档必然兼容。
- [X] T037 [P] 在 `AGENTS.md` 同步实际已实现边界、真实可用检查入口和未完成验收状态，保留手动约束；不把规划或合成测试描述成真实游戏已通过，不引入新技术栈。
- [X] T038 汇总 `specs/002-engine-save-compat/validation.md` 的接入门槛、核心/Node 12、UI 双版本及 SC-001—SC-007 证据，只补跑后续变更影响的检查；逐项确认 `specs/002-engine-save-compat/quickstart.md` 可复现，保留不可执行项及限制。
- [X] T039 执行 `git diff --check` 与 `node scripts/audit-publication.js`，审查新增适配、夹具和 `specs/002-engine-save-compat/validation.md` 不含私人目录、真实存档/截图/游戏源码或凭据；审计在当前变更提交后须覆盖新增可达提交，记录结果，不自动推送。

## Dependencies & execution order

```text
Phase 1: T001 + T002
        ↓
Phase 2: T003 → T004 → T005 → T006 → T007 → T008（接入硬门槛）
         → T009 → T010 → T011 → T012 → T013 → T014
        ↓
US1: (T015 + T016) → T017 → T018 → T019 → T020 → T021 → T022 → T023
        ↓
US2: (T024 + T025) → T026 → T027 → T028 → T029 → T030
        ↓
US3: (T031 + T032) → T033 → T034 → T035
        ↓
Phase 6: (T036 + T037) → T038 → T039
```

- T001/T002 是共用基础，不能用另一个游戏的正式存档替代合成夹具。T008 完成前不开启业务适配；门槛失败须如实停止该组合并修订计划，不能绕过保护继续。
- US1 依赖完整 Phase 2，包括基础备份事务；US2 复用 US1 的提交/启动/界面链路；US3 复用 US1/US2 证明跨配置行为。三条场景分别有独立验收输入，但共享文件和安全链路决定其集成按序进行，不虚构场景间无依赖。
- T015/T016、T024/T025、T031/T032 均是不同文件的测试/夹具准备，可在所在阶段前置条件完成后并行。实现更改同一文件时按任务顺序串行，不同时编辑 `library-main.js`、`tests/library-smoke.js` 或同一个适配文件。
- T029 的恢复演练依赖已完成的双候选保存；先保留当前集合再演练，不提供新的自动恢复代码。T035 是完整交付验收门槛，受外部条件限制时其他可执行工作可继续，但不可将其勾选完成。
- Phase 6 的公开文档可在已完成实现上准备；T038 必须保留 T035 的未验证状态，T039 的最终结论须覆盖实际提交内容。后置自动提交不得把真实样本资料纳入 Git。

## Parallel examples per user story

| 场景 | 前置条件 | 可并行任务 | 文件分离 |
| --- | --- | --- | --- |
| US1 | Phase 2 完成 | T015 与 T016 | tests/core.test.js 与 tests/library-smoke.js |
| US2 | US1 完成 | T024 与 T025 | tests/save-policy.test.js 与 tests/library-smoke.js |
| US3 | US2 完成 | T031 与 T032 | tests/fixtures/tyrano-save/ 与 tests/core.test.js |

这些是执行机会说明，不要求多代理或新增工作树；实际可全部串行完成。

## Implementation strategy

1. 先取得接入硬门槛和普通应用基线；无法证明首读前保护时不开放功能。
2. 交付 US1 合成 MVP：一个明确候选或空集合，包含原始入口、完成备份、显式确认、持久键存在记录、原子保存与 poisoned 保护，并保留原清档和刷新/重载流程。不能用“只改路径”的演示代替 MVP。
3. 加入 US2 的双候选/位置变更与恢复演练；随后完成 US3 的两个不同配置复用及普通/停用回归。每阶段小步提交，沿用当前入口，不重写启动器。
4. 完成授权真实样本续玩后才判定 SC-001；最后汇总其余成功标准和公开审计。没有真实验收证据就清楚保留未完成状态，不能以 PID、armed、ready 或截图代替完整流程。

## Requirement coverage

| 需求 | 任务 |
| --- | --- |
| FR-001 | T003—T008、T033 |
| FR-002 | T009—T010、T017、T021—T022 |
| FR-003 | T005—T008、T018—T020、T023 |
| FR-004 | T011—T012、T016—T017、T024—T028 |
| FR-005 | T011、T013、T017、T024、T029—T030 |
| FR-006 | T016—T017、T024—T026、T030 |
| FR-007 | T014、T022、T025、T027—T028、T032—T034 |
| FR-008 | T007—T008、T011—T013、T018—T020、T023—T024、T026 |
| FR-009 | T012、T019、T031—T035 |
| FR-010 | T004、T019、T031—T034 |
| FR-011 | T006、T020—T022、T038—T039 |
| FR-012 | T025、T027—T029、T036 |
| FR-013 | T013、T018、T023—T025、T029、T034—T036 |
| FR-014 | T005—T008、T020、T023、T034—T035 |
| SC-001 | T035（真实样本，不由合成任务替代） |
| SC-002 | T024—T025、T030 |
| SC-003 | T011、T013、T023—T024、T029—T030 |
| SC-004 | T031—T035 |
| SC-005 | T016、T020—T023、T025、T028 |
| SC-006 | T018、T023—T025、T029、T034—T035 |
| SC-007 | T005—T008、T020、T023、T034—T035 |

## Generation validation

共 39 项：Setup 2、Foundational 12、US1 9、US2 7、US3 5、Polish 4；9 项带 [P]。初次生成时所有任务均为未完成；当前以各项勾选为准。任务包含顺序 ID、对应场景标签（仅场景阶段）及具体文件路径。只生成本文，不修改业务代码、测试夹具、运行配置或玩家数据。

本轮局部修订（2026-11-14）：按用户选择 B，取消“首期禁用清档/刷新/重载”的设计限制，将保留原功能及相应数据保护补入既有任务；39 个任务 ID、阶段归属和全部未完成状态保持不变。
