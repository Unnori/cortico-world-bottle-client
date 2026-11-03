# 漂流瓶 R2 字库：上传与维护

公开域名：`https://fontsforletters.sqnori.com/`。

管理目录现位于 `E:\WorkShop\Coopanion_DevelopMod\bottle-font-library\cloudflare-r2`，已移出扩展，不进 Git/NPM。只有 `upload` 里的内容需要上传到 R2，其他文件是维护资料。当前准备9款全字符 WOFF2，来自已审核 OFL 字库。许可证要求仍须遵守；这里不含受限或授权未确认的字体。

## 目录怎么用

```text
cloudflare-r2/
├─ upload/                 ← 只上传这里的内容，保留内部路径
│  ├─ catalog.json         ← 最后上传到桶根目录
│  ├─ fonts/               ← 字体文件，内容摘要命名
│  └─ licenses/            ← 完整许可与授权索引
├─ source/                 ← 今后添加/维护字体用，不上传
│  ├─ fonts/
│  └─ licenses/
├─ library.json            ← 本地字库登记表，不上传
├─ cors.json               ← 粘贴到 R2 CORS 配置，不上传
├─ object-metadata.json    ← 对象类型/缓存建议，不上传
├─ 重新生成上传目录.cmd     ← 双击后重建 upload，不会联网
└─ README.md               ← 本说明，不上传
```

## 第一次上传：可以拖拽文件，但一定保留对象路径

Cloudflare 控制台：R2 → 你的桶 → Objects/对象 → Upload/上传。控制台支持拖拽文件；不要依赖拖入最外层文件夹后是否自动省略目录名。

最稳妥的做法：

1. 在桶根目录创建 `fonts` 文件夹，进入后把 `upload/fonts` 里的9个 `.woff2` 拖进去。
2. 返回桶根目录创建 `licenses` 文件夹，进入后把 `upload/licenses` 里的10个文件拖进去（9份协议 + README）。
3. 等上述资源上传成功，再返回桶根目录，把 `upload/catalog.json` 拖进去。已有同名清单时覆盖它。

最终的对象路径必须是：

```text
catalog.json
fonts/<摘要>.woff2
licenses/<摘要>.txt
licenses/README.md
```

不要变成 `upload/catalog.json` 或 `cloudflare-r2/upload/catalog.json`。R2 的目录实际是对象键前缀，层级直接影响公开 URL。

如果控制台的整目录拖拽会保留正确的 `fonts/` 和 `licenses/` 前缀，可以一次上传这两个子目录；仍然最后单独上传 `catalog.json`。不上传压缩包；R2 不会自动解压 ZIP。

## 跨域与缓存

1. R2 → 桶 → Settings → CORS Policy，粘贴本地 `cors.json` 的内容并保存。将此 JSON 当普通文件上传不能配置 CORS。
2. `object-metadata.json` 列出每个对象应该使用的 Content-Type / Cache-Control。建议字体为 `font/woff2`，JSON 为 `application/json; charset=utf-8`。
3. 字体与摘要命名的许可适合 `public, max-age=31536000, immutable`；清单用 `public, max-age=300`。若使用 CLI/S3 工具上传，设置相应 HTTP 元数据；也可以用域名的 Cloudflare 缓存规则配置。不要给整个域名统一一年缓存，避免旧清单长期不更新。
4. **拖拽上传不会读取本地 object-metadata.json 自动设置 HTTP 头。** `_headers` 文件在 R2 中也不等同于 Cloudflare Pages 的响应头配置。
5. 浏览器缓存不保证永久保存，首次使用或缓存被清理后仍需下载。实际客户端迁移时会检查响应头、跨域、断网回退与多端加载。

## 新增字体：源文件 + 完整许可 + 登记，再重新生成

**不要直接在 upload/fonts 中加一个文件就上传。** 客户端根据 `catalog.json` 知道哪些字体可以抽取，不会列举整个桶。

1. 先确认该字体的当前版本允许公开网络分发、WOFF2 转换。当前生成器只接受已审核的 OFL-1.1 字体；其他协议需单独审核和扩充规则，不要改写成 OFL。
2. 将已经转换好的字体放进 `source/fonts/`，例如 `新笔迹.woff2`。不要把 TTF 仅改后缀当作 WOFF2；原始 TTF/OTF 需要先做授权核查与真实转换。
3. 将包含作者版权声明和完整 OFL 的文本放进 `source/licenses/`，例如 `新笔迹-OFL.txt`。
4. 用 UTF-8 文本编辑器打开 `library.json`，在 `fonts` 数组末尾添加一条记录（注意前一条记录后加逗号）：

