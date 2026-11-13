# 漂流瓶事件投递

按工作区 docs/cortico-events-guide.md 及当前 Cortico WakeBus 契约实现。分类集中在 world/events.ts；实际推送与自描述共用同一声明，所有推送显式传 trigger，避免 internal 事件缺省 flush。

| 规则 | 事件 | 行为 |
| --- | --- | --- |
| flush | request、wake、reading、peruse、rewrite、note-request、note-reading、headless-reading | 立即投递整批。主动邀请与已选择的动作照常发生；不打断正在执行的模型或工具。 |
| debounce | mail、note-arrived | 使用宿主的 quietGap / maxBatchAge 等设置合并到达通知，不自行修改全局配置。 |
| piggyback | sent、dismissed、picked、post、tsunami、star-memory | 等待其他对话、主动邀请等触发下一批，不单独获得投递许可，也不启动或延后合批计时器。 |

这里的短名称均带 bottle. 前缀。通知排队不等于正文已读：小纸条只在 delivered 后标读；星笺记忆正文仍延迟 render，投递前检查当前授权，取消授权或停止后失效。普通回信到达仍只含元信息，不把全文加入状态通知。

主动写信、打捞与待办提醒仍使用原有 WakeScheduler；资格、暂停、拒绝、每日次数和补试逻辑不变。直接按钮与 Controller 的请求复用原业务方法。无头自动共读保留完整原文分享、manual 回信及本轮禁寄限制。

事件 origin 按实际来源保持原规则：来信、署名、标题及 Controller 请求仍走 external；通知分级不把外部内容升级为内部指令。事件目录的说明给人查看，使用中文；通知文字可用中文或英语。未使用 preempt、interrupt、archive-only 或容易覆盖历史结果的 snapshot 标签。

## 伙伴称呼

World 模板彼此独立，不会自动读到另一 World 的变量。漂流瓶在自己的 envPromptVars 中声明 bottle.user，只读部署 config.json 中 worlds.desktop-pet.user；模板用 `{{bottle.user | 伙伴}}`。称呼为空、非字符串或文件不可读时，变量为空并使用缺省。换行及控制字符转换为空格，最多八十个 Unicode 字符；不缓存上一次坏配置前的旧名字。

只取明确设置的称呼，不读取账号、系统用户名、聊天或其他身份来源；不写配置，不加入公开状态、草稿元数据或服务端信件负载。工具说明是固定 schema，不做模板展开，统一用英语 your partner。环境提示词继续以“你”指导桌宠，用 `{{bottle.user | 伙伴}}` 指代伙伴。

验证在 tests/event-delivery.test.ts 中连接真实 WakeBus，覆盖“不主动醒”“多次到达合批”“主动请求立即带入积压”和“原定时邀请仍能唤醒”；tests/partner-name.test.ts 使用真实模板渲染验证称呼、缺省、更新及坏配置回退。
