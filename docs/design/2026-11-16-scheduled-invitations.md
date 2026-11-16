# 1.0.0 定时邀请随对话投递

用户明确要求：定时写信、打捞改 piggyback，其他主动动作保留 flush；这是范围明确的小改动，直接按要求实施。

自动任务（包括一次有界补试）使用 bottle.scheduled-invitation / piggyback，手动任务保留 bottle.wake / flush，待办提醒保持 bottle.reminder / piggyback。各事件声明和实际推送共用分类，不通过同一事件的隐藏 trigger 覆盖来区分。投递前现算提示并重验原有资格；不改变正文权限、寄送确认、每日预算与补试策略。

有效手动请求可替换尚未投递的自动任务；旧任务 ID 失效，因此同一 flush 批中不会重复邀请。不替换已在处理的任务，不越过暂停、拒绝与手动冷却。界面说明“已备好，等下次对话或其他消息带入”。

真实 WakeBus 回归验证两种定时任务均不启动投递，聊天事件带入、手动跨类型邀请优先、直接写信立即投递、旧资格失效不扣次数。沿用 WakeScheduler 原有重启/跨日/拒绝/暂停/上限测试。更新自描述与 1.0.0 Changelog，继续只保留本地修改。

验收：邀请、调度、页面与无头相关 6 个测试文件 216 项全部通过；两套 TypeScript 与官方扩展检查通过，16 工具、18 事件。新面板 2fdbb21569ed，CSS 54c96e358147。

沿用本轮用户已授权的真实宿主挂载：先备份本机 SQLite，经 /api/run/restart 正常保存后重新启动，运行资源字节与本地一致。新开的真实设置页显示 V1.0.0、定时邀请随对话带入的说明与数据卡片，验证标签页已关闭。重启前后既有记录正文、装饰与未寄表达无变动，quick_check=ok。未触发真实写信/打捞，也未提交、发布或部署中央服务端。

结果：根 artifacts/validation/bottle-scheduled-invitations-20261116.json 与 bottle-scheduled-live-panel-20261116.json。
