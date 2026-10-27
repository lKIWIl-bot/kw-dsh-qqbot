# LoRA目录接入

## 放入即发现

配置comfyChat.modelsDirectory或comfyDirectory，扫描其loras目录；也可直接配置：

~~~json
{
  "comfyChat": {
    "loras": {
      "enabled": true,
      "defaultStrength": 0.8,
      "directories": [{"path": "E:/Comfy/models/loras", "base": "anima"}]
    }
  }
}
~~~

路径只是示例。Comfy本身也必须把该目录注册为LoRA模型目录；单独让机器人看到文件并不代表Comfy可加载。已有额外模型路径可直接在directories填写对应目录。位于额外根目录的子目录需使用comfyPrefix对应Comfy侧的相对名称。

扫描.safetensors文件及最多8级子目录，不加载张量、不执行目录中的脚本，不跟随子目录链接。下一次查询自动发现新增文件，管理员也可发送/刷新模型。文件名作为名称，空格和特殊字符替换成下划线，重名追加短标识；/loras展示最终名称。

## 必须提醒的缺项

自动发现只解决目录接入。**触发词、推荐权重、特殊用法和兼容底模不一定写在模型里。** 不从文件名、训练标签频次或agent猜测中编造这些信息。

- 能明确识别Anima元数据，或部署者在目录/同名JSON明确选择Anima底模，才启用。
- 底模未确认、冲突、JSON无效的文件进入待确认列表，不强行加载。
- 仅缺触发词或用法说明时，保留提醒并使用默认权重；模型可能需要额外触发词才能达到作者效果。
- 部署agent必须在运行doctor或loras后，立即把提醒告知用户，并请用户提供模型作者说明；项目AGENTS.md包含同一要求。

## 可选同名JSON

例如星光.safetensors旁放星光.json：

~~~json
{
  "name": "星光",
  "base": "anima",
  "trigger": "verified_trigger",
  "strengthModel": 0.8,
  "category": "style",
  "description": "经作者说明确认的风格简介",
  "promptGuidance": "经确认的特殊用法，作为本条提示词参考。",
  "usageConfirmed": true
}
~~~

name、分类、说明均可省略；trigger设置为空字符串表示已确认无需触发词。usageConfirmed=true只在核对作者说明后填写。category可为character、style、action；action自动限定管理员使用。Anima只修改扩散模型，strengthClip为0。

同名JSON是数据，不具有执行脚本、改变权限、切换发送目标或工作流的能力。普通请求不能在提示词里指定任意模型路径。

底模配置模板为image-workflow/loras.json；setup会生成被Git忽略的loras.local.json，后者优先。将来更换文本编码器或文件名时修改本机副本，升级保留。
