# 漂流瓶 Bridge：开发 Agent 接入手册

> 用法：把本文件整体交给你的 Coding Agent，再说明要接入的项目和目标功能。本文可以独立使用，不要求 Agent 读过之前的聊天或其他手册。
>
> 读者是**编写接入代码的 Agent**。接口中的普通“Agent 权限”是一个 API 权限名称，并不代表开发 Agent 已经获得真实寄信、开启高危开关或读取密钥的授权。

核对日期：2026-11-14。插件：`cortico-world-bottle`，客户端版本 0.9.3，HTTP API 版本 1；本版自主阅读与表达留存不改变 Bridge 路由与字段。后续版本以实际源码/响应为准；插件软件版本与 `apiVersion` 不同。

## 0. 给 Agent 的任务入口

你正在为另一个项目接入“漂流瓶”插件。先阅读本文，再检查目标项目已有结构，沿用其语言、配置、日志、错误处理和测试方式。你的默认交付是一个可审查的接入模块；文档本身不要求你安装插件、重启用户桌宠、打开高危权限或执行真实发送。

请用户在给你的任务中填写这些信息；已有项目配置可回答的，先从项目中确认，不重复询问：

```text
目标项目：<仓库路径或现有应用>
想做的功能：<例如状态小组件、待审草稿投递、人工确认发送、请求桌宠回信>
运行位置：<桌宠同机后端 / 浏览器前端 / 云端服务 / 容器>
可用权限：<普通 Bridge / 另有 Controller / 尚未启用>
发现文件位置：<实际部署数据目录中的 bottle-bridge.json>
密钥注入方式：<环境变量或项目现有 secret manager；不要把真实值贴给 Agent>
本次验收：<默认 mock + 只读联通；如需真实操作，单独写清范围>
```

若只缺真实服务、发现文件或密钥，你仍可完成客户端、配置模板、mock 测试和本地运行说明，明确指出真实联通尚未验证。不要生成假的“联通成功”或“已寄出”结果。

## 1. 先理解插件

漂流瓶是 Cortico / Coopanion 的 World 扩展：桌宠起草短信，人决定是否寄出；陌生人的信在中央“海边”匿名漂流。本机 World 保存自己的草稿与信册，并提供独立网页、Windows 卡片和可选 Bridge。

Bridge 是**正在运行的本机 World 上的一组 HTTP API**，复用其业务逻辑。它不是中央海边 API，不控制整个桌宠，不提供任意点击网页或任意文件访问能力。

三个目标必须分开：

| 目标 | 正确入口 |
| --- | --- |
| 外部项目查询状态、提供一份待审新信 | 普通 Bridge |
| 可信控制程序预览草稿、确认发送、请求桌宠共读/回信 | 另启用 Controller |
| 桌宠在聊天中自主读信和处理草稿 | 无头工具；与 Bridge 是不同入口 |

**不要把 `bottle_write/bottle_reply/bottle_send_draft` 等模型工具名拼成 HTTP 路径。** Bridge 不等于把模型工具逐个暴露出来。

### 权限矩阵

| 能力 | 普通 Bridge 凭证 | Controller 凭证 |
| --- | --- | --- |
| 普通状态、新信稿创建、打捞 | 对应普通路由可用 | 不能调用普通路由，需另配普通凭证 |
| Controller 状态与归档 ID 目录 | 不可用 | 可用 |
| 指定草稿全文预览 | 不可用 | 可用 |
| 指定版本发送/放弃，请桌宠重写 | 不可用 | 可用 |
| 请求指定信共读/回信、归还/收好 | 不可用 | 可用 |
| 任意读信全文、批量导出信册 | 不提供 | 不提供 |
| 写入小纸条正文、修改设置、开启无头 | 不提供 | 不提供 |

普通 Bridge 足够时，接入项目不应依赖 Controller。Controller 不需要开启无头；无头开启也不会自动授权 Bridge。

