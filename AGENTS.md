# 漂流瓶扩展开发提醒

## World「信箱」页签：必须验证真实宿主加载链路

2026-11-02 曾出现：源码、构建和隔离浏览器测试全部通过，但已打开的 Coopanion 设置窗口仍显示旧面板，漏掉新增扫码卡片。**不能以测试 fixture 正常推断实际设置窗口已经更新。**

每次修改 `webui/client.ts`、`webui/style.css`、面板声明或构建脚本后：

1. 运行 `pnpm typecheck:web`、`pnpm build:webui`。提交/交付时保留 package.json 中的摘要路径及对应 dist 文件一致。不要覆盖旧摘要文件来冒充新版本，也不要为绕缓存修改内核。
2. 在运行实例上运行 `pnpm check:running-webui -- http://127.0.0.1:<实际框架端口>`，检查 `/api/webui/manifest` 内 `world:bottle.client` 与本地 manifest 一致、JS/CSS 返回 200 且字节摘要一致。`7796` 是独立信箱、`7797` 是桌宠端口，不能把它们当框架设置页端口。此检查只读扩展资源，不取聊天、正文或配对令牌。
3. 新开同一真实宿主的设置页，进入 `#/provider/world%3Abottle`，确认所有新卡片确实在 DOM 中且可见、无挂载错误；完成后关闭自己创建的验证页。不能只用模拟 ctx.ui 的 fixture 代替这一步。不要自动重启用户正在运行的桌宠。
4. 区分两层缓存：
   - 宿主启动时登记扩展资产表；只重启 World / ctx.refresh() 不会重新登记 JS/CSS。运行 manifest 仍指旧文件时，需要完整重启宿主，然后重新加载设置页。
   - 浏览器 WebUiPageLoader 按 pageId 缓存成功模块，切换页签不会重新 import。运行 manifest 已是新文件而旧窗口缺新卡片时，刷新设置页面（支持时 Ctrl+R；否则重新打开设置窗口），无需先重启模型/World。一年 immutable HTTP 缓存依赖摘要 URL，保持摘要正确。
5. 交付时明确哪些在真实宿主验证、哪些仅在 fixture 验证，以及原先打开的窗口是否仍需刷新。未实际验证不能写“真实页面已生效”。

源码依据和本次证据见 [docs/design/webui-loading.md](docs/design/webui-loading.md)。


## 顶栏入口与扫码布局

用户要求右上角不显示额外信箱入口。不要为了传递可达地址重新填充 `webUi().links`；地址走 `mailbox/status.links`，由页内按钮使用。扫码区只展示所选地址的一张二维码，避免多网卡地址撑满页面；折叠配对链接，保持窄屏布局与主题一致。


## 配置页分类

配置字段只在 `BOTTLE_CONFIG_FIELDS` 声明，显示顺序由 `BOTTLE_CONFIG_GROUPS` 决定，每项恰好登记一次。`world:bottle` 组 ID 专门保留给「其他设备访问」，信箱页签用它调用 ctx.setConfig；不要改组后遗漏保存入口。取某一配置字段时按稳定组 ID / 字段路径查找，不要再假设都在 config[0]。修改后验证默认值、分组自动保存与现有邀请联动；不要靠修改宿主 DOM 来添加标题或隐藏字段。


## 音效目录与默认值

来信默认 `incoming/New_notifications_1.wav`，回信默认 `reply/New_notifications_3.wav`，唯一常量在 sound.ts。包内选项只能是各自子目录的直接音频，以及 sounds 根目录标记 shared 的直接音频；不要把两个子目录混合进任一下拉。同步维护桌面动态选项、网页列表与 README，测试根目录共享、跨目录隔离、旧默认迁移；不要擅自覆盖人添加的音频文件。
