# Implementation Plan: 引擎存档路径兼容

**Branch**: `002-engine-save-compat` | **Date**: 2026-11-14 | **Spec**: [spec.md](spec.md)  
**Input**: 当前 Feature 的引擎存档路径兼容规格。

## Summary

为明确启用的受支持 Tyrano 文件存档游戏增加按引擎复用的适配。保留游戏安装包及原始主入口，通过受信任的启动前模块与 Session preload 在首次存档访问前安装路径和读写保护。玩家确认安装目录或 resources 目录；两处旧存档不合并，选定集合先备份，再原子提交配置。普通 Electron 游戏保持原启动参数和行为。

这是设计，不是兼容性通过记录。先验证接入时序与失败保护，再实现备份、配置和界面；未通过接入门槛的引擎/运行环境组合不得开放启用。

## Technical Context

**Language/Version**: JavaScript/CommonJS；共享代码兼容 Node 12 语法和 API  
**Primary Dependencies**: 现有 Electron、Node fs/path/crypto/child_process/assert、HTML/CSS/原生 DOM；无新增包依赖或构建工具  
**Storage**: 现有 .launcher/library.json；按游戏归属的私有存档备份、最小键存在记录及临时启动描述，不写游戏包或运行环境  
**Testing**: 现有tests/core.test.js、tests/library-smoke.js，增加自有合成引擎夹具、存档故障注入和隔离启动回归  
**Target Platform**: macOS；基线 Electron 7.1.2 x64，另以 26.6.10 x64 验证启动接入与合成夹具；真实游戏仍须匹配其精确版本  
**Project Type**: 桌面启动器，保持现有脚本交付  
**Performance Goals**: 扫描有明确的文件数和字节数上限；复用现有 10 秒运行环境探针；适配握手限 10 秒，超时退出并保持写入关闭；界面显示扫描/备份阶段，不伪造进度百分比  
**Constraints**: 游戏原始 main/preload/窗口权限不被替换或放宽；不读取正式玩家存档作开发测试；不持久修改游戏、共享 Electron，不伪造平台或全局拦截 fs  
**Scale/Scope**: 每游戏仅安装根目录和 resources 两个候选；首期至多 128 个受支持文件、单文件 64 MiB、每集合 256 MiB；超过限制明确拒绝，不能截断扫描或漏备份。不同配置的两个受支持样本和普通应用分别验收。

## Constitution Check

| Gate | 研究前 | 设计后与依据 |
| --- | --- | --- |
| 游戏包完整、原始入口 | 通过 | 使用 Electron 自身 --require 预载入口外的固定模块，随后仍由 Electron 加载原始 main；不解包改写、重打包或替换窗口 |
| 用户数据安全 | 通过 | 显式确认、独立完成备份、配置原子保存；不选目录不动；失败阻止写入；人工恢复先保护当前进度 |
| 自动化验证 | 通过 | 纯配置/备份故障测试与 Electron 隔离时序测试分开；真实样本结果另行记录 |
| 最小实现与复用 | 通过 | 复用 store、Runner、现有 IPC/设置面板；只增加所需引擎 profile，不建设插件平台 |
| 诊断与边界 | 通过 | 区分进程产生、适配就绪、存档可读及真实续玩验收；默认拒绝未知组合 |
| 核心解耦 | 通过 | Tyrano 元数据、文件名和页面对象逻辑只在 adapters；core 处理配置、事务和调度 |
| 渐进变更 | 通过 | v1 读入不改写，首次启用才写 v2；先时序门槛，再数据、IPC、UI；可停用并保留所有备份 |
| 技术与公开资料连续性 | 通过 | CommonJS/Node 12、现有 Electron 和交付；仅合成夹具入库，发布审计覆盖新提交 |

没有需要修订宪章的原则例外。原先普通游戏不注入兼容代码的行为仅按本 Feature 的明确启用范围扩展；不改写历史规格或声称旧实现已支持存档适配。

## Project Structure

### Documentation (this feature)

```text
specs/002-engine-save-compat/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/save-compat.md
└── checklists/requirements.md
```

后续由 speckit-tasks 生成 tasks.md，本阶段不生成任务清单。

### Source Code (planned changes)

```text
adapters/
├── index.js                    # 已有入口，组合显式存档策略
└── tyrano-save/                # 新增、内置固定引擎边界
    ├── profile.js              # 静态识别、文件集合、格式及支持条件
    ├── main-hook.js            # --require 主进程预载模块
    └── preload.js              # 页面首读前路径、读写门禁
core/
├── config.js                   # v1/v2、策略字段与恢复校验
├── launch.js                   # 已有调度、适配握手/失败生命周期
└── save-policy.js              # 目录身份、扫描令牌、备份事务
library-main.js / library-preload.js   # 固定 IPC 与主进程操作锁
ui/index.html / ui/library.js / ui/styles.css
tests/core.test.js /tests/library-smoke.js
tests/save-policy.test.js /tests/fixtures/tyrano-save/
README.md / AGENTS.md
```