玩家设置以“聊天里处理信件”说明原无头模式，技术键 `headlessEnabled` 不变。v2 信册含纸条和失效留稿属于本机备份能力，不是新增 Bridge 批量读取/发送接口。`sendFailure:'expired'` 的稿只能查看/放弃，不能因正文保留而恢复投递资格。

## 2. 部署与连接契约

### 插件侧前提

插件已安装，漂流瓶 World 已激活，并在部署配置中合并：

```json
{
  "worlds": {
    "bottle": {
      "enabled": true,
      "bridgeEnabled": true,
      "bridgeControllerEnabled": false
    }
  }
}
```

需要 Controller 时，操作员另外开启 `bridgeControllerEnabled:true`。这些是插件已有字段，不要替换整个部署配置。启用桥接后需重启 World 完成初始化；加载新版插件代码通常需完整重启宿主。关闭桥接开关会立即拒绝相应新请求。

不要因为用户要求“接入代码”，就自动修改真实部署设置或重启其正在运行的桌宠。

### 地址发现

操作员提供实际部署数据目录中 `bottle-bridge.json` 的路径。内容示例：

```json
{
  "apiVersion": 1,
  "baseUrl": "http://127.0.0.1:7796/api/v1",
  "credentialSecret": "BOTTLE_BRIDGE_TOKEN",
  "controllerAvailable": false,
  "worldSession": "opaque-session-marker"
}
```

- 不硬编码端口：从 7796 开始，占用会顺延，跳过 7797。发现文件的 `baseUrl` 才是当前地址。
- 不猜数据目录：它由宿主 `ctx.dataDir` 决定，不是 npm 包目录或静态网站目录。
- `baseUrl` 已含 `/api/v1`；Controller 基址为其后追加 `/controller`。
- `credentialSecret` 是 secret 名称，不是 secret 值。
- `controllerAvailable` 是能力提示，实际请求仍须检查权限和状态；不能据此认定 token 已配置。
- `worldSession` 是本轮运行标记，不是登录 token。World 重启后重新发现地址，不继续使用旧会话的操作上下文。
- 正常停止会删发现文件，异常退出可能残留。文件存在不等于服务在线。
- 校验 `apiVersion===1`，不支持时明确报错，不自动猜新协议。
- 校验地址为 HTTP 回环 `127.0.0.1` 或 `localhost`、显式有效端口、根路径 `/api/v1`，无账号、查询参数或 fragment。不要把发现文件中的任意 URL 当作可携带 token 的请求目标；拒绝自动 HTTP 跳转。

### 凭证

| 名称 | 插件存放方式 | 调用方用途 |
| --- | --- | --- |
| `BOTTLE_BRIDGE_TOKEN` | 首次启用自动生成，经宿主写入部署 `.env` | 普通路由的 Bearer token |
| `BOTTLE_BRIDGE_CONTROLLER_TOKEN` | 首次启用 Controller 自动生成，独立 secret | Controller 路由的 Bearer token |

操作员将对应值注入接入项目的环境变量或 secret manager。不要把整个宿主 `.env` 复制进新项目、读取所有无关秘密、把 token 发给模型、写入前端 bundle、日志、URL 或仓库。

手工预设时两种 token 必须不同、各至少 32 字符且无空白。一般保留插件自动生成值即可。海边身份 `BOTTLE_PROD_TOKEN`、LAN 配对 `BOTTLE_LAN_PAIRING_TOKEN` 和固定请求头 `x-bottle:1` 均不能替代 Bridge 凭证。

插件原生面板 invoke 有 `mailbox / bridge/credentials` 与 `mailbox / bridge/controller-credentials`，但它们不是本 Bridge 的 HTTP 密钥接口，也没有自带的“复制密钥”按钮。通用接入客户端不要依赖宿主内部面板路由取密钥。

### 运行位置

```text
同机可信后端 / CLI / 本地服务
  └─ Bearer HTTP → 127.0.0.1:<发现的端口>/api/v1

浏览器 UI
  └─ 项目自身的已鉴权后端 → Bridge
```

