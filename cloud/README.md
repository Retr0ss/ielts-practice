# IELTS Atlas 私人学习版（第一阶段）

基础提交：`3510cc61e2a55017bcdab2b42f11bdd6ba1108d4`（main）。

本目录增加 Cloudflare Workers + D1 部署路径。沿用原有阅读网页和 AppData，笔记与练习不依赖 Mac mini、墨墨 API 或模型 API；自动解析可选接入 DeepSeek、OpenAI。Cloudflare 免费额度内不产生服务器费用；模型 API 单独计量，不包含在 ChatGPT Plus 中。符合条件的 Pro 用户可在官方平台激活 API 额度权益，见下文。请保持免费计划并检查平台用量。

## 已实现的使用路径

- `/learn/login.html`：单用户私人访问码登录；没有公开注册。
- `/learn/index.html`：词汇/语法笔记、今日收集、待复习、已掌握、搜索。
- 保存原句、来源和解析。复用本地词典；也可复制提示词到 ChatGPT 后手工粘贴结果。
- 可选 DeepSeek / OpenAI 自动解析：中文词义、句子成分、语法结构、搭配和两个原创 IELTS 场景例句。先预览，明确追加或替换解析框，编辑后保存。
- 阅读网页顶部增加笔记入口和同步状态。
- 已提交练习（含记录中的答案和注释）、独立学习笔记跨设备同步。
- 笔记本机先保存，网络重试；显式处理版本冲突和删除墓碑。
- JSON 备份与恢复；每日格式 Markdown 导出，可保存到 Obsidian，笔记保留稳定 ID/块引用。
- 可选的 iOS 快捷指令只写收集接口。

未纳入此次同步的内容：未交卷草稿、旧版词表/精读词表、复习调度、浏览偏好、诊断、完整题库配置。JSON 私人备份包含笔记、同步队列及其中的练习，不取代原站点完整数据备份。恢复时笔记另存副本，练习按相同 id 更新；旧游标、版本、删除命令和会话凭证不会导入。恢复中途出错会保留已经成功恢复的数据。

不会自动读取墨墨剪贴板或账号。听力仍需要另行准备有权使用的资源，未增加音频。尚不提供完整离线应用，断网时已加载页面可以本机保存；首次访问或离线重新加载不保证可用。Safari 真机验收仍需完成。

## 私人访问与同步模型

1. 使用生成器生成 256 位随机私人访问码，将原码保存到密码管理器。Worker 只配置 SHA-256 摘要 `OWNER_ACCESS_HASH`。不要换成普通短密码：这里依赖高熵随机码，不是面向弱口令的密码哈希方案。
2. 登录后，随机 Session Cookie 使用 `__Host-`、HttpOnly、Secure、SameSite=Strict；服务端保存摘要，30 天到期。轮换访问码摘要立即使旧会话失效。
3. 未认证时，只放行登录页及必要的公共 JS/CSS。题库、解析、图片和音频都经过 Worker 会话校验。不要把 `dist/private` 直接上传到公开静态托管，也不要关闭 `run_worker_first`。
4. Cookie 写请求要求同源 Origin 与自定义请求头。登录有按来源 IP 的速率限制。Session、访问码和快捷指令凭证不进入学习备份。
5. D1 使用逐条版本比较与原子条件插入。`operationId` 用于幂等重试，`seq` 用于增量拉取，删除保留墓碑。旧设备不能直接覆盖新版本。
6. 浏览器的独立 IndexedDB 保存私人笔记与同步状态。既有练习只通过 AppData 的 canonical API 读取/写入；`readForSync`/`applyFromSync` 使用本地修订令牌，避免网络返回覆盖刚提交的注释。
7. 同源页面用 Web Locks 串行同步。冲突保留本机和云端内容，用户选择后才继续该条写入。未处理冲突不阻止其他记录同步。
8. 清空原站点本地学习数据库后，云同步检测存储身份变化并恢复缓存中的练习，不将本地重置推送为整库删除。网页中的明确删除则正常同步。

退出登录会撤销云端会话，本机学习缓存保留。公用设备退出后还需清除站点数据。删除为逻辑删除，云端变更历史仍保存旧版本；彻底清理历史需另行设计，不能只删除墓碑，否则旧设备可能重新上传旧内容。定期导出备份，Cloudflare 平台恢复能力不能代替外部备份。

## 配置与发布

