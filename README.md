# CL WHITE

CL WHITE 是 DS WHITE 的 Claude 版：一个纯网页、纯本地的聊天工具，直接调用 Claude API。没有后端服务器，对话和附件只存在你自己的设备上。

*CL WHITE is the Claude edition of DS WHITE: a static, local-only chat web app that talks directly to the Claude API.*

## 开始使用

1. 在 Claude 开发者平台（platform.claude.com）创建 API Key 并充值。
2. 打开网页，在「设置 › 账户」里填入 API Key，点「确定」。网页会先校验，通过后才保存。
3. 点输入栏左下角的模型按钮选模型（默认 Opus 5.5），设置里也能改。

在手机上可以「添加到主屏幕」，像 App 一样全屏使用。

## 和 DS WHITE 的区别

| | DS WHITE | CL WHITE |
|---|---|---|
| 接口 | DeepSeek API | Claude API（api.anthropic.com） |
| 模型 | DeepSeek | Opus 5.5 / Sonnet 5.5 / Haiku 5.5 / Fable 5.2，可在设置里切换 |
| 深度思考 | 输入栏开关 | 不需要开关：Claude 会按需自己思考。输入栏的模型菜单里有「显示思考过程」，只决定看不看思考摘要 |
| 智能搜索 | DeepSeek 联网搜索 | Claude 的网页搜索工具（每次搜索另外按次计费，每轮最多 5 次） |
| 对话标题 | 随回答一起返回 | 第一轮回答后用 Haiku 5.5 单独生成（花费极少） |
| 附件 | 图片、PDF、Word、PPT、表格、电子书、代码等 | 图片、PDF、纯文本类文件（代码、Markdown、CSV 等）。Word / PPT / Excel / 电子书暂不支持 |
| 语音输入、朗读 | 有 | 暂无（Claude API 没有语音接口） |
| 余额查询 | 有 | 暂无（Claude API 没有余额接口，余额请到开发者平台查看） |
| 外观 | 冷白 + 冰蓝 | 旧纸米白 + 陶土橙；深色是暖炭灰 |

其余功能都和 DS WHITE 一样：置顶、单对话导出、上下文管理、自动压缩、备份提醒、LaTeX 卡片、Mermaid、搜索历史等。

### 从 DS WHITE 搬过来

两边的备份 zip 格式相同。在 DS WHITE 里导出全部历史对话，到 CL WHITE 的「设置 › 账户 › 导入历史对话」导入即可（会覆盖 CL WHITE 里现有的对话）。

两个网页部署在同一个域名下也互不干扰：本地存储、数据库和离线缓存的名字都是分开的。

## 费用

网页本身免费，API 按 Anthropic 官方价格计费（每百万 token，输入 / 输出）：

- Opus 5.5：$4 / $20
- Sonnet 5.5：$2 / $10
- Haiku 5.5：$0.10 起 / $0.50 起
- Fable 5.2：$8 / $40

深度思考产生的思考内容按输出计费。网页默认开启了自动缓存：同一个对话 5 分钟内接着聊，重复发送的历史部分按缓存价计费，长对话能省不少。

## 数据与安全

- **数据只在本机。** API Key 和设置存在浏览器的 localStorage，对话和附件原件存在 IndexedDB。网页只和 api.anthropic.com 通信，没有任何第三方服务器。
- **API Key 是明文保存的。** 和 DS WHITE 一样，Key 存在浏览器里，能打开这台设备浏览器开发者工具的人都能看到。别在公用电脑上用，也别把装了 Key 的浏览器借给别人。建议在开发者平台给这个 Key 设置用量上限。
- **浏览器直连。** Claude API 默认不允许网页直接调用，请求要带上 `anthropic-dangerous-direct-browser-access` 头。名字里的 "dangerous" 说的就是上一条：Key 在浏览器里。自己用自己的 Key 没问题。
- **清缓存会丢对话。** 请定期导出 zip 备份。

## 开发

需要 Node.js 22.12+ 和 pnpm：

```sh
pnpm install
pnpm dev      # http://localhost:8090
pnpm build    # 输出到 dist/
```

## 许可

MIT。本项目基于 DeepSeek 开源的 chat-demo 和 DS WHITE 修改，保留原版权声明，见 LICENSE 和「设置 › 开发清单」。