本 Bridge 不接受浏览器 Origin，不做 CORS 放行，不从手机配对 LAN 监听提供。浏览器项目需要后端；不要为“能调用”而删除 Origin、偷偷绕同源或把 token 放网页。

云端进程的 `127.0.0.1` 不是用户桌宠电脑；容器的回环通常也不是宿主。若运行位置不同，需要另行设计明确授权的同机伴随进程/通信方案；本文没有提供公网 Bridge、远程隧道或代理网关。不要声称改一个 URL 就完成远程接入。

## 3. HTTP 公共规则

- 使用 `Authorization: Bearer <本路径对应token>`，`Bearer ` 前缀按此大小写发送。
- POST JSON 使用 UTF-8 和 `Content-Type: application/json`；GET 不带请求体。
- Host 仅接受实际端口上的 `127.0.0.1:端口` 或 `localhost:端口`。不要伪造 Host。
- 不带 `Origin`；存在 `Sec-Fetch-Site` 时仅接受 `none`。不添加 CORS workaround。
- 请求体最大 **40960 字节（40 KiB）**，是 UTF-8 编码后整个 JSON 的大小。
- 正文去首尾空白后 1—120 个 Unicode 码点，标题非空时 1—20 码点且单行。JS 按 `[...text.trim()].length` 计数，不用 UTF-16 `.length` 作为正文码点数。
- `source` 为调用程序真实名称，非空、最多 64 个 JS 字符单元，无 U+0000—U+001F/U+007F；按普通短名称填写。它是自报来源，不能充当身份或审批。
- 不传接口未列出的字段；POST 白名单严格拒绝未知字段。
- 只有在 HTTP 状态与响应 `ok` 都符合预期时报告成功；异步邀请成功不代表模型已完成。
- 响应按不可信输入处理，展示正文用纯文本，不把标题、正文、署名或 SVG 拼成可执行 HTML。

## 4. 数据结构

以下 TypeScript 是响应模型说明，不能仅靠类型断言替代运行时校验。额外响应字段可保留兼容，必须校验的 ID、版本等字段须检查。

```typescript
type DraftKind = 'letter' | 'reply';
type DraftRef = { draftId: string; revision: number };
type DraftMeta = DraftRef & {
  kind: DraftKind;
  chars: number;
  createdAt: string;
  sendPolicy: 'manual' | 'delayed';
  sendFailure?: 'expired';
  source?: { kind: 'bridge'; name: string };
};
type HeldMeta = {
  letterId: string;
  from: string;
  seed: boolean;
  dead: boolean;
  expiresAt?: string;
  source?: string;
};
type Status = {
  ok: true;
  apiVersion: 1;
  online: boolean;
  capabilities: { stationery: boolean; stationeryLayout: boolean };
  quota: null | { bottlesLeft: number; catchesLeft: number; repliesLeft?: number };
  held: HeldMeta | null;
  drafts: DraftMeta[];
};
type DraftPreview = DraftMeta & {
  body: string;
  topic?: string;
  stationery?: unknown; // 可按第 6 节进一步建模并运行时校验
  letterId?: string;
};
type Failure = { ok: false; error?: string; message: string; draft?: DraftMeta };
```

`online` 仅是最近海边通信结果，不是当前联通保证。`quota` 可能未获取，`repliesLeft` 可能由旧海边省略。状态不含正文、标题、SVG、路径、凭证。`sendFailure:'expired'` 为保留在本机的失效回信稿，只能看/放弃，不能寄出/重写。

ID 必须来自当前响应：

- `draftId`：草稿身份；用于预览、发送、重写、放弃。须匹配 `[A-Za-z0-9_-]{1,128}`。
- `revision`：当前正安全整数；草稿内容/来源改变使版本变化，旧确认失效。
- `letterId`：信件身份；用于回信、一起看、归还、收好。不能用 draftId 代替。
- `letter/reply` 是类型；`held` 是某些模型工具的别名；QQ 消息编号是聊天引用。三者都不是 Controller 的真实信件/草稿 ID。

