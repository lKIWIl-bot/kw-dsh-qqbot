# 网页下载可选扩展

适用于kw-dsh-qqbot **0.1.1或更新的兼容版本**。将网页图片、视频及其他文件下载后发送到原QQ会话，也支持根据真实用户要求先搜索来源。它不生成图片，不需要Comfy、CUDA、显卡模型或L2远程权限；主包默认不安装、不启用。

## 安装与启用

先结束任务、停止桥接，备份本机配置。在主项目目录运行（--from填写本扩展解压后含manifest.json的目录）：

```powershell
node scripts/extensions.mjs install web-media --from '扩展包解压目录'
node scripts/extensions.mjs enable web-media
node scripts/manage.mjs doctor --offline
node scripts/manage.mjs start
```

启用后还需在DSH重新加载QQ MCP，或保存工作后完全重启DSH，才能看到qq_web_media工具。安装只复制和校验清单文件，不自动执行包中代码；真正启用后，扩展会作为桥接代码运行，请核对来源。0.1.0旧主包没有这个接口，须先升级主包，不能仅把扩展文件塞进旧目录。

config.json中的webMedia.enabled控制总开关；webMedia.ffmpegPath可填写本机FFmpeg完整路径（路径中的反斜线需按JSON转义，也可用/）。未填写时尝试KW_DSH_FFMPEG_PATH或PATH中的ffmpeg。只有m3u8/HLS合并需要FFmpeg，图片、普通直链视频和文件不需要；本包不捆绑或下载FFmpeg。可从https://ffmpeg.org/download.html选择可信构建，核对ffmpeg -version可用。

网页自然语言搜索复用主项目的web-search能力和原DSH/DeepSeek配置，可能产生搜索API费用；没有可用API凭据时按原搜索模块逻辑回退公开搜索。无需把令牌写进QQ指令。显式下载指令可独立于DSH模型处理；自然语言搜索、选择和批量下载工具使用reserved2模式的当前会话令牌，其他聊天模式可使用显式链接指令。

## 指令

普通用户（须已在现有白名单）：

- /下载图片 链接 [序号] —— 下载网页图片或图片直链，默认第一项。
- /下载视频 链接 [序号] —— 下载网页视频或视频直链。
- /下载文件 链接 [序号] —— 下载其他文件；不执行文件内容。

管理员在目标会话发送：

- /正常抓取 —— 直接发送；较大媒体按文件上传。
- /加密抓取 —— 后续下载按本会话模式加密为.z删ip文件。
- /清除抓取缓存 —— 清理已结束的下载缓存，跳过正在传输或预览的文件。
- 引用机器人本会话已登记的抓取包＋/解压 —— 仅图片/视频可临时直发，90秒后撤回；保留原压缩包。

群内下载与模式指令须**真实@机器人**；提到昵称不能代替下载授权。沿用主包的私聊/群白名单，安装不开放任何新群或新用户。/关闭生图针对调用Comfy的生成指令，不是下载开关；停用下载使用disable web-media。

## 下载、发送与缓存

每次真实请求最多图片100张、视频10个、其他文件100个，混合分别计数；未指定数量默认一个。显式指令一次选一项，MCP支持candidateIds批量提交，后台串行下载，结束发送批次摘要。同一真实请求去重，失败不冒充成功，发送回执未知时不自动重发。

图片上限24MiB，视频/其他文件上限4GiB；超过20MiB或不适合原生直发的媒体按文件上传，实际仍受QQ/NapCat和网络限制。支持普通公开HTTP(S)与有限的静态网页/播放器解析，HLS限120分钟，不支持加密/DRM、直播、登录和需要浏览器验证的来源。不会执行网页脚本，禁止本机/内网目标，重定向和DNS结果均需校验。

加密密码沿用本机comfyChat.archivePassword（setup生成的随机密码，可由部署者自行更改），成功提示给出实际密码，不把作者自用密码当成所有人的默认值。包名为最多10字简述加.z删ip；单个下载对应单个压缩文件，ZIP64流式打包。更改密码前保留旧密码，旧归档不会重新加密。

状态在桥接state/web-media.json，下载缓存在state/web-media-cache。默认24小时/16GiB缓存预算，完成后执行清理；这是清理目标，不是正在下载时的硬磁盘上限。大文件与压缩同时存在，4GiB资源可能临时用到8GiB以上磁盘，旧缓存也会占空间。重启中断的下载不自动恢复或重发；不把来源链接和缓存公开。

## 停用、移除与测试

先等下载和发送结束，停止桥接：

```powershell
node scripts/extensions.mjs disable web-media
node scripts/extensions.mjs remove web-media
```

重启桥接并重载QQ MCP。移除只删除已校验的扩展清单文件，保留下载缓存与会话状态；要清缓存应在停用前使用管理员指令。目录有额外文件时拒绝删除。无需卸载Comfy或共享FFmpeg。

离线验证：node scripts/test-addons.mjs web-media --from '扩展包解压目录'。测试在隔离副本中安装，不下载真实网站资源、不发QQ、不调用GPU；部分格式互操作测试可使用PATH中的Python。

公网地址校验会拒绝内网、回环和代理Fake-IP目标；遇代理Fake-IP解析时，可经Cloudflare HTTPS公共DNS独立解析域名，仍需校验为公网地址。DNS服务可访问性影响这类来源下载，不会放开内网地址。
