# DeepSeek Harness接入

从[官方项目](https://github.com/deepseek-ai/deepseek-harness)提供的当前发布/安装指引取得DSH。已有DSH可复用，不需要为桥接重装。代码参考原部署的0.2.x预设/插件机制，其他版本需核对接口。

## 接入步骤

1. 安装并启动DSH，在DSH自己的设置中配置提供方、模型与有效凭据，先确认本体能正常聊天。
2. 在本项目运行setup，填写机器人和管理员；修改本机config.json中的dsh提供方/模型。baseUrl可留空使用已有发现逻辑；显式设置时使用DSH实际本机服务地址，不能照抄他人随机端口。
3. 执行node scripts/manage.mjs setup-dsh --profile desktop。命令行DSH按实际profile选择web等；不要把desktop和web同时盲装。
4. 保存DSH当前工作后完全退出并重开，使QQ预设和MCP加载。NapCat独立保持运行。
5. 启动桥接并查看日志，确认DSH连接、QQ预设可用。预设缺失时不退回有完整本地权限的默认预设。

setup-dsh会修改指定profile的相关配置，并按脚本规则保留备份；已有其他bundle应保留。Agent须核对目标profile，测试使用独立DSH_HOME，不用真实配置做安装回归。

普通聊天推理off；L2默认high。L2仍须管理员本人确认，工具操作需本人审批；默认不开放L3。Agent不能替用户回复确认码或通过审批。

## 常见问题

- DSH本体也无法聊天：先修复模型服务/凭据，不能用重启桥接代替。
- QQ预设或MCP缺失：检查安装profile、bundle注册和DSH重启；按安装输出处理解析错误。
- 端口或令牌错误：使用本机真实设置和发现逻辑，不在公开文档保存具体令牌。
- 沙箱目录拒绝访问：核对工作区所有者/ACL，先定位权限错误，不通过提升等级或关闭审批来绕过。