## 5. 所有 HTTP 接口

以下均为完整路径；拼接发现文件 `baseUrl` 时，请去掉表内已包含的 `/api/v1`，不要重复追加。

### 普通权限

| 方法 | 完整路径 | JSON 输入 | 成功响应/副作用 |
| --- | --- | --- | --- |
| GET | `/api/v1/status` | 无 | 200，`Status`；元信息 |
| POST | `/api/v1/drafts` | `source,body`，可选 `topic,stationery,replace` | 201，`{ok:true,draft,requiresHumanReview:true,decorationDelivery?}`；仅保存待审新信稿 |
| POST | `/api/v1/catch` | 仅 `source` | 200，`{ok:true,held,quota}`；打捞一封，消耗相应额度 |

`drafts` 不创建回信/小纸条，不发模型事件、不寄出。有新信稿时为 409；明确替换必须用刚查询到的新信稿 `replace:{draftId,revision}`，不能指向回信槽。无题时省略 `topic`。

`catch` 的正文只留本机信箱，**不会在响应中返回**，无头开启也不会自动将 Bridge 打捞正文递给桌宠。请求共读或回信应按下面 Controller 流程。

新信示例：

```json
{
  "source": "MyProject",
  "body": "想把今天的一点好奇心寄给海上来客。",
  "topic": "好奇心",
  "stationery": {"v":2,"paper":"line","doodle":"paper-plane","color":"#638c9c"}
}
```

明确替换示例，ID 和版本须换成运行时最新值：

```json
{
  "source":"MyProject",
  "body":"整理后的新信。",
  "replace":{"draftId":"runtime-draft-id","revision":2}
}
```

### Controller 权限

| 方法 | 完整路径 | JSON 输入 | 成功含义 |
| --- | --- | --- | --- |
| GET | `/api/v1/controller/status` | 无 | 200，普通状态加 `letters` ID 目录 |
| GET | `/api/v1/controller/drafts/:draftId` | 无 | 200，`{ok:true,draft:DraftPreview}`，只给指定稿 |
| POST | `/api/v1/controller/send` | `source,draftId,revision`，可选 `kind` | 200，按所确认版本真正寄出 |
| POST | `/api/v1/controller/rewrite` | 同上 | 200，仅请求桌宠重写，等待模型完成 |
| POST | `/api/v1/controller/discard` | 同上 | 200，放弃该版本；定时稿需先取消海边保护 |
| POST | `/api/v1/controller/reply` | `source,letterId` | 200，仅邀请为当前持信起草 manual 回信 |
| POST | `/api/v1/controller/together` | `source,letterId` | 200，邀请共读当前持信或归档往来，只读 |
| POST | `/api/v1/controller/return` | `source,letterId` | 200，归还当前持信，遵守海边规则 |
| POST | `/api/v1/controller/keep` | `source,letterId` | 200，复用原有收好规则，不能任意永久占信 |

Controller status 的目录形状：

```typescript
type Letters = {
  received: { letterId: string; from: string; outcome: string }[];
  sent: { letterId: string }[];
  replies: { letterId: string; from: string }[];
};
// GET controller/status → Status & { letters: Letters }
```

七种 Controller POST 成功通常为 `{ok:true,message,source}`；不是草稿预览响应。业务失败可能只给 `{ok:false,message}`，无 `error`。

- `send/rewrite/discard` 的可选 `kind` 只能 `letter/reply`，填了须匹配稿件。**不接受新正文/标题/装饰**。
- `rewrite` 是请桌宠重写，不是外部程序直接写入新内容；Bridge 没有“用任意文本改写回信稿”的 API。
- `reply` 仅限当前普通有效持信，不能回复系统信、死亡信、无正文信；已有回信稿时先按版本重写或放弃。
- Controller 回信新稿为 `manual`，不会因为请求回信开始两小时自动寄出。
- 已有桌面 `delayed` 稿被重写，保留原倒计时；Controller send 可提前真正寄出，不能认为“都要等两小时”。
- `together` 不在 HTTP 响应中返回信件正文，正文作为外部事件交给桌宠；不授权其起草回信。
- 不支持对 Controller `reply/together` 额外传“自定义提示词”“角色”“正文”等字段。

