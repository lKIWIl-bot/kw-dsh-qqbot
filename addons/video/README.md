# kw-dsh-qqbot 图生视频扩展

适用于kw-dsh-qqbot正式版0.1.0，扩展API版本1。仅管理员可用，保留真实@、白名单、ticket、串行队列、压缩发送及缓存恢复规则。只提供图生视频，不提供文生视频。

解压扩展包，停止桥接后，在正式版目录执行：

~~~powershell
node scripts/extensions.mjs install video --from '扩展包解压目录'
node scripts/models.mjs --feature videoImage
~~~

依据清单核对6份Wan权重、对应Comfy内置节点及空间；命令只列来源，不下载。准备完成再启用：

~~~powershell
node scripts/extensions.mjs enable video
node scripts/manage.mjs doctor
node scripts/manage.mjs start
~~~

comfyChat.enabled仍须开启。工作流安装后位于extensions/video/video-workflow/qqbot-video.api.json。安装命令不改令牌、白名单、额度、模型目录或已有模型，默认不启用视频。

指令：/图生视频 [时长=3] [帧率=16] [像素=0.24] [种子=整数] 描述，同条附图或明确引用图片。时长1~10秒；帧率8~24；像素0.12~0.35百万，默认3秒/16帧/0.24百万像素。仅查询时返回状态，不实时播报。

模型采用Wan2.2 14B FP8成对专家、Lightx2v四步LoRA、UMT5 FP16和Wan2.1 VAE。显存随参数与Comfy版本变化；16GB可作为部署起点，24GB更宽裕，属于建议而非实测下限。低显存需动态卸载、降低参数并验证；没有对本公开包进行真实GPU验收。

停用或移除前先结束任务并停止桥接：

~~~powershell
node scripts/extensions.mjs disable video
node scripts/extensions.mjs remove video
node scripts/manage.mjs start
~~~

停用仅关闭视频；移除只删经过清单校验的扩展文件，保留模型及生成缓存。模型是外部共享资产，不自动删除。更新扩展先停用、移除旧版再安装，重新核对模型后启用。安装后完整重启桥接以重新加载模块；通常不需重启DSH。来源与当前依赖说明见正式版NOTICE.md，外部模型和程序继续遵循各自许可。
