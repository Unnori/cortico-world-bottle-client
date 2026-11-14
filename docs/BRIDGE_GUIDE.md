# 漂流瓶 Bridge 使用指南

核对日期：2026-11-14。基线为客户端 0.9.3 源码；中央服务端无需因此升级。本指南记录现有接口，不代表新增了桥接客户端或远程服务。

若要将资料直接交给 Coding Agent 接入其他项目，请使用可独立阅读的 [Agent 接入手册](BRIDGE_AGENT.md)。

## 目录

1. [它能做什么](#它能做什么)
2. [启用与连接](#启用与连接)
3. [第一次请求](#第一次请求)
4. [普通 Bridge 接口](#普通-bridge-接口)
5. [Controller 接口](#controller-接口)
6. [一个可复用的 Python 客户端](#一个可复用的-python-客户端)
7. [冲突、重试与错误](#冲突重试与错误)
8. [权限边界与排查](#权限边界与排查)
9. [源码索引](#源码索引)

## 它能做什么

Bridge 是漂流瓶 World 附带的本机 HTTP 接口。你的脚本、小纸船或其他本机程序可以向正在运行的插件发请求，复用信箱的业务逻辑。它不是中央海边服务器的管理 API，也不是控制整个 Coopanion 的通用遥控器。

| 能力 | 普通 Bridge | 另外启用 Controller |
| --- | --- | --- |
| 查询在线状态、额度、持信和草稿元信息 | 可以 | 可以，另有归档信件 ID 目录 |
| 提交待审的新信草稿 | 可以 | 使用普通入口和普通凭证 |
| 打捞一封信 | 可以，仅返回元信息 | 使用普通入口和普通凭证 |
| 查看指定草稿全文 | 不可以 | 可以 |
| 确认寄出、请求重写、放弃指定草稿 | 不可以 | 可以 |
| 请求桌宠回信、一起看 | 不可以 | 可以 |
| 归还或收好当前信 | 不可以 | 可以 |
| 修改设置、打开无头模式、任意读盘、执行命令 | 不可以 | 不可以 |
| 批量导出正文、获取所有来信正文 | 不可以 | 不可以 |
| 提交人工编写的小纸条或直接操纵所有网页按钮 | 不可以 | 不可以 |

**Bridge、Controller、无头模式各有自己的开关。** Controller 不依赖无头模式；不开无头，也能由可信程序请求共读、请桌宠起草，再由 Controller 确认发送。打开无头不会自动打开 Bridge。

玩家设置中的无头模式现以“聊天里处理信件”为主说明，配置键仍是 `headlessEnabled`；Bridge 的路径和双凭证权限不变。失效回信统一留稿、纸条进入 v2 信册备份，不因此新增 Bridge 全文导出或补寄权限。

## 启用与连接

### 1. 先安装并激活漂流瓶

在宿主扩展管理中安装 `cortico-world-bottle`，激活漂流瓶 World。已有代码升级后要完整退出并重启宿主，确保装载的是新版代码。单纯切换 Bridge 设置后，重启漂流瓶 World 即可。

### 2. 选择权限

在漂流瓶配置最底部「本地 Bridge 与 Controller」中设置：

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

这是应合并到部署配置中的片段，不是替换整个 `config.json`。仅在确需控制端操作时，将 `bridgeControllerEnabled` 也设为 `true`，然后重启 World。

两个桥接开关默认均为 `false`，声明为非热启用。已经运行后关闭开关，会立即拒绝相应新请求；重新开启仍以重启 World 完成凭证和发现文件初始化为准。

### 3. 找到实际地址

部署数据目录里的 `bottle-bridge.json` 类似：

```json
{
  "apiVersion": 1,
  "baseUrl": "http://127.0.0.1:7796/api/v1",
  "credentialSecret": "BOTTLE_BRIDGE_TOKEN",
  "controllerAvailable": false,
  "worldSession": "每次运行生成的标记"
}
```

- 使用**部署数据目录**，不是 npm 安装目录、源码目录或 `E:\BottleWeb`。源码通过宿主 `ctx.dataDir` 取得实际位置，不保证每台电脑有同一绝对路径。
- 端口与独立本机信箱共用。默认从 7796 开始，被占用则顺延，始终跳过 7797；每次重新连接应重新读取发现文件。
- `baseUrl` 已含 `/api/v1`，不要重复拼接。Controller 基地址为 `baseUrl + '/controller'`。
- 发现文件不含密钥。`credentialSecret` 是密钥名称，不是密钥值。
- World 停止会清理本轮发现文件。异常退出可能留下旧文件；**文件存在不证明服务仍活着**，应实际查询状态。
- `apiVersion:1` 是接口版本，和插件软件版本 0.9.2 不同。

### 4. 获取凭证

首次启用会自动生成凭证，通过宿主 `storeSecret()` 存入**部署根目录的 `.env`**：

| Secret 名称 | 用途 |
| --- | --- |
| `BOTTLE_BRIDGE_TOKEN` | 普通 `/api/v1/status`、`drafts`、`catch` |
| `BOTTLE_BRIDGE_CONTROLLER_TOKEN` | `/api/v1/controller/...` |

操作员可在本机安全读取对应条目，将值交给可信程序的环境变量或秘密配置。不要将整个 `.env` 发给程序、贴到聊天或提交到仓库。手工预设时，两种值必须不同，各至少 32 字符、不能含空白；推荐保留插件自动生成的随机值。

扩展的原生 WebUI invoke 还提供 `mailbox / bridge/credentials` 和 `mailbox / bridge/controller-credentials`，返回对应 `baseUrl, token`。这是面板开发接口；**当前自带面板没有专门的“复制 Bridge 密钥”按钮**，不应按不存在的界面步骤寻找。它也不是匿名 HTTP 凭证查询接口。

不是这些凭证：中央服务端身份 token、手机配对 token、QQ 账号、固定的 `x-bottle:1` 请求头。三种通道不能相互替代。

## 第一次请求

以下 PowerShell 示例假设操作员已经将普通凭证放入当前进程环境变量。示例不会读取或打印整个 `.env`：

```powershell
$bottleData = 'D:\替换为实际部署数据目录'
$discovery = Get-Content -LiteralPath (Join-Path $bottleData 'bottle-bridge.json') -Raw | ConvertFrom-Json
$bottleBase = $discovery.baseUrl.TrimEnd('/')
if (-not $env:BOTTLE_BRIDGE_TOKEN) { throw '请先配置本进程的 Bridge 凭证' }
$agentHeaders = @{ Authorization = 'Bearer ' + $env:BOTTLE_BRIDGE_TOKEN }
Invoke-RestMethod -Uri ($bottleBase + '/status') -Headers $agentHeaders -TimeoutSec 15
```

只接受本机程序直连回环地址。不要带浏览器 `Origin`；不要从网页 JavaScript、跨域前端或远程服务器直接调用，也不要经 LAN 配对端口转发。

## 普通 Bridge 接口

### GET `/api/v1/status`

示意响应，实际 ID 和数字以返回值为准：

```json
{
  "ok": true,
  "apiVersion": 1,
  "online": true,
  "capabilities": {"stationery": true, "stationeryLayout": true},
  "quota": {"bottlesLeft": 2, "catchesLeft": 3, "repliesLeft": 3},
  "held": null,
  "drafts": [
    {"draftId":"实际草稿ID","revision":1,"kind":"letter","chars":12,
     "createdAt":"2026-11-14T00:00:00.000Z","sendPolicy":"manual",
     "source":{"kind":"bridge","name":"PaperBoat"}}
  ]
}
```

`online` 是插件最近一次与海边通信的结果；不是实时连通性保证。尚未获取额度时 `quota` 可以为 `null`，旧海边不提供的额度字段也可能缺省。

`held` 有信时含 `letterId, from, seed, dead`，有期限时含 `expiresAt`，Bridge 打捞的信可能含 `source`。草稿可能附 `sendFailure:'expired'`，表示原信已失效、不能寄出的本地回信留稿。状态不返回正文、标题、SVG、路径、密钥或完整信册。

### POST `/api/v1/drafts`

创建**新信槽**的本地待审草稿，成功为 HTTP 201；不是回信或小纸条入口。

```powershell
$proposal = @{
  source = 'PaperBoat'
  body = '海风刚好吹到窗边，想把这一刻放进瓶子里。'
  topic = '窗边'
  stationery = @{ v = 2; paper = 'line'; doodle = 'paper-plane'; color = '#638c9c' }
} | ConvertTo-Json -Depth 12
$draftResult = Invoke-RestMethod -Method Post -Uri ($bottleBase + '/drafts') `
  -Headers $agentHeaders -ContentType 'application/json; charset=utf-8' `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($proposal)) -TimeoutSec 15
```

| 字段 | 规则 |
| --- | --- |
| `source` | 必填，1—64 字符，不得含控制字符；按真实程序名称填写 |
| `body` | 必填，去首尾空白后 1—120 个 Unicode 码点 |
| `topic` | 可省略；非空标题为 1—20 码点、单行。无题时直接省略 |
| `stationery` | 可省略；与桌宠工具共用装饰校验，见完整说明书 |
| `replace` | 仅在明确替换现有新信稿时传 `{draftId,revision}` |

返回 `ok:true, draft:{元信息}, requiresHumanReview:true`。旧服务器装饰降级时另有 `decorationDelivery`。**它不发模型事件、不让桌宠读陌生人的信，也不寄出。** 外部程序可以投入自己提供的文字，但不表示人或桌宠已认可。

已有新信稿返回 `409 draft_conflict`，附当前元信息。确需替换时，先重新查询并由操作员决定，再提交：

```json
{
  "source":"PaperBoat",
  "body":"重新整理过的这一版。",
  "replace":{"draftId":"状态中最新的新信草稿ID","revision":2}
}
```

不能用 `replace` 覆盖回信槽。正文、标题、装饰或来源改变都会使旧确认失效；不要为解决冲突自动取最新版本并强制覆盖。

### POST `/api/v1/catch`

```json
{"source":"PaperBoat"}
```

只接受 `source`。使用现有打捞额度、持信规则，成功返回 `ok:true, held:{元信息}, quota:{...}`；正文仅进入本机信箱，不返回给调用程序，也不因无头开启而自动投递给桌宠。需要共读时，另用 Controller 的 `together`。

有持信、忙碌、额度不足或海空会失败。不要用紧密循环刷 `/catch`，尤其不要把业务冲突当网络错误不断重试。

## Controller 接口

准备独立请求头：

```powershell
if (-not $env:BOTTLE_BRIDGE_CONTROLLER_TOKEN) { throw '请先配置 Controller 凭证' }
$controlHeaders = @{ Authorization = 'Bearer ' + $env:BOTTLE_BRIDGE_CONTROLLER_TOKEN }
$controlBase = $bottleBase + '/controller'
```

Controller token 只用于 Controller 路径；普通 token 不能调用 Controller，Controller token 也不能调用普通入口。需要两组能力的程序要分别配置两种凭证。

### 查询与预览

| 方法、路径 | 返回 |
| --- | --- |
| `GET /controller/status` | 普通状态，加 `letters.received/sent/replies` 的 ID 目录；不含正文 |
| `GET /controller/drafts/:draftId` | `ok:true, draft:{元信息,body,可选topic,stationery,letterId}` |

上表路径相对 `/api/v1`。预览只给指定稿，不会返回全部信件。URL 中草稿 ID 只允许 1—128 位字母、数字、下划线或短横线；正常插件生成的 ID 符合要求。不存在的草稿为 404。

### 发送、重写与放弃

三个 POST 路径都接受同样的字段：

```json
{"source":"PaperBoat Controller","draftId":"真实草稿ID","revision":2,"kind":"reply"}
```

`kind` 可省略；填写时只能是 `letter` 或 `reply`，须与目标草稿一致。`revision` 必须是当前正整数版本；不能额外提交 `body/text/topic/stationery` 来改变所确认的内容。

| 路径 | 作用与完成判断 |
| --- | --- |
| `/controller/send` | 立即真正寄出此版，包括提前寄出现有定时回信；检查 `ok` 和 `message` |
| `/controller/rewrite` | 请求桌宠重写；成功只表示邀请已递出，不表示新稿已经生成，更不表示发送 |
| `/controller/discard` | 放弃指定版本；有定时回信保护时先向海边确认取消，失败保留稿件 |

正确流程：查状态 → 预览指定稿 → 向人展示 → 获得对此版的确认 → 提交同一 `draftId/revision`。**“写一封”“重写一下”“这封你回吧”都不是发送确认。** 重写后必须重新预览和确认。

普通 Bridge 创建的草稿会标记外部来源，Controller 可以在你认可后确认寄出；不能把 `source` 或 `requiresHumanReview:true` 当成“已审阅”的凭据。插件无法判断持钥程序背后是否确有真人，由你负责信任该程序的确认流程。

### 回信、共读、归还与收好

```json
{"source":"PaperBoat Controller","letterId":"真实信件ID"}
```

| POST 路径 | 条件与结果 |
| --- | --- |
| `/controller/reply` | 仅当前持信；不能是邮局信、死亡信或无正文信。有回信稿时先按版本重写/放弃。桌宠新稿为 manual，另行确认才寄出 |
| `/controller/together` | 当前持信或本地归档往来；递给桌宠共读，只聊感想，不授权起草回信 |
| `/controller/return` | 归还当前持信，按服务端规则回海或沉底 |
| `/controller/keep` | 调用信箱原有收好逻辑；不是绕过回海/回信限制的任意占信功能 |

必须使用状态中真实信件 ID，不能传草稿 ID、QQ 消息编号或工具别名 `held`。请求共读或回信的事件会标明 Controller 来源，不会冒充人点击网页。Controller 请求和正在共读、写作或寄送的动作冲突时，等待其结束再操作。

### 最短的人工确认示例

```powershell
$state = Invoke-RestMethod -Uri ($controlBase + '/status') -Headers $controlHeaders
$selected = @($state.drafts | Where-Object { $_.kind -eq 'letter' })[0]
if ($null -eq $selected) { throw '没有新信草稿' }
$preview = Invoke-RestMethod -Uri ($controlBase + '/drafts/' + $selected.draftId) -Headers $controlHeaders
$preview.draft | Select-Object body,topic,draftId,revision
# 先在自己的程序界面向人展示全文，并取得确认。以下请求会真正寄出。
if ((Read-Host '确认寄出这版草稿？输入 SEND') -ceq 'SEND') {
  $confirmation = @{source='PaperBoat Controller';draftId=$preview.draft.draftId;revision=$preview.draft.revision} | ConvertTo-Json
  Invoke-RestMethod -Method Post -Uri ($controlBase + '/send') -Headers $controlHeaders `
    -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($confirmation))
}
```

这只是你自己本机程序的示例，不是在网页控制台里执行的脚本。不要从自动生成成功回调直接调用发送。

## 一个可复用的 Python 客户端

Python 3，仅使用标准库。程序默认只查询状态；不会自动发送，也不会从 `.env` 中搜集其他密钥。

```python
import json
import os
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, ProxyHandler, build_opener

class BottleBridge:
    def __init__(self, data_dir):
        discovery = json.loads((Path(data_dir) / 'bottle-bridge.json').read_text('utf-8'))
        if discovery.get('apiVersion') != 1:
            raise RuntimeError('不支持此 Bridge API 版本')
        self.base = discovery['baseUrl'].rstrip('/')
        u = urlsplit(self.base)
        if (u.scheme != 'http' or u.hostname not in ('127.0.0.1', 'localhost')
                or not u.port or u.path != '/api/v1' or u.username or u.password
                or u.query or u.fragment):
            raise RuntimeError('发现文件不是预期的本机 Bridge 地址')
        self.http = build_opener(ProxyHandler({}))  # 本机请求不交给系统代理

    def call(self, path, payload=None, controller=False):
        secret = 'BOTTLE_BRIDGE_CONTROLLER_TOKEN' if controller else 'BOTTLE_BRIDGE_TOKEN'
        token = os.environ.get(secret)
        if not token:
            raise RuntimeError('请由操作员配置 ' + secret)
        url = self.base + ('/controller' if controller else '') + path
        data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode('utf-8')
        headers = {'Authorization': 'Bearer ' + token}
        if data is not None:
            headers['Content-Type'] = 'application/json; charset=utf-8'
        request = Request(url, data=data, headers=headers, method='GET' if data is None else 'POST')
        try:
            with self.http.open(request, timeout=15) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            try:
                result = json.loads(error.read().decode('utf-8'))
            except (ValueError, UnicodeError):
                result = {'ok': False, 'message': '响应不是有效 JSON'}
            return error.code, result

# 替换实际数据目录；执行时仅查状态。
bridge = BottleBridge(r'D:\实际部署数据目录')
status, result = bridge.call('/status')
print(status, result)

# 以下为按需调用写法，请勿取消注释后批量执行。
# status, result = bridge.call('/drafts', {'source':'MyProgram', 'body':'待审信件。'})
# status, result = bridge.call('/status', controller=True)
# status, result = bridge.call('/reply', {'source':'MyProgram', 'letterId':'真实ID'}, controller=True)
```

业务程序还应处理连接超时、连接拒绝、World 重启后重新发现地址。示例只捕获 HTTP 业务错误，其他网络异常会向调用方抛出，便于避免把失败误报为成功。

## 冲突、重试与错误

| HTTP | 常见原因 | 正确处理 |
| --- | --- | --- |
| 200 / 201 | 请求完成或已接收 | 同时检查 `ok`；重写/回信邀请需等待模型完成 |
| 400 | 非法 JSON、未知字段、超长、无效装饰、错确认格式 | 修正输入，不原样重试 |
| 401 | 凭证缺失、错误或用错权限 | 核对 token 与路径，不用配对凭证替代 |
| 403 | Host 非本机、带 Origin、跨站 Fetch Metadata | 改由可信本机后端直连；不是添加 CORS 白名单 |
| 404 | 开关未开、未重启、World 停止、错路由或稿件不存在 | 重新发现和查询；Controller 预览不存在也会 404 |
| 405 | GET/POST 用错 | 按接口表修正方法 |
| 409 | 正在共读/写作/寄送、已有持信、错版本、额度不足等 | 先核对状态和业务原因，不自动覆盖或重发 |
| 503 | 网络/本地存储/初始化等暂不可用 | 先核对是否已执行；恢复后由人决定下一步 |

不是每个失败都含稳定 `error` 字段：路由层和部分 Agent 失败含 `error`，Controller 业务层部分只给 `ok:false,message`。程序必须先看 HTTP 和 `ok`，不能只解析某一个错误字符串。

新信创建、HTTP 寄出等没有统一的客户端自定幂等键 API。请求结果未知时，不要直接重试 `/send` 或 `/drafts`；先查状态/信箱确认。回信内部有防重复与取消确认机制，但不要据此假定所有 Bridge 请求都可无限重放。状态快照和预览之间随时可能发生变化，版本冲突是正常保护。

## 权限边界与排查

- API 只挂在本机信箱回环监听上；LAN 监听即使已配对仍拒绝 `/api/v1`。配置 `lanPublicUrl` 不能把 Bridge 变成公网服务。
- Host 只接受实际端口的 `127.0.0.1:端口` 或 `localhost:端口`。带 `Origin` 的请求一律拒绝；`Sec-Fetch-Site` 有值时只接受 `none`。不提供网页 CORS 授权。
- JSON 请求体最多 **40 KiB**；超限与坏 JSON 返回 400。装饰还有单图 8 KiB、合计 16 KiB、线格式 32 KiB、最多 8 图的独立限制。
- 日志不要记 Authorization、草稿全文、HTTP 请求全文或整个 `.env`。`source` 只是自报名称，不能证明身份。
- 轮换密钥时，停止 World，在部署 secret 中替换对应值或删除后让插件重新生成，再重启并更新调用程序；若宿主进程继承了旧环境变量，完整重启宿主以避免旧值继续被读到。两种密钥不要设成相同。
- 关闭 Controller 立即禁止其新操作，但不能撤回已经寄出的信或已进入模型的正文。
- 旧网页路由和卡片仍信任同机进程。Bridge token 不是 OS 沙盒，不能隔绝已经控制本机的恶意程序。
- “HTTP 200 但桌宠没有立刻写完”：回信、共读、重写是事件邀请，不是同步调用 LLM。检查当前轮次、暂停、模型错误及是否仍有旧稿，不应自动确认发送。
- “Bridge 通了但没有正文”：普通接口按设计只给元信息；Controller 仅有指定草稿预览，共读正文交给桌宠，不直接回传给程序。
- “一直 409”：结束当前读信轮、处理已有持信或稿件，再查最新版；不要关掉确认保护来绕过。

## 源码索引

以下链接相对源码仓库的 `docs` 目录，用于复核具体实现：

- [HTTP 鉴权、字段白名单与路由](../world/bridge.ts)：`serveBridge`、`routeBridge`。
- [World 业务方法](../world/world.ts)：`startBridge`、`stopBridge`、`bridgeStatus`、`controllerAction`、`createBridgeDraft`、`catchBridgeLetter`；`webUi().invoke` 含凭证读取方法。
- [配置默认值与重启声明](../world/config.ts)：`BOTTLE_DEFAULTS`、`BOTTLE_CONFIG_FIELDS`。
- [草稿身份与确认格式](../world/drafts.ts)、[字数校验](../shared/text.ts)。
- 宿主本地源码 `Cortico/src/world.ts` 中的 storeSecret 实现：写入 `loaded.rootDir/.env`，不同宿主版本仍应以实际实现为准。
- [Agent HTTP 回归](../tests/bridge.test.ts)、[Controller 回归](../tests/bridge-controller.test.ts)。
- [扩展详细使用说明书](USER_GUIDE.md)：日常界面、无头模式、音效、装饰与数据管理。