## 6. 可选信纸和装饰

不需要装饰时省略 `stationery`。装饰不占正文 120 码点，但受请求和 SVG 大小约束。新接入使用 `v:2`；v1 是旧格式兼容。

| 字段 | 允许值 |
| --- | --- |
| `v` | 1 或 2；复杂排版用 2 |
| `paper` | `grid/line/plain` |
| `paperColor`、`color` | 六位 `#RRGGBB`；纸色仅 v2 |
| `doodle` 或 `customSvg` | 每幅二选一：已存在素材 ID / 受限静态 SVG |
| `placement` | top-left/top-right/bottom-left/bottom-right/center，默认 bottom-right |
| `size` | small/medium/large → 纸宽 14%/24%/48%，默认 medium |
| `x,y` | 图框中心，纸宽/高百分比 0—100 |
| `width` | 纸宽百分比 4—100，覆盖 size |
| `rotation` | -180—180 |
| `opacity` | 0—0.65，默认 0.28 |
| `layer` | behind/front，默认 behind；前景整层额外限制透明度为 0.35 |
| `z` | 同层顺序 0—7 |
| `flipX,flipY` | 布尔 |
| `decorations` | 最多 8 幅；不能和根级单图字段混用 |

单幅净化后自创 SVG ≤8192 字节，自创图合计 ≤16384 字节，排版 JSON ≤32768 字节；整个 HTTP JSON 仍 ≤40960 字节。禁止脚本、外链或不受支持的 SVG 特性。内置图不指定色时使用该插件的稳定本机画笔色；自创图不指定色保留原色。

普通 API **没有素材查询路由**。不要杜撰 `/doodles`；可使用本文已验证示例 ID `paper-plane`，或由操作者/插件素材目录提供可用 ID。内置信只传 ID，收信端也需有素材；跨版本新图可考虑合规自创 SVG。

`capabilities.stationery` / `stationeryLayout` 是海边能力提示，最终以动作回执为准。旧海边降级时 `decorationDelivery` 可能为 `legacy_single_doodle` 或 `plain_text_on_unsupported_server`；完整投递省略该字段。本地保留的完整图案不保证对方旧客户端能显示。

## 7. 推荐集成流程

### A. 仅状态展示

1. 发现并校验本机地址。
2. 用普通 token 请求 `/status`。
3. 显示 online、额度、持信和稿件摘要；把 null 与缺省字段显示为未知。
4. 支持手动刷新。若要轮询，接入项目可从 5—15 秒开始并合并并发；这是接入方建议，不是插件规定的周期或 SLA。
5. 失联显示不可用，重新发现，不伪造“海空”或“寄信成功”。

### B. 投入待审新信

本项目生成文本 → 本地字数/字段校验 → 普通 POST drafts → 显示“已保存，等待审阅”。这不需要 Controller。遇 409 展示现存稿；不自动取得最新 revision 覆盖。

### C. 外部界面确认发送

Controller status → 选真实 draftId → GET preview → 以纯文本向人展示完整正文/标题及装饰 → 人确认**这一版** → POST send 同一 draftId/revision → 核对结果。

确认上下文保存 `worldSession,draftId,revision`；会话变化或稿件变化后使本地确认失效。不要静默刷新 revision 后把旧按钮变成新稿确认。source 不是审阅凭据；“写一封”“这封你回吧”“重写”都不是发送确认。

### D. 打捞后请桌宠回信

普通 catch → 取返回 held.letterId → Controller reply → 显示“已请求起草” → 等正常轮次结束、以适度查询确认新回信稿出现 → preview → 单独确认 → send。

不能把 reply 的 200 当作稿件已生成；模型可失败、拒绝或暂停，状态也可能因其他操作变化。不存在任务进度查询、webhook 或 SSE Bridge 接口。等待应可取消、有上限，不无限轮询/自动再次邀请。

