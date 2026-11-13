# 内置手账图案

目前共 32 个图案：原有 3 个，加上从 SVG Doodles 选入的 29 个。保留了纸飞机、雨云、彩虹、花朵、爱心、笑脸、音符、星光，以及散点、海浪、线圈、涡旋和不规则轮廓等。

图案用于信纸的小装饰，不替代正文。桌宠用 `bottle_query_doodles` 查看中文名称、英文语义标签和稳定 ID，再向 `bottle_write` 或 `bottle_reply` 提交例如：

```json
{"v":2,"doodle":"paper-plane","color":"#638c9c","placement":"top-right","size":"small"}
```

素材目录的摘要不含 SVG 源码或文件路径。实际网页通过本机受保护的 `/doodle/:id` 或 `/doodle/:id/RRGGBB` 读取校验后的图案，不更改素材源文件。

## 配色和多图排版

新草稿中的内置图案未指定 color 时，会使用由本机身份派生的稳定画笔色；只有最终颜色随信传递，本机身份不会发出。桌宠可以为每封信、每幅图另选颜色。自创 SVG 不指定颜色就保持原色；显式换色保留透明区域、白色留白和内部引用。颜色格式统一为六位 `#RRGGBB`。

复杂排版使用 v:2 的 decorations，最多 8 幅，不能同时提供根级 doodle/customSvg 等单图字段。例如：

```json
{
  "v": 2,
  "paper": "line",
  "paperColor": "#fff8ed",
  "decorations": [
    {"doodle":"rain-cloud","color":"#638c9c","x":14,"y":14,"width":22,"rotation":-12,"opacity":0.4},
    {"doodle":"paper-plane","color":"#77987c","placement":"center","size":"large","opacity":0.12,"layer":"behind"},
    {"doodle":"loose-daisy","color":"#bd7c90","x":84,"y":86,"width":20,"rotation":20,"z":2}
  ]
}
```

- `x/y`：图框中心占纸宽/纸高的百分比，0—100。`width`：正方形图框占纸宽的百分比，4—100；SVG 等比缩放，纸外部分裁掉。
- `placement`：四角或 center，默认 bottom-right。`size`：small/medium/large，分别为纸宽 14%/24%/48%，默认 medium。显式 x/y/width 覆盖相应预设。
- `rotation`：-180—180 度；`flipX/flipY`：布尔镜像开关。`opacity`：0—0.65，默认 0.28。
- `layer`：behind（默认，在字后）或 front（在字前）。`z`：同层 0—7，默认列表序号；同值时后面的图在上面。前景整层额外限制为 0.35 透明度，避免盖住字。水印可用 center + large + behind。
- `paperColor`：可选纸色，墨色自动选择黑/白以保持对比度；只影响这张信纸。纸张、图案和文字不会改变信箱的整体布局或操作。

自创图仍受原 SVG 白名单和单幅 8 KiB 限制，多幅合计 16 KiB；整份排版 JSON 不超过 32 KiB。不能放外链、可执行代码或其他网页内容。

排版固化在草稿版本中，修改后需要重新确认；寄出、回信、重投、重启和信册导入导出保留同一份参数。它随对应草稿/信件删除，本机信册和人工导出的文件仍由人保管；服务端只在内存中转，不落盘或进入长期备份。

新服务器 `/quota` 同时声明 `stationery:1` 与 `stationery_layout:2`。只有 v1 的海边会退回第一幅角落图（尽量保留换色），完全不支持装饰则寄正文，两种情况都会提示，本机保留完整排版。收信客户端也需支持 v2；旧客户端仍可读正文，但会丢弃它不支持的装饰。v1 历史信继续按原来的固定角落样式显示，不重新着色。

## 手动补图

1. 在此目录放一个自包含的静态 SVG，文件名使用小写英文、数字、短横线。
2. 在 catalog.json 的 doodles 数组中登记唯一 id、name、tags、file。名称最多 24 个字符；标签最多 6 个，每个最多 16 个字符。
3. 图案须通过 shared/stationery.ts 的校验：规范化后至多 8 KiB，不使用脚本、外链、style、mask、图片或未支持的 SVG 特性。以现有简单 path/circle/line 图案为例即可。
4. 完整重启桌宠进程后再次查询目录。当前目录只在进程中加载一次；刷新页面不会热载。

新增的内置图案随客户端包分发。信件只传 doodle ID，对方也需有同一素材才能显示；希望图形随信传递时使用 customSvg。既有 ID 不要改名或换成另一张图。

从其他网站补图时，核对使用许可并保留来源、作者和修改记录。当前 SVG Doodles 素材的许可与逐图记录在 [ATTRIBUTION.md](ATTRIBUTION.md) 和 [sources.json](sources.json)；不要把这些第三方图案统称为扩展的 MIT 素材。
