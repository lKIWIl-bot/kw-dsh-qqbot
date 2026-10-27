# 部署与维护

## 环境

首版验证目标是Windows x64、Node.js 24（最低22.13）、DSH桌面版、OneBot v11 QQ后端。不要仅因源码包含其他系统工具就假定支持Linux/macOS。

安装依赖使用桥接目录中的锁文件和.npmrc，后者保留上游legacy-peer-deps安装策略。不要复制他人的node_modules。本版不再安装或修补SnowLuma SDK；WebSocket使用本地OneBot适配器和ws。

## 第一次配置

运行node scripts/manage.mjs setup，输入管理员及机器人QQ。无人值守可使用setup --owner 管理员QQ --bot 机器人QQ。已有配置会保留，不会自动覆盖。

配置文件：qq-bridge-enhanced-v1.0.0/config.json。

| 配置 | 含义 |
| --- | --- |
| ownerQQ / botQQ | 管理员与机器人身份，不可相同 |
| snowluma.wsUrl / httpUrl / accessToken | OneBot地址与令牌，必须与QQ后端一致；字段名沿用上游 |
| dsh | DSH本机地址、提供方和模型；令牌按DSH实际要求设置 |
| allow.private / groups | 私聊和群白名单，默认只有管理员私聊 |
| sessionCwd | 相对桥接目录的QQ工作区，默认../qq-workspace |
| comfyChat | 可选生成服务设置 |

不要把令牌放进URL、截图、公开日志或Git。向导生成本地控制台令牌和压缩密码，查看或修改密码请编辑本机配置。

先登录QQ并开启OneBot正向WebSocket和HTTP。执行setup-dsh注册QQ预设/MCP后，完全退出再打开DSH。此命令只在你要部署的DSH profile运行；不需要重装DSH。第三方profile文件由安装脚本按其逻辑备份，请保留备份。

默认保留L0聊天；L2需本人完成确认，命令仍走审批。不要让agent代回确认码或自动批准。

## Comfy设置

把comfyChat.enabled设为true，url设为本机服务地址。默认image-workflow/qqbot.api.json使用官方anima-base-v1.0.safetensors、qwen_3_06b_base.safetensors、qwen_image_vae.safetensors。节点版本、文件实际名称以你安装的Comfy为准；运行doctor会核对模板节点及模型选项。

modelsDirectory填写Comfy共享models目录，或comfyDirectory填写Comfy安装目录，即可扫描其中models/loras。额外路径通过comfyChat.loras.directories逐项设置；Comfy自身也必须能访问相同文件。不会自动解析或修改Comfy的extra_model_paths.yaml。

Comfy后端与节点需自行启动。doctor仅检查，不执行生成；--offline不访问Comfy。默认高清关闭，依赖就绪后启用upscale。图生视频不在正式包内，需要独立扩展；安装和启停见根EXTENSIONS.md。

## 日常维护

~~~powershell
node scripts/manage.mjs start
node scripts/manage.mjs status
node scripts/manage.mjs logs
node scripts/manage.mjs console
node scripts/manage.mjs stop
~~~

服务隐藏窗口运行，日志在桥接state目录。start会拒绝占用中的端口，避免误连另一套部署。stop只停止能核对归属的本项目进程；生成或发送未结束时先等待，必要时由管理员/清理管线。控制中心是独立入口，不会因打开页面自动登录QQ。

## 升级与备份

停止旧桥接，保留整个旧目录。将新版本解压到新目录，安装依赖，然后复制自己的config.json、image-workflow/loras.local.json和桥接state目录；自行修改的工作流也需备份并逐项迁移。历史媒体回查/解压需要qq-workspace的images、archives等结果目录，按需一并迁移，勿混用两个运行实例。

重跑doctor、setup-dsh后重启DSH，再启动新桥接。验证成功前不删除旧目录。自动更新和递归清理旧部署不在首版范围。

## 故障定位

- 不回复：核对机器人登录、OneBot令牌、白名单、群内触发与DSH预设加载。
- 生图缺模型：运行doctor，按具体缺项安装，不要靠改名伪装另一种权重。
- 新LoRA看不到：检查目录、模型元数据和同名JSON，运行loras或管理员/刷新模型。
- 任务卡住：先查询/生图状态，再由管理员决定/清理管线；不自动重发发送结果未知的媒体。
- 睡眠导致后台停工：由使用者自行选择电源策略，项目不会改系统设置。

## DSH版本范围

源码沿用DSH 0.2.x预设/插件机制，原部署参考版本为0.2.1-rc.2。公开版的真实DSH联调尚未进行；不同版本应先验证预设、MCP和权限接口，不承诺所有版本通用。

## NapCat详细接入

安装、QQ本人登录、OneBot正向WS/HTTP、令牌对应与验收步骤见[NapCat安装与接入](NAPCAT.md)。已有后端直接复用，无需随机器人重装。

## 所有外部组件

从零部署请先读[外部组件索引](EXTERNALS.md)，再按[DSH](DSH.md)、[NapCat](NAPCAT.md)、[Comfy](COMFY.md)对应步骤执行。已有环境先检查再复用。

开启或关闭comfyChat.enabled后，请在DSH中重新加载QQ MCP服务，或完全退出并重启DSH；桥接也需重启读取新配置。仅重启桥接不会刷新DSH已缓存的工具列表。