若只想一起读，调用 together。读信不会返回正文给集成项目；不要在缺少 API 时转而抓取私有网页正文或读取本机账本绕过权限。

## 8. 错误、并发和重试

| 情况 | 处理策略 |
| --- | --- |
| 400 | 修正 JSON、白名单、字数、目标、版本格式或装饰；不原样重试 |
| 401 | 凭证缺失/错误/权限用错；不把 Controller token 当普通 token 重试 |
| 403 | Host/Origin/Fetch Metadata；调整运行架构，不绕网页限制 |
| 404 | 未启用、未重启、服务已停、错路由或稿件不存在；按上下文重读发现文件并核对配置 |
| 405 | 修正 HTTP 方法 |
| 409 | 版本/持信/忙碌/额度/空海等业务冲突；显示原因，必要时重查，不自动强制覆盖 |
| 503 或断连/超时 | 动作结果可能未知；先核对状态，不盲重放写请求 |
| 2xx 但 JSON 错/ok 非 true | 协议异常或失败，不能报成功 |

不要依赖某段中文错误字符串作为稳定枚举。`error` 可缺省，主要看 HTTP、ok 和当前上下文，message 用于解释。

安全重试只默认用于只读 GET，并限制次数、间隔和总时间。Bridge 没有通用 Idempotency-Key；不要自行添加未知 JSON 字段假装幂等。POST send/drafts/catch 超时后不自动重放。状态查询也未必足以自动证明“某稿消失就是发送成功”，它可能被放弃，须进一步核对信箱/交由操作者处理。

客户端按目标串行化修改动作，UI 防重复点击；服务端仍会执行锁和版本校验。自动阅读/正在共读、写作或寄送的轮次可能返回 409，不能用切换开关来绕过。

## 9. 最小 Node.js / TypeScript 传输模块

这是接入项目的可复制起点，不是新增的官方 npm SDK。Node.js ≥22；TypeScript 项目需其常规 Node 类型依赖。仅封装本文已有路由，返回 `unknown` 由上层验证；构造函数不发请求。

`BOTTLE_BRIDGE_DISCOVERY_FILE` 是**本文建议的接入项目环境变量**，用于指定发现文件路径；它不是漂流瓶新增的配置项。两个 TOKEN 变量承载操作员注入的对应 secret。

