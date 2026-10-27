# 外部组件部署索引

本仓库提供桥接源码、受控工作流和配置工具，不包含外部程序、权重或账号登录数据。按“聊天最小安装→Anima→其他功能”逐层部署，避免一次下载所有模型。

| 部件 | 何时需要 | 来源及本项目指引 | 验收 |
| --- | --- | --- | --- |
| Node.js | 必需 | [官方完整安装包](https://nodejs.org/en/download)，建议24 LTS；最低22.13；需含npm | node --version、npm --version；按锁文件npm ci |
| Git | 使用git下载代码时 | [官方Windows下载](https://git-scm.com/downloads/win)；也可下载源码ZIP | git --version或成功解压 |
| DeepSeek Harness | 必需 | [官方项目](https://github.com/deepseek-ai/deepseek-harness)；[DSH接入](DSH.md) | 先在DSH本体能聊天，再检查预设/MCP和权限 |
| NapCat及QQ | 必需的QQ后端方案 | [NapCat官方文档](https://napneko.github.io/guide/install)；[安装与接入](NAPCAT.md) | 本人登录机器人QQ、WS/HTTP接通、管理员私聊收发 |
| 模型服务凭据 | DSH聊天需要 | 在DSH内配置所选提供方的有效凭据；不把密钥写进仓库 | DSH本体普通对话成功 |
| ComfyUI | 生图/高清时；视频需额外扩展 | [部署指引](COMFY.md)，可复用已有实例 | /object_info可用、doctor通过、人工选择一次生成测试 |
| Python与GPU运行环境 | Comfy使用 | 优先使用Comfy自己的环境；手动安装遵循[官方说明](https://docs.comfy.org/installation/manual_install) | 当前Comfy解释器和Torch后端可用；不混用系统pip |
| 自定义节点 | 按功能选择 | [Comfy节点和模型](COMFY.md) | API中出现所需class_type，重启后仍正常 |
| 模型及LoRA | 按功能选择 | [模型清单](../model-manifest.json)、[LoRA说明](LORA.md) | 路径、大小/哈希、Comfy选择项和实际加载分别验证 |

## Agent执行顺序

1. 读取根AGENTS.md、本文和对应组件指引。先只读盘点已有组件、版本、显存、磁盘、端口及授权范围。不要迁移或重装正在工作的实例。
2. 确认部署目录、管理员QQ、机器人QQ和模型提供方。凭据由用户填写或通过本机安全配置读取，不回显到聊天或日志。
3. 先安装Node/桥接并接通DSH、NapCat，完成聊天验收。QQ扫码、模型站点的许可接受等本人操作明确通知用户。
4. 用户需要生成时再读COMFY.md，用scripts/models.mjs列出对应功能下载清单和总量；已有正确文件复用。用户已授权的安装/下载无需反复确认，未授权的大规模下载先说明大小并取得授权。
5. 正式版只部署生图和高清；用户明确需要视频时先读根EXTENSIONS.md，再安装可选扩展。只安装所选功能所需的节点与模型；新增Python包须使用该Comfy实例解释器，不随意升级现有Torch或显卡驱动。
6. 执行doctor和模型检查。LoRA触发词、推荐权重及特殊用法缺失时立即提醒，不自行猜测。
7. 分别报告“依赖已安装”“静态/API检查通过”“真实GPU测试通过”“QQ收发通过”，没有做过的步骤明确标注未验证。

## 停止点

账号未登录、模型需要许可确认、下载来源无效、底模未知、节点接口不符时，先处理对应项，不能通过改名、忽略断言或换成未知权重伪装成功。可选功能缺失不应阻止已配置的聊天。

程序、SDK、节点和模型各自遵守原许可；源码MIT不覆盖它们。锁定npm依赖及许可声明见根THIRD_PARTY.md；本版不再依赖两个SnowLuma npm包。
