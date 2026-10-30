# 连不上海边：文案对照与排查

> 这是给维护者看的对照表，**不在 npm 包内**（`package.json` 的 `files` 白名单不含 `docs/`）。
>
> 客户端里只出现左边那列「用户看到的话」。文案与错误码一一对应，
> 所以用户把那句话念出来，就能反推错误码——不用他要日志、不用他截图。

## 一、主表

| 用户看到的话 | 错误码 | 是什么 | 常见于 |
|---|---|---|---|
| 咦，海在哪里呢？（这个名字没能找到） | `ENOTFOUND` | 域名解析不出 IP | DNS 污染、没有网络、域名的 A 记录被改 |
| 问路的人还没回来，海的名字一时没问到。 | `EAI_AGAIN` | DNS 查询超时/临时失败 | 弱网、DNS 服务器挂了、公司网拦 DNS |
| 海边的某个地方似乎不给进…… | `ECONNREFUSED` | TCP 连上了但被拒绝 | 服务端进程没起、反代没转发、端口写错 |
| 刚靠岸就被推开了。 | `ECONNRESET` | 连接中途被重置 | 中间设备掐断（墙/防火墙/代理异常）、服务端崩溃重启 |
| 那条路根本走不到海边。 | `EHOSTUNREACH` | 到主机的路由不可达 | 目标 IP 不可路由、路由表异常 |
| 这里似乎没有通往海的路。 | `ENETUNREACH` | 本机网络不可达 | 断网、网卡未就绪、VPN 半连 |
| 海迟迟没有回应你…… | `ETIMEDOUT` / `UND_ERR_CONNECT_TIMEOUT` | 连接建立超时 | **最典型的“需要代理”**：直连被丢包 |
| 海边收下了，却一直没回话。 | `UND_ERR_HEADERS_TIMEOUT` | 连上了但等不到响应头 | 服务端卡死、反代上游超时 |
| 海边的话说到一半就断了。 | `UND_ERR_BODY_TIMEOUT` | 响应体读到一半超时 | 大响应 + 慢链路、连接被中途掐断 |
| 海边的凭证过期了——不是你的问题。 | `CERT_HAS_EXPIRED` | 服务端证书过期 | 证书没续（Caddy/ACME 失败）、客户端时间穿越 |
| 一个认不出的印章挡住了路。 | `UNABLE_TO_VERIFY_LEAF_SIGNATURE` / `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` / `SELF_SIGNED_CERT_IN_CHAIN` / `DEPTH_ZERO_SELF_SIGNED_CERT` | 证书链校验失败 | 自签证书、中间证书缺失、企业网做了 TLS 解密 |
| 名字对不上：那边写的不是这片海。 | `ERR_TLS_CERT_ALTNAME_INVALID` | 证书里的域名与访问的不一致 | 用 IP 访问了只有域名的证书、域名写错 |
| 刚要说上话，两边就说岔了。 | `EPROTO` | TLS 握手协议错误 | 中间设备干扰、客户端过旧、服务端只允许特定 TLS 版本 |
| 没能到海边，也不知道卡在哪了。 | 其它 | 没归类的失败 | 新情况：请对方开 debug 取 `core.log` |

## 二、还有一句前缀

没拿到 token 时（注册就没成功），回执是：

```
还没连上海边：<上面某一句话>等一会儿再捞。
```

所以「还没连上海边：咦，海在哪里呢？」= **注册阶段就 DNS 失败**，连信都还没开始捞。
如果只有「还没连上海边。」（没有冒号），说明这次还没产生过具体的网络错误（例如刚启动还没来得及连）。

## 三、同一句话对应多个码时，怎么进一步区分

超时组（4 个码）与证书组（4 个码）文案相同。需要精确区分时，让对方跑：

```powershell
curl.exe -v --max-time 15 https://bottle.sqnori.com/health
```

- 证书相关：`curl` 会明确打印 `SSL certificate problem: ...`
- 精确看链：`openssl s_client -connect bottle.sqnori.com:443 -servername bottle.sqnori.com`（看 `Verify return code`）

## 四、分流判断（最快定位的那张图）

```
浏览器能开 ？
├─ 不能 → 他那边的网络/出海问题（DNS、断网、代理本身坏了）
└─ 能
   ├─ curl 能开、插件不能 → 进程级问题：Node 没走系统代理 / 安全软件只放行浏览器 / 证书库差异
   └─ curl 也不能 → 非浏览器程序的出站被拦：代理只做了浏览器规则、防火墙白名单、TLS 拦截
```

**最常见的结论**：浏览器走系统代理或 PAC，而 Node 的 `fetch` **不读 Windows 系统代理**。让对方开 Clash/代理的 **TUN 模式**（或系统代理 + 允许非浏览器流量）即可。

## 五、让对方配合时，只要三样东西

1. 回执里的**那句话**（一句就够，能反推错误码）；
2. `curl -v --max-time 15 https://bottle.sqnori.com/health` 的**结果**（成功/失败 + 报错原文）；
3. `netsh winhttp show proxy` 的输出（有没有系统代理）。

> 需要更细时：配置页打开「开发者模式」，`data\logs\core.log` 里会出现 `[bottle] identity failed: network` / `catch failed: network` 这类行（只记类别，不记信件内容）。

## 六、维护约定

- 文案就是诊断含义：**改文案等于改诊断**，改完必须同步这张表；
- `tests/net-errors.test.ts` 逐条钉住了「码 → 文案」，漏改会直接红；
- 新增错误码时，先想清楚「用户该看到一句什么话」，再写进 `world/client.ts` 的 `NET_ERROR_TEXT`。