```typescript
import { readFile } from 'node:fs/promises';

type Scope = 'agent' | 'controller';
type Ref = { draftId: string; revision: number };
type Action = 'send' | 'rewrite' | 'discard';
type LetterAction = 'reply' | 'together' | 'return' | 'keep';
type Proposal = { body: string; topic?: string; stationery?: unknown; replace?: Ref };

export class BottleBridge {
  constructor(
    private readonly discoveryFile: string,
    private readonly source: string,
    private readonly agentToken: string | undefined,
    private readonly controllerToken?: string,
  ) {
    if (!discoveryFile || !source.trim() || source.length > 64 || /[\x00-\x1f\x7f]/.test(source)) {
      throw new Error('Bridge discovery path and a valid source name are required');
    }
  }

  private async request(scope: Scope, method: 'GET' | 'POST', path: string, body?: unknown) {
    const raw: unknown = JSON.parse(await readFile(this.discoveryFile, 'utf8'));
    if (!raw || typeof raw !== 'object') throw new Error('Invalid Bridge discovery');
    const record = raw as Record<string, unknown>;
    if (record.apiVersion !== 1 || typeof record.baseUrl !== 'string') {
      throw new Error('Unsupported Bridge discovery version');
    }
    const base = new URL(record.baseUrl);
    if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname)
        || !base.port || base.pathname !== '/api/v1' || base.username || base.password
        || base.search || base.hash) throw new Error('Bridge address must be loopback API v1');
    const token = scope === 'controller' ? this.controllerToken : this.agentToken;
    if (!token) throw new Error('Required Bridge credential was not configured');
    const data = body === undefined ? undefined : JSON.stringify(body);
    if (data !== undefined && Buffer.byteLength(data, 'utf8') > 40960) {
      throw new Error('Bridge JSON exceeds 40 KiB');
    }
    const response = await fetch(base.href + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: 'Bearer ' + token,
        ...(data === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
      },
      body: data,
    });
    const json: unknown = await response.json();
    // Preserve HTTP + body for the caller. Never log the request or token here.
    return { status: response.status, httpOk: response.ok, json };
  }

  status() { return this.request('agent', 'GET', '/status'); }
  createDraft(proposal: Proposal) {
    return this.request('agent', 'POST', '/drafts', { ...proposal, source: this.source });
  }
  catchOne() { return this.request('agent', 'POST', '/catch', { source: this.source }); }
  controllerStatus() { return this.request('controller', 'GET', '/controller/status'); }
  preview(draftId: string) {
    this.checkRef({ draftId, revision: 1 });
    return this.request('controller', 'GET', '/controller/drafts/' + draftId);
  }
  draftAction(action: Action, ref: Ref) {
    if (!['send', 'rewrite', 'discard'].includes(action)) throw new Error('Unknown draft action');
    this.checkRef(ref);
    return this.request('controller', 'POST', '/controller/' + action,
      { source: this.source, draftId: ref.draftId, revision: ref.revision });
  }
  letterAction(action: LetterAction, letterId: string) {
    if (!['reply', 'together', 'return', 'keep'].includes(action)) throw new Error('Unknown letter action');
    if (!letterId || letterId.length > 256 || /[\x00-\x1f\x7f]/.test(letterId)) {
      throw new Error('Invalid letter ID');
    }
    return this.request('controller', 'POST', '/controller/' + action, { source: this.source, letterId });
  }
  private checkRef(ref: Ref) {
    if (typeof ref.draftId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(ref.draftId)
        || !Number.isSafeInteger(ref.revision) || ref.revision < 1) throw new Error('Invalid draft reference');
  }
}

// Example construction only: no automatic request, catch, draft creation or sending.
export function bridgeFromEnvironment() {
  return new BottleBridge(
    process.env.BOTTLE_BRIDGE_DISCOVERY_FILE ?? '',
    'MyProject',
    process.env.BOTTLE_BRIDGE_TOKEN,
    process.env.BOTTLE_BRIDGE_CONTROLLER_TOKEN,
  );
}
```

该模块不实现人的确认 UI、响应 schema 校验、幂等恢复或应用层状态机，集成时必须按功能补齐。超时、JSON 解析、发现文件错误会抛异常，调用方应转换成可理解的不可用/结果待核实状态，不显示带 Authorization 的调试转储。

修改项目已有客户端时，不必逐字复制此类；可以使用现有 HTTP 库，但保留双凭证、地址校验、无自动跳转、超时、响应检查、POST 不盲重试等约束。

## 10. 实施顺序和验收

按用户已授权的接入范围执行：

1. 阅读目标项目说明，定位配置/后端服务层；列出所需 API 和最小权限。
2. 增加发现文件路径与 secret 注入说明，`.env.example` 只放变量名/占位，不放真实值。
3. 封装单一 Bridge 客户端，UI 不直接持 token，不复制宿主存储逻辑。
4. 先接状态与业务错误，再接选定写操作。Controller 发送单独连到审阅/确认交互。
5. 使用 mock 完成下表相关验证。真实联通默认只 GET status；真实写操作按用户明确授权范围进行。
6. 交付实际改动、配置方式、运行命令、通过项与未验收项。不要自动提交、发布或重启其他应用。

