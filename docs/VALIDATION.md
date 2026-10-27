# 验证记录

2026-10-27，0.1.0发行记录；CI及下载包以GitHub仓库页面为准。

基础91项、含video扩展106项离线测试覆盖官方Anima、LoRA、高清、额度、队列、权限、扩展生命周期及本地OneBot模拟通信。新增9项传输测试检查Bearer认证、echo关联、事件、API失败、超时、断线、重连、长超时上传及请求不自动重放。真实验收已另行通过：Anima 512x512、8步生图，默认高清2048x2048全图处理且无分块回退；经本人明确允许向管理员私聊发出两图，回执确认2张，且本人回复已收到。

当前已移除@snowluma/sdk、@snowluma/mcp和对应postinstall修补，ws锁定8.22.0。锁文件127个条目均有声明许可；完整列表见根THIRD_PARTY.md。旧锁文件7项已知漏洞已按兼容版本范围修复，当前npm audit为0项。原LICENSE附录为保留的上游历史记录，当前状态以NOTICE.md和锁文件为准，不声称外部模型或服务获得统一授权。

干净安装、源码/归档逐文件比对、SHA256及隔离DSH profile检查结果记录于本地.build；安装环境不复用现用机器人的node_modules。正式包排除addons开发源和本机配置；完整源码包包含addons，运行时默认仍不加载视频。扩展API v1需匹配0.1.0，正式版4份权重约5.37 GiB，视频扩展6份约39.73 GiB。

~~~powershell
npm ci --prefix qq-bridge-enhanced-v1.0.0
npm test
npm run test:video
npm run check
npm run release
npm run release:video
npm run release:source
~~~

test:video使用临时隔离副本；仅有正式包时通过--from提供扩展解压目录。复用已有模型，未下载大模型、改真实DSH配置或改动现用桥接；QQ发送仅限本人批准的两张测试图，临时配置中的令牌已清除。公开版完整DSH聊天路由没有接管现用机器人验证，视频扩展的真实GPU生成未作为基础版验收项。详情见FINAL-CHECKLIST.md。

MCP注册验收：更新后的SDK能够初始化QQ、状态和网页三项stdio服务；隔离配置中Comfy关闭时不公开生图工具，开启并重载后公开带ticket约束的工具。这里只列工具，不执行工具调用。
