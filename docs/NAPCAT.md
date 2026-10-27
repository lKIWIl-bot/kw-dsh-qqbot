# NapCat安装与接入

本项目把NapCat作为OneBot v11后端；NapCat、QQ客户端和登录数据不随源码包分发。已有正常运行的NapCat可以直接配置连接，无需重装。

## 一、安装并登录

参考官方[安装入口](https://napneko.github.io/guide/install)和[Windows Shell安装说明](https://napneko.github.io/guide/boot/Shell)。按官方说明选择Windows安装包，解压到自己的独立目录。手动Shell方案使用相应launcher启动；一键安装方案完成后使用生成的napcat.bat。包名和入口可能更新，以该版本官方文档为准。

由本人完成扫码/登录，并确认登录的是你在项目botQQ配置的机器人账号。保留NapCat运行窗口或它的正常后台进程。不要把管理员QQ误作为机器人登录。

启动日志会给出WebUI地址和访问方式；常见端口为6099，冲突时可能变化，按日志中的实际地址打开。WebUI登录密钥与OneBot连接令牌是两个用途不同的配置，不要混填。详见官方[基础配置](https://napneko.github.io/config/basic)。

## 二、配置两条OneBot连接

在WebUI的网络配置中建立并启用以下服务。本项目由桥接主动连接NapCat，因此使用正向WebSocket服务端。

| 项目 | NapCat侧 | 桥接侧 |
| --- | --- | --- |
| WebSocket | 正向WS服务端，监听127.0.0.1，示例端口3001 | snowluma.wsUrl = ws://127.0.0.1:3001 |
| HTTP | HTTP服务端，监听127.0.0.1，示例端口3000 | snowluma.httpUrl = http://127.0.0.1:3000 |
| 鉴权 | 两条服务使用同一OneBot Token | snowluma.accessToken填相同Token |
| 消息格式 | 若界面提供选项，选择数组/消息段格式 | 桥接按OneBot消息段处理 |

若WS提供API、Event、Universal角色选项，应选同时支持API和事件的Universal。地址中的路径也须一致。端口示例可以修改，但两边必须对应。

保存配置，按NapCat提示重新加载或重启连接。WebUI的6099端口不能填作OneBot的3000/3001。连接方向说明见官方[网络通信](https://napneko.github.io/onebot/network)。

## 三、填写本项目配置

先运行setup创建本机配置，再编辑qq-bridge-enhanced-v1.0.0/config.json中的对应字段：

~~~json
{
  "snowluma": {
    "wsUrl": "ws://127.0.0.1:3001",
    "httpUrl": "http://127.0.0.1:3000",
    "accessToken": "填写你自己的OneBot令牌",
    "followDiscoveredEndpoint": false,
    "viaPlatform": false
  }
}
~~~

这里只展示需修改的局部，不要用它覆盖完整配置。snowluma是沿用上游的字段名，连接NapCat时仍使用这组字段。本说明采用直接连接方式，保留viaPlatform=false；除非主动改用接口平台，否则不要切换该项。

同机使用127.0.0.1。不同电脑或容器的127.0.0.1不是同一台主机；跨机部署需要另行配置网络和鉴权，本首版快速流程以同机为准。

## 四、接通顺序与验收

1. NapCat已登录，HTTP和正向WS服务均启用。
2. 项目setup完成，管理员和机器人QQ正确，令牌已填写。
3. setup-dsh注册完成后重启DSH。
4. 运行node scripts/manage.mjs doctor --offline检查静态配置，再启动桥接。
5. 查看项目日志确认QQ连接和DSH就绪。由管理员本人私聊机器人发送普通消息确认回复。
6. 需要群聊时再由管理员使用/添加群 群号；群内普通聊天须@或昵称唤醒，生成须实际@。

在线doctor主要核对Comfy模型与节点，不替代真实QQ收发验收；Comfy尚未启用时可先只验证聊天。

## 五、常见连接问题

- QQ在线但桥接未连接：检查正向/反向方向、端口、路径及Token；桥接此处应主动连接NapCat的WS服务端。
- 401/403：检查OneBot Token，不要用WebUI登录密钥代替。
- 只连接不回复：检查管理员/群白名单、触发条件、DSH预设和MCP加载；查看桥接日志中的具体错误。
- 使用了其他账号：本人退出并重新登录正确机器人，核对botQQ；不要改发送器校验来绕过身份检查。
- 重启电脑后：先启动NapCat并确认登录，再启动DSH和桥接；需要生成时还应启动Comfy。

本文按2026-10-27读取的官方文档整理，安装界面变更请优先参照上面的官方链接。项目不会替你下载、登录或自动修改现有NapCat部署。
