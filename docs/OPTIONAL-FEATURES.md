# 可选生成组件

基础聊天不依赖Comfy。仅启用需要的comfyChat.features项，并运行doctor核对API图中的节点与模型文件名。仓库不自动下载模型。

| 功能 | 开关 | 工作流/依赖 |
| --- | --- | --- |
| Anima Base | image | image-workflow/qqbot.api.json；官方Anima Base、Qwen 0.6B编码器、Qwen VAE |
| 高清 | upscale | image-workflow/qqbot-upscale-2k.api.json及4k；IllustrationJaNai超分权重、附带DSH-Upscale节点 |
| 固定角色示例 | deepseek | deepseek鲸鱼娘LoRA及comfy-deepseek中的明确绑定，默认关闭 |

附带comfy-nodes仅包含本项目使用的本地辅助节点源码；复制需要的子目录到Comfy的custom_nodes并重启Comfy，不覆盖已有同名目录。第三方节点与权重需自行按其项目说明安装、核对许可。不要把整个模型目录打进GitHub。


图生视频单独打包，正式版不包含其实现或权重清单；通过根EXTENSIONS.md安装后再启用video。

各API图中的模型文件名和class_type是依赖清单的准确来源；doctor会逐项核对服务实际选择。

压缩输出使用本机配置的archivePassword，先生成ZIP再改后缀.z删ip；收件人恢复.zip后解压。ZipCrypto用于客户端兼容，不应作为机密传输保护。内容判定只看最终正面提示词中的明确描述，负面词不参与；不使用视觉审核。

大图临时预览需Python及Pillow，通过comfyChat.pythonPath指定解释器。原图文件发送与预览使用不同路径；预览失败不会盲目重复发送。

完整安装、公开下载来源、模型摆放和检查步骤见[COMFY.md](COMFY.md)与[model-manifest.json](../model-manifest.json)。