需要：Cloudflare 账号的 Worker/D1 权限；保留免费计划；可选自己的域名。可以先使用平台网址。项目代码/构建产物和学习内容继续受 GPL-3.0 及第三方内容授权范围约束。

### iPhone：从 Cloudflare 连接 GitHub

本 Fork 已将用户提供的账号标识和真实 D1 数据库标识填入 `cloud/wrangler.jsonc`。它们不是凭证，配置中没有访问码或 Token。此数据库由用户在控制台创建，代码配置不表示已经完成远端绑定或建表。

在 Cloudflare 的 Compute → Workers & Pages 中创建 Worker，连接 GitHub，仅授权 `Retr0ss/ielts-practice`，选择分支 `feature/private-learning-mvp`。保持免费计划。填写：

| 字段 | 值 |
| --- | --- |
| Worker 名称 | `ielts-atlas-private` |
| Root directory | `cloud` |
| Build command | `npm ci && node ../scripts/build-bundles.mjs && npm run build` |
| Deploy command | `npm run deploy:cloudflare` |

部署命令先执行 D1 迁移，再发布 Worker。Cloudflare 的构建身份需要访问这个账号的 Workers 和 D1；若默认 Workers Builds Token 缺少 D1 权限，请在个人 API Tokens 中为构建 Token 增加当前账号的 D1 Edit 权限，然后重试。Token 不需要发到聊天或填入仓库。Wrangler 配置中的 Worker 名称必须与控制台一致。

首次部署后，在平台返回的真实 Worker 域名后加 `/learn/setup.html`，例如 `https://<平台返回的域名>/learn/setup.html`：

1. 点“生成访问码与摘要”。浏览器使用 Web Crypto 生成随机码及 SHA-256 摘要，不发送网络请求或保存到浏览器存储。
2. 把“私人访问码”保存到自己的密码管理器，不要截图或发到聊天。
3. 复制“Cloudflare 配置摘要”。打开这个 Worker → Settings → Runtime variables and secrets → Production → Add variable。不要添加到 Build 的变量区。
4. 类型选择 Secret；名称 `OWNER_ACCESS_HASH`；值粘贴摘要。选择保存并部署。
5. 回到 `/learn/login.html`，使用原始访问码登录。

设置摘要前，学习页面、题库和 API 返回 503；只开放无状态的配置辅助页面和样式。此页面不能修改服务器设置或读取学习数据。摘要配置成功后，学习内容仍需登录。每个用户在配置页生成自己的随机码不会改变服务器现有访问码。

本地开发使用忽略的 `cloud/wrangler.local.jsonc`，从模板复制并使用本地测试标识。不要用生产配置跑本地自动化测试，也不要将本地 `.dev.vars` 提交。

### 命令行部署（可选）

在可联网的云端开发环境中，从仓库根目录：

```bash
npm ci --prefix cloud
node scripts/build-bundles.mjs
npm run build --prefix cloud
cd cloud
npx wrangler login
```

当前仓库已配置用户创建的真实数据库，不需要再次创建。其他账号部署时，请从 `wrangler.example.jsonc` 复制配置，填入自己账号和数据库的真实标识。

在可信的交互式终端运行下面的生成器，保存原访问码；输出不要粘贴到聊天、issue、CI 日志或仓库：

```bash
node scripts/create-access-code.mjs
npx wrangler secret put OWNER_ACCESS_HASH
```

把生成器输出的摘要填入 Wrangler 隐藏输入，原码只保存在自己的密码管理器中。然后：

```bash
npx wrangler d1 migrations apply ielts-atlas-private --remote
npm run deploy
```

首次部署后验证：匿名直接访问题库返回 401；登录后可阅读；两台设备能同步一条笔记和一条练习；退出后无法读取 API。不要创建不受保护的 Pages 镜像或公开音频目录。

平台 Token 仅配置必要 Worker/D1 权限并放入加密 Secrets。当前未添加 GitHub Actions 自动部署 workflow；用户已在 Cloudflare 连接 Workers Builds，生产分支为 `feature/private-learning-mvp`。

## DeepSeek 自动解析

在已有私人站点上启用时，无需更改登录码或重新创建数据库。部署命令会应用 `0002_analysis.sql`，增加独立的解析请求表，不修改已有笔记和练习记录。

