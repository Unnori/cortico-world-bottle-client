# 信箱面板旧模块缓存排查（2026-11-02）

## 本次证据

- 实际安装目录 `E:/Program_Files/Coopanion/data/extensions/node_modules/cortico-world-bottle` 为指向开发目录的 Junction，排除修改了错误副本。
- 实际框架监听 `127.0.0.1:17788`。只读 `/api/webui/manifest` 中 `world:bottle` 的资源字段，已指向 `webui-850bdbddeae3.js`、`webui-e87afc45e3d3.css`。
- 两项资产均返回 200；SHA256 前 12 位分别与文件名一致，含新卡片代码，响应为 `public, max-age=31536000, immutable`。
- 新建同一实例的浏览器页，进入 `#/provider/world%3Abottle`：新入口和 `.bottle-lan-card` 各 1 个，无面板错误，实际请求的 JS/CSS 正是上述新资源。
- 用户截图中的旧内容仍在，新增卡片不在；结合新窗口对照，问题位于已打开设置窗口保留旧面板。没有读取或更改 Electron 原窗口的模块状态，不能声称已强制刷新了该窗口。

## 框架原因

`Cortico/src/web/client/webui-pages/loader.ts` 的 `WebUiPageLoader.load()` 先读 `loaded.get(pageId)`，命中后直接返回成功模块，不再比较新 asset URL。切换页签/重新请求 manifest 不会使当前页面已加载模块失效，重新加载页面才会建立新的 loader。

另一层是 `Cortico/src/web/webui-pages.ts` 的 `extensionPages`，构造时建立且 `reload()` 只重读宿主 dist。`src/web/server.ts` 也在构造时保存 extensionAssets；`src/extensions.ts` 返回 booted 资产表。因此若运行实例仍上报旧资源路径，只重启 World 不足以刷新注册表；须重启宿主。本次运行 manifest 已更新，无须先做此步。

上一轮 `tests/lan-browser.mts` 直接从磁盘读取 package.json 后提供新 bundle，并模拟面板 ctx，验证了功能但绕过上述缓存；它不能证明旧的 Coopanion 窗口会自动刷新。

## 后续约束

根目录 AGENTS.md 已固定实际宿主验收步骤。`pnpm check:running-webui -- <框架地址>` 只读检查运行资源与本地构建是否一致，不探测私有数据、不重启进程、不清理用户浏览器缓存，也不能代替查看实际 DOM。核对失败时按资源注册/文件响应阶段给出操作说明。
