# ComfyUI从安装到接入

## 先选最小功能

仅聊天不需要Comfy。标准生图使用官方Anima Base：三份权重合计约5.24 GiB，另留程序、虚拟环境、输出及缓存空间。高清按需安装；图生视频通过独立扩展安装，不自动下载全套。

模型清单为[model-manifest.json](../model-manifest.json)，包含公开来源、固定版本URL、精确文件名、目标目录、大小和SHA256。2026-10-27已查询仓库文件元数据，不等于已在所有硬件下载/运行验证。

~~~powershell
node scripts/models.mjs --feature image
node scripts/models.mjs --feature upscale
~~~

这些命令只列出文件，不下载。用户授权后按清单下载；网站不可达时报告原因，不能随意改用无来源的网盘或同名权重。Anima权重遵守模型作者自己的许可，不因可公开下载就代表无限制使用。

## 1. 安装或复用Comfy

Windows用户可使用[官方Comfy Desktop指引](https://docs.comfy.org/installation/desktop/windows)。按首次启动向导选择本机运行，创建实例并启动它；仅打开启动器不代表后端已运行。已有工作实例先核对路径和端口，不直接迁移或覆盖。

需要手动部署时遵循[官方手动安装](https://docs.comfy.org/installation/manual_install)：建立独立Python环境、获取[ComfyUI源码](https://github.com/Comfy-Org/ComfyUI)、安装适合硬件的Torch和依赖，再启动main.py。不同硬件/驱动对应不同Torch安装方式，不复制本项目作者机器的CUDA参数。Agent记录实际版本，不擅自更改驱动或替换正常的Torch环境。

记下实例的实际API地址、Comfy代码目录、共享models目录和Python解释器路径。默认示例http://127.0.0.1:8188，若端口不同则在机器人配置中同步修改。

## 2. 先准备官方Anima Base

按清单把三份文件放入Comfy识别的models目录：

~~~text
models/
  diffusion_models/anima-base-v1.0.safetensors
  text_encoders/qwen_3_06b_base.safetensors
  vae/qwen_image_vae.safetensors
~~~

默认工作流不要求额外角色、画风或隐藏手部LoRA。模型官方来源：[CircleStone Labs Anima](https://huggingface.co/circlestone-labs/Anima)。普通/生图就是官方Base，不需要另发/生图base。

Desktop可使用共享models位置；手动实例使用其models目录。使用额外目录时先在Comfy自己的模型路径配置中登记，使它能列出文件，再给机器人配置相同位置。不要把diffusers多文件目录当成这里的单文件权重。

## 3. 按需安装节点

| 功能 | 第三方节点/环境 | 本项目附带节点 |
| --- | --- | --- |
| Anima Base | 更新到支持相应模型的Comfy内置节点 | 无 |
| 超分 | Comfy的UpscaleModelLoader及其Spandrel支持 | DSH-Upscale |

节点通过其官方安装方式，或在目标实例custom_nodes目录安装。复制comfy-nodes中的对应子目录时不要覆盖已有同名目录；安装依赖使用该实例的Python，例如 & '解释器完整路径' -m pip install -r '节点目录/requirements.txt'。没有requirements文件时只安装该节点文档明确要求的包。安装后重启Comfy并检查节点注册。



超分使用公开可取得的IllustrationJaNai转换文件，清单同时列出原作者发布与社区转换来源，不需要部署者自行从私人缓存提取/转格式。

## 4. 按需安装视频扩展

正式包仅包含基础生图和高清的4份标准权重清单。需要图生视频时先按根[EXTENSIONS.md](../EXTENSIONS.md)安装配套video扩展，再运行models --feature videoImage核对6份Wan组件；未安装时该功能名会明确拒绝。不要在基础部署中自动下载Wan。

## 5. 配置机器人并检查

~~~json
{
  "comfyChat": {
    "enabled": true,
    "url": "http://127.0.0.1:8188",
    "modelsDirectory": "E:/Comfy/models",
    "pythonPath": "E:/Comfy/.venv/Scripts/python.exe",
    "features": {"image": true, "upscale": false, "video": false, "deepseek": false}
  }
}
~~~

这只是局部示例，路径按实际填写，保留setup生成的其他配置和压缩密码。modelsDirectory用于目录扫描；pythonPath供大图预览等辅助处理，不能用“系统中另一个python”替代当前实例。

~~~powershell
node scripts/models.mjs --feature image --models-dir 'E:/Comfy/models'
node scripts/models.mjs --feature image --models-dir 'E:/Comfy/models' --hash
node scripts/manage.mjs doctor
~~~

模型检查先核对大小，--hash完整读取文件计算校验，耗时随文件体积增加。doctor通过/object_info核对节点与选项，不执行生成。先只开启image；其他功能依赖就绪后再分别开启。video只能在独立扩展安装并核对模型后启用。

## 6. 真实验收与Agent提示

取得用户对测试的授权后，先在Comfy中运行一次低成本Anima生图，再用QQ管理员发送/生图。高清单独测试；安装视频扩展后再单独测试图生视频，记录实际成功的功能，避免同时向GPU提交多个验证任务。首次验证失败按节点、模型、OOM、发送回执区分，不盲目重试或中断其他任务。

LoRA放入目录后可发现，但触发词、权重和特殊用法仍需核实。安装视频扩展后，Wan的加速LoRA属于工作流内部依赖，不会作为Anima画风出现在/loras。


本仓库主要提供API工作流，不把它们冒称为完整可视化UI工程。人工首次测试可用Comfy内置Anima模板或模型作者的UI示例；agent通过API测试时仍须遵守本项目的受控图绑定与用户授权。

## 磁盘预算

仅Anima基础生图的3份权重合计约5.24 GiB。正式版基础生图和高清共4份标准权重，合计约5.37 GiB；可选视频扩展另外6份约39.73 GiB，全部安装共约45.11 GiB；这是模型净大小，另外需要为Comfy/Python/Torch、Node依赖、下载临时文件及生成缓存留空间。个人LoRA按实际大小另计。项目源码归档不包含这些权重。

开启或关闭comfyChat.enabled后，请在DSH中重新加载QQ MCP服务，或完全退出并重启DSH；桥接也需重启读取新配置。仅重启桥接不会刷新DSH已缓存的工具列表。
