# 漂流瓶事件投递

本文按客户端 **0.9.3** 核对。0.9.0—0.9.2 已采用下列投递分级；0.9.3 调整的是开启聊天处理时的自主阅读与表达方式，保留原有唤醒节奏。主动邀请仍正常生效。

按工作区 docs/cortico-events-guide.md 及当前 Cortico WakeBus 契约实现。分类集中在 world/events.ts；实际推送与自描述共用同一声明，所有推送显式传 trigger，避免 internal 事件缺省 flush。

**1.0.0 待发布更新：**定时写信/打捞及自动补试使用 `bottle.scheduled-invitation` / piggyback，不独立唤醒；手动点击的邀请继续使用 `bottle.wake` / flush。自动邀请只排队一份，投递前重验当前资格；有效手动请求可替换尚未投递的自动邀请，旧任务失效，不多占自动预算。待办提醒独立为 `bottle.reminder` / piggyback，排队、render 都不计提醒次数，只有 delivered 后才计算下次间隔。被捡起和回信通知在 render 时重算“原信寄出多久”，不把查询时间写成被捡起/收到回信的时刻。系统信提醒受 `systemMailNotice` 控制，关闭同时阻止自动阅读；正文转述受 `headlessQuoteBody` 控制，默认只聊感想。

| 规则 | 事件 | 行为 |
| --- | --- | --- |
| flush | request、wake、reading、peruse、rewrite、note-request、note-reading、headless-reading | 立即投递整批。主动邀请与已选择的动作照常发生；不打断正在执行的模型或工具。 |
| debounce | mail、note-arrived | 使用宿主的 quietGap / maxBatchAge 等设置合并到达通知，不自行修改全局配置。 |
| piggyback | scheduled-invitation、reminder、sent、dismissed、picked、post、tsunami、star-memory | 等待其他对话、主动邀请等触发下一批，不单独获得投递许可，也不启动或延后合批计时器。 |

这里的短名称均带 bottle. 前缀。通知排队不等于正文已读：小纸条及无头自动阅读的系统信/回信只在 delivered 后标读；星笺记忆正文仍延迟 render，投递前检查当前授权，取消授权或停止后失效。无头关闭时回信到达仍只含元信息，不把全文加入状态通知。

主动写信、打捞与待办提醒仍使用原有 WakeScheduler；资格、暂停、拒绝、每日次数和补试逻辑不变。直接按钮与 Controller 的请求复用原业务方法。0.9.2 及以前，无头自动捞信要求先分享完整原文，系统信/回信的后台提示不自动附正文；小纸条已经自动递正文。

0.9.3 在开启「聊天里处理信件」后，自动捞信改为自主阅读并先分享感想，正文仅在伙伴问起时转述，保留 manual 回信及本轮禁寄/放弃限制。新系统信和回信改用外部延迟正文事件，仍沿用原 piggyback/debounce 节奏；小纸条也默认只分享感想。这三类后台自动到信轮均只读。关闭该模式时不自动交系统信/回信正文，收到纸条仍沿用既有递送行为；导入的历史纸条不自动重播。

事件 origin 按实际来源保持原规则：来信、署名、标题及 Controller 请求仍走 external；通知分级不把外部内容升级为内部指令。事件目录的说明给人查看，不占模型上下文；1.0.0 的通知正文统一使用简洁中文，信文与署名保留原样。未使用 preempt、interrupt、archive-only 或容易覆盖历史结果的 snapshot 标签。

## 伙伴称呼

World 模板彼此独立。1.0.0 待发布版的内置提示词直接写“伙伴”，英文使用 partner，不提供自定义命名、称呼占位或兼容变量；不读取其他 World 配置、部署名字或系统用户名。

不采集伙伴姓名，也不读取账号、系统用户名、聊天或其他身份来源。工具说明是固定 schema，不做模板展开，统一用英语 your partner。环境提示词以“你”指导桌宠，直接称呼“伙伴”；自定义旧模板中的称呼占位应改为同样的文字。

验证在 tests/event-delivery.test.ts 中连接真实 WakeBus，覆盖“不主动醒”“多次到达合批”“主动请求立即带入积压”“定时写信/打捞随对话投递”“手动请求优先”和“排队后资格变化”；tests/partner-name.test.ts 使用真实模板渲染验证称呼、缺省、更新及坏配置回退。
