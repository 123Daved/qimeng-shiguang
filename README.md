# 憩梦时光

聊 10 分钟，AI 帮你生成一个「既能被人找到、也能被 AI 找到」的个人网站。

项目负责人：杜明航（产品经理 + 全栈开发）

在线体验：<https://qimeng-shiguang.onrender.com>

Render 免费实例闲置后会休眠，首次打开可能需要等待约 1 分钟；免费版没有持久磁盘，重启后 data/ 里的网站会清空（正式版换 PostgreSQL 或挂载磁盘）。如果示例网站「阿岚」不在，启动时会自动放回，即使已经有其他已发布的网站。中文地址是 `/u/阿岚`，英文别名是 `/u/alan`（若有人发布了名为 alan 的网站，英文地址会优先显示那一份）。页面上标着「示例」。

把一个人讲清楚：采访或导入其他 AI 里的记忆，整理成人生档案，渲染成个人网站，并带上 AI 分身和机器可读文件。网站给人看，也给 AI 看。界面按憩梦拾光品牌规范：陶土色主行动、文字标志、统一的线性图标，工作台带六个话题的进度和三套主题缩略图。

![首页](docs/screenshots/01-landing-desktop.png)

## 演示

阿岚是惠州双月湾的民宿主理人。贴入一份「关于我」之后，采访官只追问网站风格，然后生成、改成简约、发布到 `/u/阿岚`。分身能按档案回答房价，档案里没有的问题会诚实地说不知道。

| 采访追问 | 发布的网站 | AI 分身 |
| --- | --- | --- |
| ![追问风格](docs/screenshots/03-interview-desktop.png) | ![阿岚的网站](docs/screenshots/07-site-desktop.png) | ![分身问答](docs/screenshots/08-avatar-desktop.png) |

发现页搜「双月湾」：

![发现](docs/screenshots/09-discover-desktop.png)

更多步骤（导入、生成、一句话修改、发布，以及手机宽度）在[项目介绍书](docs/项目介绍书.md)。

## 这个 MVP 做什么

- AI 采访：6 个话题，一次一个问题，笼统回答最多追问一次
- 导入其他 AI 的记忆：复制提问词，再把总结贴回来；原文不公开
- 档案抽取，并用温暖 / 简约 / 墨色三套模板渲染
- 一句话修改，只改被要求的部分
- 发布到 `/u/名字`，之后的修改自动同步
- JSON-LD、`profile.json`、`llms.txt`、`sitemap.xml`
- 网站上的 AI 分身，标明「AI 生成」，不能被要求换身份
- 发现页按关键词找人；没有密钥或模型出错时自动用离线规则
- 每个网站页脚都有「我也要一个 →」

## 快速开始

需要 Node.js 18.17 或更高，不需要 `npm install`。

```bash
cp .env.example .env
npm start
```

在 `.env` 里填写 `LLM_API_KEY`。地址和模型名的示例是：

```bash
LLM_BASE_URL=https://token.iflink.tech/v1
LLM_MODEL=deepseek-v4.1-flash-1017
```

不要把填好的 `.env` 提交到仓库。

没有密钥时：

```bash
npm run demo
```

测试：

```bash
npm test
```

当前 16 项测试全部通过。部署方式（Docker 与 Render）写在[项目介绍书](docs/项目介绍书.md)。

## 文档

- [产品需求文档（Markdown）](docs/PRD/憩梦时光_PRD_完整版.md)
- [产品需求文档（Word）](docs/PRD/憩梦时光_PRD_完整版.docx)
- [项目介绍书](docs/项目介绍书.md)