1. 在 DeepSeek 开放平台创建 API Key，并确认有可用 API 余额。ChatGPT Plus 不提供这部分额度。
2. Cloudflare Worker → Settings → **Runtime variables and secrets** → **Production** → **Add variable**。
3. Key 填 `DEEPSEEK_API_KEY`，Value 填原始 API Key，勾选 **Secret**，点 **Add variable and deploy**。这里不计算 SHA-256，也不修改 `OWNER_ACCESS_HASH`。不要把密钥发送到聊天或提交 GitHub。
4. 刷新 `/learn/index.html`，粘贴单词或句子，点“自动解析”。核对预览后追加或替换解析框，再保存笔记。保存后沿用现有跨设备同步、JSON 备份和 Obsidian 导出。

默认使用官方 `https://api.deepseek.com/chat/completions`，模型 `deepseek-flash`，关闭思考模式，使用 JSON 输出并在服务器验证结构。参见 [官方调用示例](https://api-docs.deepseek.com/api_samples/chat_curl/)、[Chat API](https://api-docs.deepseek.com/api/create-chat-completion/) 和 [JSON 模式](https://api-docs.deepseek.com/guides/json_mode/)。模型可用性与价格以官方账号为准；当前测试没有使用真实密钥或产生付费调用。

只有已登录的私人会话能调用解析；快捷指令收集凭证不能调用付费接口。密钥只在 Worker 读取，不进入浏览器、备份或 API 响应。模型仅收到当前输入与类型，不会自动上传整本笔记、练习记录或来源字段。请只发送有权使用的内容。

未设置变量时，全站每天最多 **20 次**新解析；本 Fork 的生产配置 `cloud/wrangler.jsonc` 已按用户设置为 **100 次/日**。修改控制台的普通运行时变量后，也需同步该文件的 `vars`，避免下次 GitHub 构建覆盖。UTC 零点恢复；失败尝试也计入。最多输入 4000 字符，输出最多 2500 token，40 秒超时。没有自动重试模型请求：网络超时后重试会优先查询同一请求；同一内容、类型、模型与提示词版本复用最近 7 天结果，并发请求共用结果。缓存命中不额外调用模型；7 天清理在新解析请求时执行，并非定时删除保证。缓存保存校验后的解析内容、输入摘要和状态，不单独保存原始输入。

限额按 D1 原子预留跨设备生效；它限制请求数，不是金额上限。可在同一 **Runtime** 区域设置以下可选变量（普通文本即可）：

| 名称 | 默认值 | 用途 |
| --- | --- | --- |
| `AI_DAILY_LIMIT` | `20` | 每天新请求上限，整数 0–100；`0` 关闭解析 |
| `AI_MODEL` | `deepseek-flash` | DeepSeek 或其兼容服务的模型 ID |
| `AI_BASE_URL` | `https://api.deepseek.com` | 仅 DeepSeek 路径使用的兼容 Chat Completions HTTPS 基础地址；不要填完整 `/chat/completions` 路径 |
| `AI_JSON_MODE` | 开启 | 仅 DeepSeek 兼容服务不支持 JSON 模式时设 `off`，不影响 OpenAI |
| `AI_PROVIDER` | 自动选择 | `deepseek` 或 `openai`，指定网页默认选项；未设置时有 DeepSeek 密钥优先 DeepSeek，否则有 OpenAI 密钥选择 OpenAI |
| `OPENAI_MODEL` | `gpt-5.4-mini` | 支持 Responses 和严格结构化输出的 OpenAI 模型 ID |

未配置密钥或模型失败时，保留原文及已有解析，手动笔记与同步继续可用。模型结果按纯文本展示，不能执行返回的 HTML。模型可能误解语法或词义，请核对后保存。自动解析目前只在网页主动触发；iOS 快捷指令仍只收集原文。

### 增加 OpenAI（GPT）接口

保留原来的 `DEEPSEEK_API_KEY` 即可，两家密钥独立。以后使用 OpenAI 时：

1. 在 OpenAI API Platform 获取项目 API Key，确认该 API 组织有余额或已激活的额度权益。
2. 在同一 Worker 的 **Runtime variables and secrets → Production** 添加 Secret：名称 `OPENAI_API_KEY`，值为原始 API Key，保存并部署。不要使用 ChatGPT Cookie、登录会话或订阅凭证。
3. 刷新笔记页，在“解析服务”选择 **OpenAI（GPT）**。可选设置文本变量 `AI_PROVIDER=openai` 作为默认；不设置也可每次在网页选择。

OpenAI 使用固定官方地址 `https://api.openai.com/v1/responses`，默认 `gpt-5.4-mini`，关闭默认模型的推理，使用严格 JSON Schema 并执行相同的后端校验。设置 `store:false`，不创建可继续的对话或使用工具；这不代表供应商完全不保留安全审计数据。`AI_BASE_URL` 和 `AI_MODEL` 只影响原来的 DeepSeek 路径，OpenAI 密钥不会被发送到该自定义地址。见 [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)、[结构化输出](https://developers.openai.com/api/docs/guides/structured-outputs) 与 [默认模型](https://developers.openai.com/api/docs/models/gpt-5.4-mini)。

**ChatGPT Pro 与 API 仍是独立系统。** 根据 [官方 API 额度权益说明](https://help.openai.com/en/articles/20001626-api-credits-benefit-for-eligible-chatgpt-subscriptions)，符合条件的 Pro 用户可以领取 API credits；需要满足资格、关联 API 组织并主动激活，订阅本身不证明额度已到账。以后开通 Pro 时，在官方 Billing 检查资格和实际余额，再配置此接口。权益、有效期与可用模型以官方账号显示为准，网站不能直接消耗 ChatGPT 网页消息额度。

两个服务**共用** `AI_DAILY_LIMIT` 指定的新请求上限（本 Fork 生产环境为 100 次/日），缓存按服务地址和模型区分。切换服务会撤销旧预览，迟到结果不会填入新选择；任何一方失败都不会自动切换另一方或产生第二次调用。尚未配置的选项仍可看到，但自动解析按钮不可用；已有笔记与手动功能继续可用。

## iOS 快捷指令

可先直接在网页粘贴内容。接入快捷指令时，另生成一份随机码：只将其摘要设为 `CAPTURE_TOKEN_HASH`，原码保存在自己的快捷指令中。它与站点登录码不同，不能读取题库、笔记、删除或编辑记录。删除这个 Worker secret 可撤销收集能力。

快捷指令步骤：

1. 获取剪贴板文本；由用户主动运行。
2. 生成 UUID 和当前 ISO-8601 时间，保留到此次请求成功。重试使用同一组值。
3. 用“获取 URL 内容”向 `https://你的站点/api/capture` 发 POST。
4. 请求头：`Authorization: Bearer <设备收集码>`、`Content-Type: application/json`。
5. JSON：`id`（UUID）、`createdAt`（ISO 时间）、`text`（原文）、`category`（`vocabulary` 或 `grammar`）。
6. 收到 201 表示保存成功；失败时保留原文，重试或到网页粘贴。此接口只收集，不自动解析。

不要把凭证放进 URL；导出或分享快捷指令前删除凭证。API 获取的墨墨版权释义/例句与用户自己的笔记分开处理；不要默认批量持久化、发送模型或导出其版权内容。

## 验证与本地开发

```bash
node developer/tests/private/worker.test.mjs
node developer/tests/private/analysis.test.mjs
node developer/tests/js/appDataV2.test.js
node scripts/build-bundles.mjs --check
python developer/tests/ci/run_static_suite.py
python developer/tests/e2e/full_reset_flow.py
python developer/tests/e2e/suite_practice_flow.py
```

仅本地开发：从模板创建 `cloud/wrangler.local.jsonc`，在 `cloud/.dev.vars` 设置测试摘要，使用本地 D1（`wrangler d1 migrations apply ... --local --config wrangler.local.jsonc`），然后 `wrangler dev --local --local-protocol https --config wrangler.local.jsonc`。不要复用真实登录码做自动化测试。

`developer/tests/private/browser_flow.py` 默认使用本机 `https://127.0.0.1:8791` 和固定的、仅用于本地测试的访问码。支持 Chromium 和 WebKit；可用 `ATLAS_TEST_BROWSERS=chromium` 选择。覆盖手机尺寸、两设备、离线冲突、练习往返、本地修订冲突、删除、导出、HTML 注入、重载和匿名访问。它拒绝连接生产 URL。

## 下一阶段

- iPhone Safari 实机阅读、弹窗/后台切换、词典和音频验收；再决定同标签页练习改造。
- 旧词表、精读词汇、复习计划同步；明确各自写入和冲突模型。
- 按官方授权和实际字段设计墨墨增量同步，保持执行器与手机功能解耦。
- 配置真实 DeepSeek / OpenAI API 后分别验收，并在 iPhone Safari 验证后台切换和错误恢复。
- Obsidian 按笔记独立文件导出，以及大规模历史的压缩/清理策略。
