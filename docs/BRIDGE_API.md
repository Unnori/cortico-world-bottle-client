# 本地 Bridge v1

默认 `worlds.bottle.bridgeEnabled=false`。人工开启并重启 World 后，API 挂在实际本机信箱端口的 `/api/v1`；不开放到配对 LAN 监听器。它独立于无头开关，不读取聊天身份，也不自动开启无头。

## 发现与凭证

World 数据目录的 `bottle-bridge.json` 提供 `apiVersion` 和 `baseUrl`。端口占用会顺延，永远跳过 7797，不应硬编码 7796。发现文件不含凭证，停止 World 时清除；重启后重新读取。

专用凭证由部署 secret `BOTTLE_BRIDGE_TOKEN` 保存，第一次启用自动生成，后续重启保留。由操作员配置给本机程序，不能使用服务端 token 或 LAN 配对令牌替代，不要贴进模型聊天。原生设置面板调用 `mailbox` 的 `bridge/credentials` 方法可以读取本机连接信息；普通 HTTP 状态接口从不返回凭证。

每次请求携带 `Authorization: Bearer <专用凭证>`。不需要 `x-bottle`；仅有该固定头不能鉴权。只接受实际回环 Host，不接受网页 Origin、跨站 Fetch Metadata 或 CORS。JSON 请求体上限 40 KiB，装饰仍执行单图 8 KiB、合计 16 KiB、最多 8 图和复杂度检查。

## 接口

| 方法与路径 | 输入 | 输出与副作用 |
| --- | --- | --- |
| `GET /api/v1/status` | 无 | 在线状态、当前额度、手中信的 ID/署名/期限、草稿 ID/kind/revision/字数/时间/来源；无正文、标题、SVG、信册、路径或凭证 |
| `POST /api/v1/drafts` | `source`、`body`，可选 `topic`、`stationery`、`replace` | 创建本机新信草稿，不寄出、不授权模型读信或改配置；返回草稿元信息和 `requiresHumanReview:true` |
| `POST /api/v1/catch` | 仅 `source` | 沿用现有额度和 held 规则打捞，返回元信息，正文只留本机信箱；不自动递给模型 |

`source` 是真实程序名称，1—64 字，不能含控制字符。它是外部自报来源，不是身份验证或人工审批凭据。

创建示例：

```json
{"source":"PaperBoat","body":"一封等待人审阅的信。","topic":"海边","stationery":{"v":1,"paper":"grid","doodle":"wave-line"}}
```

正文最多 120 字，标题可选、填写时 1—20 字单行。装饰与模型起草共用同一校验器，失败不会替换现有草稿。旧海边不支持装饰时本机保留图案，实际寄出按既有降级规则处理。

`stationery` 支持 v:2 的配色、多图、坐标、旋转、镜像和图层，单图简写及多图示例见 [素材说明](../world/stationery/README.md)。状态 `capabilities.stationeryLayout` 表示当前海边支持完整排版；`stationery` 保留原有基础能力布尔值。降级草稿回执的 `decorationDelivery` 为 `legacy_single_doodle` 或 `plain_text_on_unsupported_server`，普通完整投递不返回该字段。

已有新信稿时返回 `409 draft_conflict`，附当前草稿元信息。明确替换必须使用刚查询到的真实 ID 和版本，例如：

```json
{"source":"PaperBoat","body":"重新整理的这一版。","replace":{"draftId":"从状态接口取得的真实ID","revision":2}}
```

替换不能选回信槽，旧版本拒绝。内容、标题、装饰或来源变化使旧确认失效。尚在共读、写作、寄送或取消操作中时返回冲突，不抢占原动作。来源元数据只随草稿保存，在寄出、放弃、删除或清空时一起移除；打捞来源随 held 在归还、收好、寄回、过期或删除时移除。

## 错误与边界

- `400`：JSON、输入、字数、标题、装饰或未知字段不合法，未执行动作。
- `401`：专用凭证错误；`403`：网页跨源或 Host 不匹配。
- `404`：未启用、未重启生效、已停止，或接口不存在；`405`：方法错误。
- `409`：草稿版本冲突、正在操作、已有 held、空海或额度不足；状态只作快照，服务端仍执行最终额度检查。
- `503`：网络、凭证保存、发现文件或本机持久化失败。新信寄送结果未知时不会自动重复 `/throw`。

普通 Agent 没有寄出、正文读取、回信/纸条提交或配置修改权限。人仍可在原信箱审阅、重写、放弃和发送；显式开启的无头聊天工具是另一个入口。

## 可选 Controller

要让可信本机程序调用原信箱的部分按钮，需同时启用 `bridgeEnabled` 和 `bridgeControllerEnabled`，并重启 World。Controller 默认关闭，独立使用部署 secret `BOTTLE_BRIDGE_CONTROLLER_TOKEN`，第一次启用自动生成。原生 `mailbox` invoke 的 `bridge/controller-credentials` 可由本机操作员取连接信息；不能把凭证交给模型。普通 Agent token 与 Controller token 不能互用。发现文件只增加 `controllerAvailable`，不写密钥。

| 方法与路径 | 输入 | 行为 |
| --- | --- | --- |
| `GET /api/v1/controller/status` | 无 | 元信息及归档信件 ID 目录，无正文/标题/密钥 |
| `GET /api/v1/controller/drafts/:draftId` | 确切草稿 ID | 预览这一份草稿正文、标题、装饰与当前版本，不批量返回信册正文 |
| `POST /api/v1/controller/send` | `source,draftId,revision`，可选 `kind` | 确认寄出当前版本；不接受替换正文 |
| `POST /api/v1/controller/rewrite` | 同上 | 请桌宠重写这一版，不代表确认寄出；异步生成时再次校验目标版本 |
| `POST /api/v1/controller/discard` | 同上 | 放弃这一版；已有定时回信先确认取消 |
| `POST /api/v1/controller/reply` | `source,letterId` | 请桌宠为手中指定信起草回信；新稿 manual，不开始两小时倒计时 |
| `POST /api/v1/controller/together` | `source,letterId` | 将手中指定信或归档往来递给桌宠共读，只聊感想，不授权起草 |
| `POST /api/v1/controller/return` | `source,letterId` | 归还手中指定信，沿用海边规则 |
| `POST /api/v1/controller/keep` | `source,letterId` | 沿用信箱收好/珍藏处理规则，不改变回信额度与服务端限制 |

例如先 GET 指定草稿，向人展示后，再 POST `/api/v1/controller/send`：

```json
{"source":"PaperBoat Controller","draftId":"预览返回的真实ID","revision":2}
```

这会真正寄出，所以不能从自动生成回调里顺手调用。Controller 是操作权，不是“已经有人看过”的证明：扩展无法判断持钥程序背后是否有真人，信任该程序决定何时确认。Controller 的普通回信请求只生成草稿，发送需另行确认；已存在的桌面定时稿重写仍保留原约定。无头自动共读轮次同样不能用 Controller 顺带发送。

只对本机开放，沿用 Host、Origin、请求大小、状态锁及版本校验。关闭任一开关后立即拒绝 Controller 操作；等待异步任务后再次检查。旧版本、新正文替换、错目标或忙碌返回冲突。它不提供设置修改、全部正文导出或人工纸条正文提交接口。

原本的本机网页/卡片路由仍信任同机进程。Bridge 凭证仅约束这个 API，不构成操作系统沙盒，不能承诺阻止同机程序使用其他既有入口。LAN 配对和同源检查保持原规则。
