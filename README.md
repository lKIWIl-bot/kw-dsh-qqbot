# kw-dsh-qqbot

基于 DeepSeek Harness、NapCat 和 ComfyUI 的 QQ 机器人，支持聊天、Anima 生图、LoRA、高清放大、额度与队列管理；图生视频通过可选扩展接入，支持 Windows 本地部署。

推荐让agent帮忙部署

这个项目本来是让codex写来自用的，用了几亿token，朋友也想用干脆就整合一下发出来了，比较简陋。最开始我的想法就是把我的破＋的dsh接入qq，然后接入comfyUI进行生图，算是当一个能在QQ上直接交互的生图工具吧，比较方便，后面也加了一些功能。破＋我使用的是dsh-purge项目。

正式版默认使用官方 Anima Base；图生视频和网页下载通过各自独立扩展包安装。

完整介绍见[项目介绍](docs/PROJECT-INTRO.md)，首次部署先读[外部组件索引](docs/EXTERNALS.md)。

## 来源

项目部署与功能扩展基于 [h-D-ACE/dsh-qq](https://github.com/h-D-ACE/dsh-qq)。现有桥接源码同时保留 [Derpyu520/qq-bridge](https://github.com/Derpyu520/qq-bridge) 的版权与MIT许可证。详见 [NOTICE.md](NOTICE.md) 和 [LICENSE](LICENSE)。

## 功能

- QQ私聊和群聊、管理员白名单、群内@或机器人昵称唤醒。
- DSH聊天及需要本人确认与审批的分级远程操作。普通推理off，L2默认high。
- 官方Anima Base生图、LoRA叠加、原样正负提示词、管理员批量。
- 普通用户每滚动60分钟5张，串行队列与60秒间隔，管理员优先。支持临时追加额度和生成开关。
- 高清放大到2K/4K，支持全图优先或直接分块（新包默认分块，8GB建议）；图生视频为独立可选扩展，正式包不包含视频工作流、生成实现或模型清单。
- 最终正面提示词决定媒体是否密码打包；支持.z删ip输出、缓存和管线清理。

## 快速部署

1. 安装完整的Node.js 22.13以上版本（含npm）、DSH以及支持OneBot v11的QQ后端，例如NapCat。登录QQ由你本人完成。
2. 下载源码后进入项目目录，执行：

~~~powershell
npm ci --prefix qq-bridge-enhanced-v1.0.0
node scripts/manage.mjs setup
node scripts/manage.mjs doctor --offline
node scripts/manage.mjs setup-dsh --profile desktop
~~~

3. 在本机配置文件中填写OneBot地址及令牌；设置DSH连接。保存并完全重启DSH，使预设和MCP加载。
4. 执行下列命令启动桥接：

~~~powershell
node scripts/manage.mjs start
node scripts/manage.mjs status
~~~

首次配置默认仅开放管理员私聊，群白名单为空，Comfy关闭。双击install.cmd也可安装依赖并进入配置向导。

详细步骤见 [部署说明](docs/DEPLOYMENT.md)。维护入口：start、stop、status、logs、console。console仅启动控制中心，浏览器访问本机3099端口，按现有控制台流程认证。

## 开启生图

配置comfyChat.enabled=true及Comfy地址，准备好官方Anima模型、文本编码器和VAE，再运行doctor检查节点和模型选项。示例模型文件名已写在工作流中；不自动下载权重。

~~~text
/生图 一只蓝色小鲸鱼
/生图 #画风名称 一只蓝色小鲸鱼
/tag生图 PST/a small blue whale NGT/blurry
~~~

LoRA放进已配置目录即可发现。**触发词、推荐权重、特殊用法不一定包含在模型文件里；自动发现不代表这些信息已确认。** 查看doctor的提醒，并按作者说明补充可选同名JSON。详见 [LoRA接入](docs/LORA.md)。

## 图生视频扩展

正式版无需安装Wan模型。需要视频时另下载并解压配套video扩展包，通过scripts/extensions.mjs安装、核对模型后启用；默认仅管理员可用。详见[扩展安装与移除](EXTENSIONS.md)。安装不会覆盖现有QQ配置或生图模型。

基础生图与高清的4份标准权重共约5.37 GiB，不含Comfy/Python/Torch及缓存。视频扩展额外约39.73 GiB。

## 发布与验收

[Releases](https://github.com/lKIWIl-bot/kw-dsh-qqbot/releases)提供正式版、视频扩展、网页下载扩展和完整源码四种ZIP及校验文件。源码包包含addons/video开发源，运行时默认不安装视频；正式版部署包不带视频实现。版本内容见[RELEASE_NOTES.md](RELEASE_NOTES.md)，验收状态见[最终清单](docs/FINAL-CHECKLIST.md)。真实QQ与GPU验收独立于离线测试。

## 更多文档

- [ComfyUI部署与模型接入](docs/COMFY.md)
- [外部组件部署索引](docs/EXTERNALS.md)
- [NapCat安装与接入](docs/NAPCAT.md)
- [指令列表](docs/COMMANDS.md)
- [可选模型与节点](docs/OPTIONAL-FEATURES.md)
- [后端扩展说明](docs/EXTENDING.md)
- [验证记录](docs/VALIDATION.md)

本仓库不包含QQ登录数据、聊天记录、模型权重、私人LoRA和生成结果。仓库地址：[lKIWIl-bot/kw-dsh-qqbot](https://github.com/lKIWIl-bot/kw-dsh-qqbot)。源码仓库中的addons/video仅用于单独构建扩展包，不会被运行时自动加载；正式包排除此目录。

开启或关闭comfyChat.enabled后，请在DSH中重新加载QQ MCP服务，或完全退出并重启DSH；桥接也需重启读取新配置。仅重启桥接不会刷新DSH已缓存的工具列表。

## 高清模式和网页下载

高清可选全图优先或直接分块，说明与显存预留估算见[高清与显存](docs/UPSCALE.md)。8GB建议tiled，新包默认tiled，普通QQ指令不变。

网页下载使用独立web-media扩展，不占Comfy显存、不要求视频扩展。支持/下载图片、/下载视频、/下载文件以及管理员正常/加密抓取，详见[扩展部署](EXTENSIONS.md)。主包默认不安装、不启用下载。

## 是否需要先部署原项目

**不需要另外克隆、安装或启动[h-D-ACE/dsh-qq](https://github.com/h-D-ACE/dsh-qq)。** kw-dsh-qqbot已包含所需的QQ桥接源码、预设/MCP安装工具及本项目扩展接口；该链接用于说明上游来源，不是额外运行依赖。仍需部署DeepSeek Harness本体、Node.js、QQ后端（如NapCat），生图/高清另需ComfyUI与相应模型。已有同账号桥接先停用或迁移配置，避免同时运行两套自动回复。
