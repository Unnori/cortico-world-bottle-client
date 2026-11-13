# 无头热开启后工具缺失（0.9.1）

0.9.0 在 tools() 中按 headlessEnabled 返回工具子集，但开关声明为热更新。Cortico MainLoop 的 assembleTools/bindWorlds 只在 bootstrap/buildSystem 重绑，modulePrefixDrift 仅提示变化，不立即替换请求工具表。因此自动共读读取实时开关已经启用，模型却仍拿着启动时缺少草稿工具的 schema。

0.9.1 固定注册全部声明，以执行时实时开关作为权限闸。默认仍关闭，所有无头 handler 均检查 headlessProblem；已有的逐轮意图、自动共读当轮禁寄、draftId/revision 与明确确认规则不变。回信复用 bottle_reply。不开启不提供正文，也不能发送；关闭立即拦截已缓存 handler。仅客户端修复，中央服务端继续为 0.9.0。

tests/headless-session.test.ts 用真实 createBot/Core/MainLoop 与合成模型捕获实际请求 schema，先以关闭状态建立会话，再热开启完成捞取/共读/manual 回信，验证当轮发送被拒；下一次合成伙伴确认轮列稿/看稿/寄出，最后关闭并验证已缓存工具拒绝。测试只使用临时目录、内存海边、合成信件与模型，不读取真实聊天，不重启真实宿主。
