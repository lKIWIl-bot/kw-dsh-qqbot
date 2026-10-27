# 图生视频可选扩展

正式版仅包含生图、LoRA、高清及QQ基础功能，不需要Wan。配套video扩展包与正式版0.1.0匹配；首次安装不自动开启、不下载模型。

## 安装和启用

先结束生成任务并停止桥接，保留现有配置。将独立扩展ZIP解压到任意普通目录，例如解压后的kw-dsh-qqbot-video-0.1.0目录。然后在正式版根目录执行：

~~~powershell
node scripts/extensions.mjs install video --from '扩展包解压目录'
node scripts/models.mjs --feature videoImage
~~~

命令只复制经过manifest逐文件校验的扩展源码、工作流、来源清单和离线测试，不执行安装包里的脚本。扩展属于可执行代码，只安装你已核对来源的配套包。工作流安装位置为extensions/video/video-workflow/qqbot-video.api.json。

按来源清单准备6份Wan权重，额外约39.73 GiB；Comfy安装沿用[COMFY.md](docs/COMFY.md)，模型放入实际Comfy模型目录并核对对应内置节点。确认comfyChat.enabled和Comfy地址后：

~~~powershell
node scripts/extensions.mjs enable video
node scripts/manage.mjs doctor
node scripts/manage.mjs start
~~~

enable仅设置本机comfyChat.features.video，不改变令牌、白名单、额度或生图设置。重启桥接加载扩展；默认仍只接受管理员身份和群内真实@。

## 指令

- /图生视频 [时长=3] [帧率=16] [像素=0.24] [种子=整数] 描述，并附图或明确引用单图。
- /视频状态 [编号]：查询当前会话自己的最近或指定视频。
- /取消视频 [编号]：取消自己的视频任务。

时长1~10秒、帧率8~24、像素0.12~0.35百万，省略使用示例默认值。视频与图片串行共用队列，支持原压缩发送和缓存清理规则。不提供文生视频，不自动实时播报。

## 停用、移除和更新

先结束视频任务并停止桥接，再执行：

~~~powershell
node scripts/extensions.mjs disable video
node scripts/extensions.mjs remove video
node scripts/manage.mjs start
~~~

停用后图片功能继续可用；移除仅删除清单内的扩展文件，保留共享模型、生成结果和缓存。目录内有额外文件、运行进程或未结束视频任务时拒绝变更。更新扩展先停用并移除旧版，再安装匹配版本。

未安装时/help 管理隐藏视频指令，误用视频指令会直接提示扩展未安装，不申请授权、不占额度、不调用Comfy。主项目的agent部署指引要求先询明功能范围，不能默认装上视频扩展或下载其权重。

## 开发与离线测试

源码仓库的addons/video是扩展开发源，运行时只加载经安装的extensions/video。直接克隆源码仍默认使用精简正式版。npm test验证基础版；npm run test:video会创建隔离副本并安装视频源码，执行合并离线测试，不改现有配置或调用真实GPU。仅有正式包时，可用node scripts/test-video.mjs --from 扩展解压目录测试。