| 验证点 | 预期 |
| --- | --- |
| 发现文件不存在/损坏、apiVersion 未支持 | 可理解的未连接，不扫描全盘找密钥 |
| 端口变化/World 重启 | 重新发现；旧 session 的确认失效 |
| 非回环地址、URL 账号或跳转 | 拒绝把 token 发往其他目标 |
| 仅普通凭证 | 状态/提案可用；控制功能明确不可用 |
| Controller 与普通凭证混用 | 401 正确呈现，不混合重试 |
| quota=null、缺 repliesLeft、held=null | 正确显示未知/没有持信 |
| 创建新稿 201 | 显示等待审阅，不表示已寄出 |
| 已有稿 409 | 原稿不被自动覆盖 |
| 预览后版本变化 | 旧确认拒绝，要求重新审阅 |
| reply/rewrite 返回 200 | 显示邀请已接收，等待/取消可用 |
| 自动阅读或忙碌 409 | 不绕锁、不过度轮询 |
| POST 超时/断连 | 结果待核实，不盲重发 |
| GET 不返回正文 | 不编造缺失内容、不从私有账本补读 |
| 异常/日志/前端打包 | 不出现 token、完整请求头或未授权正文 |

不需要为文档说明去执行真实寄送。要验证 HTTP 路由可用，可用目标项目自己的 mock 或插件仓库既有 Bridge 测试；不要对用户真实信箱“随便发一封测试”。

## 11. 禁止猜测的能力

当前没有以下 Bridge API，开发时不要杜撰或写成已支持：

- `/health`、`/login`、`/token`、`/config`、`/tools/*`、`/letters/:id/body`。
- 原生 Bridge webhook、SSE/WebSocket 订阅、任务进度接口、通用幂等请求键。
- 通过 Bridge 修改音效/字体/背景、设置无头、导出整册、批量读正文或写入小纸条。
- 直接给普通 `/drafts` 传 `kind:'reply'` 来创建回信，或给 Controller send 传新正文。
- 持有 Controller token 就可以访问所有普通路径，或持有 LAN Cookie 就可调用 Bridge。
- 打开无头即可让外部程序读取所有正文；它给桌宠的阅读权限，不是普通 HTTP 接口的全文权限。

若用户目标超出本文能力，完成现有可接入部分，再明确指出缺少哪一项接口，由用户决定是否单独扩展插件。不要改用内部网页路由绕过这份契约。

## 12. 可直接复制给 Coding Agent 的任务提示

```text
阅读附件《漂流瓶-Bridge-Agent接入手册.md》，将漂流瓶 Bridge 接入当前项目。

我的目标：<填功能>
项目入口/技术栈：<填路径或让 Agent 从仓库识别>
运行位置：<桌宠同机后端或其他部署方式>
已授权权限：<普通 Bridge；如需 Controller 请明确>
配置由我通过环境变量/secret manager 注入，不把真实 token 写入代码或对话。

按现有项目风格实现，不硬编码端口、不新增未记录接口。
先实现和测试客户端与配置，默认仅做只读联通验收。
若有发送功能，必须由界面先预览实际草稿，再确认同一 draftId/revision；
禁止把起草/重写成功当成发送确认，禁止超时后自动重发 POST。
不能因缺少真实凭证就停止全部实现，可先完成 mock 和运行说明。
不要修改或重启真实桌宠，不提交或发布，除非我后续明确要求。
交付改动、配置项、使用方法、测试结果和剩余限制。
```

## 13. 可选的人工与源码参考

本文主要契约已完整列出，复制到其他项目后不依赖以下相对路径。能访问源码仓库时，可继续核对：

- [人工操作与 PowerShell/Python 示例](BRIDGE_GUIDE.md)。
- [完整产品说明](USER_GUIDE.md)。
- [HTTP 路由与鉴权](../world/bridge.ts)。
- [World 业务与发现文件](../world/world.ts)：`startBridge/bridgeStatus/controllerAction/createBridgeDraft/catchBridgeLetter`。
- [草稿 ID 与版本校验](../world/drafts.ts)、[文本计数](../shared/text.ts)、[装饰校验](../shared/stationery.ts)。
- [普通 Bridge 测试](../tests/bridge.test.ts)、[Controller 测试](../tests/bridge-controller.test.ts)。

若文档和实际版本不一致，先报告差异并核实当前实现，不用猜测补齐“看起来应该有”的端点。