```json
{
  "name": "新笔迹.ttf",
  "label": "新笔迹",
  "file": "fonts/新笔迹.woff2",
  "notice": "licenses/新笔迹-OFL.txt",
  "license": "OFL-1.1",
  "source": "https://作者的真实项目或授权页面",
  "enabled": true
}
```

`source` 必须换成真实的作者来源。`name` 是稳定的身份键，通常沿用原字体文件名；记录投入使用后不要改名，也不要拿另一款字体覆盖同一个 name。`label` 只用于显示，可以调整。原有9款还记录了审核摘要，文件被替换时会停止生成，避免误用。

5. 双击 `重新生成上传目录.cmd`，或在本目录执行：

```powershell
node ..\..\extensions\cortico-world-bottle\scripts\prepare-r2-fonts.mjs
```

脚本会校验输入、自动计算摘要和地址、生成新的 `upload/catalog.json`。它只在本机写文件，不读取密钥、不连接 R2。检查许可文件格式不等于自动判断授权真伪，新增文件仍须由维护者审核。

6. 先上传 `upload/fonts` 与 `upload/licenses` 新增/变更的文件，再上传根目录 `catalog.json`，覆盖旧清单。也可重复上传这些目录中的全部文件，摘要文件没有变化；发布顺序仍保持清单最后。

最终：客户端改为远程字库后，会按清单内 `enabled: true` 的字体抽取新发信人。现有发信人保持原绑定；同一信箱在手机/电脑复用绑定，字体缓存由各自浏览器保存。客户端现使用 R2 字体并在各浏览器 IndexedDB 中缓存；清单在宿主定期刷新，字体只由浏览器下载。运行中的旧 World 需加载更新后的扩展才会切换。

## 停用与更新

- 暂停一款字体参与新绑定：将它的 `enabled` 设为 `false`，重新生成并上传清单，保留原记录、字体和许可文件。
- 现有默认字体由 `defaultFont` 指定，当前为 `Yozai-Regular.ttf`。不能从登记表删除仍作为默认的记录；先选择另一款已登记的字体。
- 更换字体内容会产生新 URL；原始 name 派生的 ID 保持不变。若是另一款不同字体，应新增 name，不要借更新覆盖旧笔迹。
- 工具保留 upload 中历史摘要文件，不自动删除，避免旧页面下载失效。若因授权等原因必须撤回某文件，需另行确认撤回范围并删除 R2 对象及相关边缘缓存；已有浏览器缓存不能保证远程立即撤销。
- 不要用镜像删除/sync --delete 清理桶，避免误删旧绑定仍使用的对象。

## 字体绑定与重洗说明

按原始 name 派生 ID，延续旧字典键。增加新字体不重新分配已绑定笔迹。此目录不包含玩家实际部署的字体字典。

客户端完成远程迁移后，主动重洗仍是高阶本地操作：停止 World、备份部署数据内的 `bottle-font-map.json`，再移走该字典文件后启动 World，让下次读取重新绑定；会改变旧信笔迹，不添加网页按钮。日常增添字体无需重洗。不删除、不分享实际部署数据。

## 上传后检查

浏览器打开：

```text
https://fontsforletters.sqnori.com/catalog.json
```

应看到 JSON，包含9款字体，`baseUrl` 为上面的域名。复制任一 `fonts` 记录的 `url` 确认能访问，再检查该条 `licenseUrl` 返回完整许可。仅地址栏可打开还不足以证明 CORS 正确，后续须在实际信箱页测试跨域加载。

## 官方说明

- 上传对象与控制台步骤：https://developers.cloudflare.com/r2/objects/upload-objects/
- CORS：https://developers.cloudflare.com/r2/buckets/cors/
- 公开桶与自定义域名：https://developers.cloudflare.com/r2/buckets/public-buckets/

操作说明核对于2026-11-03。本地 assets 生成通过摘要及完整许可格式检查；未自动上传、未发布、未改变当前实际桌宠的字体来源。
