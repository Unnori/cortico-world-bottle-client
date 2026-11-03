# 字体授权审核与压缩记录

审核日期：2026-11-03。按“可随软件公开分发且可做 WOFF2 压缩”分类，不等同于字体无版权。本记录不是对作者权利的替代声明。实际版权/许可随可发布字体一起保存在 `world/fonts/licenses`。

## 已确认可按 OFL-1.1 分发/转换（9款）

- 霞鹜文楷等宽：LXGW / Klee Project Authors，字体原始 name 版权与作者仓库 OFL。
- 霞鹜悠哉：LXGW / Y.OzVox，字体原始许可字段与作者仓库 OFL。
- 小赖字体：LXGW / Nozomi Seto，字体原始许可字段与作者仓库 OFL。
- 內海字體：內海字体项目 / Nozomi Seto，原项目 README 和完整 SIL_Open_Font_License_1.1.txt；本地1.30版本的版权字段保留。
- 清松手写体1/2/8/9：Jason (Yu Ching Sung)。作者仓库 README 明确列1–9均用 OFL，配合本地 name 版权字段；1/2保留嵌入的完整许可证与保留名称。
- 隨峰體Plus：cjkFonts，原作者页面明确为 SIL Open Font License，本地 name 中版权与作者原样保留。

OFL 仍要求携带版权和许可证、不能单独售卖字体等。不能笼统标为“任意用途无条件可用”。

## 有限制（2款）

- **鸿雷小纸条青春体**：原始《字体使用声明.docx》允许商用设计，但禁止未经同意共享、公开网络传播，以及修改后再发布。原件与声明移到 `font-library/restricted`，不转换、不发布；不再做内置默认。
- **id-ftmaru400b-2.otf**：井上デザイン/井上優。官方免费汉字字体协议（infos_mb）覆盖 id-ぽっぷふとまる 系列，禁止第三方转让及格式转换等行为，免费版不等于开源。文件移到 restricted。

## 未确认（4款）

Muyao-Softbrush-2.ttf、PingFangShiGuangTi-2.ttf、QingSongShouXieTi1-2.ttf、YaoSuiXinShouXieTi-2.ttf。缺少对当前文件版本二次分发/转换的可靠作者许可，移到 `font-library/unverified`。其中旧清松的内部族名是 JasonWriting1 1.016，不能直接把新版 JasonHandwriting 的 OFL 套上去。字体家压缩包内通用《版权说明》不授予相应字体许可。未知不等于侵权，补充作者证据后再复核。

## 文件与原件

可发布 WOFF2：`world/fonts/redistributable`；可发布原件：`font-library/redistributable/originals`；其他分类同上。包外 font-library 整体 Git 忽略，不在 package.files 内，不会上传到 NPM。

`classification.json` 列逐文件哈希、字节量和依据，`sources.json` 列原始来源链接，`sources/` 留存核查文本；本地未知字体只留记录，不公开二进制。

## 压缩方式与兼容

脚本 `scripts/prepare-fonts.py` 使用隔离环境 fontTools/Brotli，无子集裁剪；关闭预处理变换，保留全部字形与表数据。保留原始空 DSIG 表，并直接设置 head 压缩标志，避免转换器顺带规范化旧时间戳。逐表比较源与解压后的字节：只允许 head 校验和和 WOFF2 压缩标志位差异，cmap/name/轮廓完全不变，满足 OFL FAQ 2.2.1 对未修改 WOFF/WOFF2 的条件；无需重命名字体内部保留名称。

`catalog.json` 将物理 WOFF2 对应原始文件名，所以旧字典和 `/fonts/` 摘要 ID 保持。对移出的字体保留字典值，页面用系统字体兜底，不隐式重洗。默认字体复用一份已许可的霞鹜悠哉 WOFF2，已有个人导入继续优先。

正式打包前校验脚本会拒绝未经审核的字体文件、目录与许可证缺失；不会阻止人自行导入字体供本地阅读。

## 复现

使用隔离 Python 环境安装 `fonttools==4.68.0`、`brotli==1.2.1`（本机另安装 zopfli==0.4.3，当前 WOFF2 不使用它），执行 `python scripts/prepare-fonts.py`。脚本复用已验证的输出，原始 TTF/OTF 备份保留；非空 DSIG 会停止转换，要求另行审核。执行 `node scripts/check-font-package.mjs` 核对发布文件。不要上传包外归档。

## 本次体积结果

- 已许可的同9款字体：151,441,326 → 73,161,652 字节，减少 51.69%。
- 完整安装包离线预览：110,828,019 → 79,628,410 字节，减少 28.15%。
- 解包体积：188,042,059 → 82,656,908 字节。

安装包降幅包含隔离6款非发布字体与格式压缩两部分，不能全算作 WOFF2 的压缩率。原始15款文件全部在本地归档保留。详细清单见 `size-report.json`；数字基于当时打包预览，后续仅文档变化会有少量差异。

## 验证结果

- 9款 WOFF2 与各自原件逐表一致，仅 head 的校验和和压缩标志位按容器要求不同；所有原件保留。
- 557项单元/集成测试通过，主程序与网页类型检查通过，extension-check通过。
- 实际浏览器解析9款 WOFF2；默认字体、个人导入覆盖/恢复、独立配对 LAN 来源的字体和背景加载通过。
- 阅读验证通过：种子署名字体、字号18–40、3种宽度×4种主题×2种明暗模式、标题同步缩放、长文换行与持久化。后台标签截图曾遇到 CDP 超时，关闭可选截图后完成全部断言；字体解析测试和外观测试截图不受影响。
- prepack校验与离线打包预览通过：只有9个审核字体，无 TTF/OTF 原件或隔离目录，包含9份完整许可。未发布、未推送、未重启实际桌宠。
