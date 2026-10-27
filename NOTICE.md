# 项目来源与第三方组件

- 部署与扩展基于[h-D-ACE/dsh-qq](https://github.com/h-D-ACE/dsh-qq)。
- 保留[Derpyu520/qq-bridge](https://github.com/Derpyu520/qq-bridge)的版权及原LICENSE全文，不将桥接声明为完全原创。
- 本版提供Anima默认入口、LoRA发现、高清、视频扩展、可移植配置与部署工具，以及按[OneBot v11公开协议](https://github.com/botuniverse/onebot-11/blob/master/communication/ws.md)编写的本地连接适配器。

## 当前依赖

公开版已移除@snowluma/sdk、@snowluma/mcp及其安装后修补脚本；消息接入和生成结果发送共用本地OneBot适配器，WebSocket传输依赖MIT许可的ws 8.22.0。配置中的snowluma字段、DSH工具服务器名保留兼容性，不代表仍依赖SnowLuma SDK或必须安装其运行时。默认QQ后端使用NapCat。

原LICENSE附录保留的是上游当时的依赖和处理记录，其中关于两个SnowLuma npm包的描述不代表本版仍使用它们。当前锁定依赖与声明许可见[THIRD_PARTY.md](THIRD_PARTY.md)。新增适配器按公开OneBot信封、echo和事件格式实现，没有复制上述SDK实现。

DSH、QQ客户端/后端、ComfyUI、模型和LoRA不随源码包分发，各自适用原条款。npm依赖通过锁文件安装，node_modules不随包发布。源码MIT不覆盖外部程序、模型或服务，也不代表这些外部组件可任意商业使用。

本项目与DeepSeek、腾讯及上述上游均无隶属关系。群消息会经配置的模型服务处理，部署者应告知参与者并设置白名单与记忆保留。