**Structure Decision**: 延续根目录结构。引擎专属内容仅位于适配目录；备份与配置复用当前文件系统机制。新增三个适配文件分别运行于纯识别、子进程主线程、页面 preload，不为了扩展性增加框架。

## Phase 0 — Research decisions

详见 [research.md](research.md)。研究完成了设计选择：用 Electron 原生预载保持原入口；固定 profile 识别；首次存档访问前门禁；备份完成后才提交配置；旧配置默认关闭；固定 IPC 和现有浅色 C 风格设置面板。官方文档和源码只能证明机制存在，不能替代隔离时序测试。

## Phase 1 — Design

- [data-model.md](data-model.md)：策略、候选快照、备份与启动状态。
- [contracts/save-compat.md](contracts/save-compat.md)：管理 IPC、启用提交、子进程握手、页面交互与错误契约。
- [quickstart.md](quickstart.md)：实施后的检查入口、故障矩阵、隔离验收与人工恢复流程。
- 更新 AGENTS.md 的规划上下文；保留现有手动约束，明确受确认的内存存档适配边界。

## Phase 2 — Implementation sequence and release gates

1. **接入门槛先行**：用自有合成引擎复现安装目录/resources 差异。分别在两种 Electron 验证 --require、ready 注册顺序、Session preload、保留原 preload、首次同步读写和加载失败门禁。脚本/模块提前读写、隔离上下文、sandbox 或定制 Session 不满足 profile 时拒绝；不能改成 dom-ready 之后轮询补丁或自动降低窗口权限。刷新/重载时重新建立页面代次和首读前保护，不沿用旧就绪消息；清档与重载的完整回归通过后才可交付。门槛未过，不开放适配。
2. **数据与事务**：实现 v1/v2 兼容读取、纯扫描、主进程单操作锁、备份完成标记、最小键存在记录及原子配置提交；覆盖取消、源变化、备份失败与配置失败；运行中写入使用临时文件加原子替换，保留原清档流程：操作前复用完成备份机制，记录操作状态并同步存在记录，失败或中断保留恢复材料；不能禁用清档代替适配。v2 旧程序拒绝读取，回退须使用另存的 v1 配置，不能抹除新策略字段。
3. **调度与界面**：明确启用后才添加固定 --require 路径和私有启动描述；游戏设置加入兼容开关、候选单选、文件/时间及备份说明；详情显示已提交的实际位置。沿用焦点返回、纯文本输出和停止后编辑，不新增存档管理中心。
4. **回归与交付**：普通/禁用游戏参数逐项不变；两种运行环境完成合成回归；在明确授权的两个真实游戏隔离副本上完成旧进度读取与重启续玩。记录实际验证组合与限制后才宣告功能验收；更新 README，不提交真实游戏、存档或私人路径。

每阶段失败可停用策略并保留备份；停止运行后停用只改变下次启动，不自动搬移或恢复数据。配置恢复独立于存档恢复，下一次启动仍核对目录和备份。

## Complexity Tracking

无宪章违规或新增依赖。必要复杂度仅来自“首读之前生效”和“两份进度不覆盖”的已确认要求；拒绝延迟脚本注入、全局 fs 重定向、目录重打包和自动合并方案。

## Requirement traceability

| 需求 | 设计/验证落点 |
| --- | --- |
| FR-001、FR-003 | 固定 profile、原入口预载、首读前门禁；两版本接入门槛 |
| FR-002、FR-007 | v1/v2、显式开关、停止后保存/停用、取消和互斥 |
| FR-004、FR-006 | 两候选、scanToken、完整集合选择、不自动移动或合并 |
| FR-005 | 完成备份先于配置提交；恢复说明及故障注入 |
| FR-008 | 持久键存在记录、poisoned、原子写入和失败终止 |
| FR-009、FR-010 | 目录身份/归属、引擎边界、普通和双游戏回归 |
| FR-011、FR-012 | 分阶段错误、详情位置、停用/恢复说明、发布审计 |
| FR-013 | 游戏原清档流程、操作前备份、清档状态/存在记录同步、中断恢复及新进度回归 |
| FR-014 | 逐页面代次重新接入、旧消息失效、刷新/重载后同目录续玩 |
| SC-001—SC-007 | quickstart 的真实样本续玩、合成故障矩阵、未选集合不变与普通应用对照 |
