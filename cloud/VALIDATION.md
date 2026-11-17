# 第一阶段验证记录

日期：2026-11-16。基础：main `3510cc61e2a55017bcdab2b42f11bdd6ba1108d4`。

没有创建云资源、部署线上服务、修改 main 或创建 PR。数据库测试只使用本机 SQLite/D1，固定测试访问码不能用于生产。

| 检查 | 结果 |
| --- | --- |
| `node developer/tests/private/worker.test.mjs` | 5/5 通过：版本冲突/幂等/墓碑、输入校验、静态资源保护/CSRF/退出/密钥轮换、收集凭证权限、未配置时仅开放无状态设置页 |
| `npm test --prefix developer`（配置 Chromium 路径） | 837/837 通过 |
| `node developer/tests/js/appDataV2.test.js` | 62 项通过 |
| `node scripts/build-bundles.mjs --check` | 18 个 bundle 与源码一致 |
| `python developer/tests/e2e/full_reset_flow.py` | 通过 |
| `python developer/tests/e2e/suite_practice_flow.py` | 通过；日志含可选资源的 file-not-found，不影响该测试断言 |
| `ATLAS_TEST_BROWSERS=chromium python developer/tests/private/browser_flow.py` | 通过：393×852 手机尺寸、两个独立浏览器存储、离线修改/冲突选择、练习与注释往返、本地 CAS、删除同步、JSON 备份恢复、基础词典、Markdown、HTML 注入防护、重载持久化、匿名资源拦截 |
| `npm run build --prefix cloud` | 通过；仅打包运行文件，过滤隐藏文件，检查资源 25 MiB 限制 |
| `git diff --check` | 通过 |
| `python developer/tests/private/setup_flow.py` | 手机尺寸 Chromium 通过：随机访问码与摘要匹配、再次生成得到新值、未发送网络请求、未写浏览器存储或 URL |
| `wrangler deploy --dry-run --config cloud/wrangler.jsonc` | 用户提供的真实标识配置通过打包检查（683 个静态文件）；没有发布或访问远端数据库 |

## 尚未通过的全局检查

`python developer/tests/ci/run_static_suite.py` 总状态仍为失败，剩余失败项为“v2 数据架构唯一入口守卫”。在未修改的基础提交建立独立 worktree，对比守卫输出并忽略行号后，本分支的 source/test/bundle/html 新增违规项均为空。已有违规涉及书架旧状态引用、阅读缓存/迁移和部分测试夹具中的原始存储引用。本次没有放宽这些既有检查，也没有将其报告成通过。

新增私人同步队列的独立 IndexedDB 所有权，在守卫中仅为 `js/private/store.js` 的 `global.indexedDB.` 添加明确例外。既有练习数据仍通过 AppData 写入。首页脚本快照已同步，新样式并入原有 main.css，未增加首页 CSS 入口。

## 浏览器与生产限制

- Chromium 测试成功；WebKit 下载成功但无法启动，环境缺少 GTK4、Graphene、Harfbuzz ICU、Manette、Hyphen 和 GLES 系统库。没有把 WebKit 检查算作通过。
- 未做真实 iPhone Safari 测试，未验证手机后台挂起、长时间音频、真实快捷指令网络调用或生产 Cloudflare 网络/免费额度表现。
- 没有模型 API 调用，也没有连接真实墨墨账号。
- Wrangler 本地验证采用 HTTPS。重建静态输出目录后应重启本地 dev server，避免开发工具保留旧目录资源索引；线上使用不可变部署产物。
- 用户提供的真实账号/D1 标识已写入生产配置；远端创建/绑定/迁移仍需由已授权的 Cloudflare 构建身份执行。还需配置私人访问码摘要，并验证匿名访问、两设备持久化和备份恢复。

## 2026-11-17：从阅读返回笔记时的启动错误提示

用户操作为笔记页进入“开始阅读练习”，再用 Safari 返回。上传的脱敏报告记录 `APP_BOOT_FAILED`、`bootstrap/initialize`，运行于子路径；异常名称、调用栈和资源均未知，不能据此还原 Safari 原始异常，也没有证据表明学习数据已丢失。

确认笔记页复用了诊断收集器，却没有像原阅读应用一样调用 `markReady()`。本地完成相同往返后，注入与报告同类型的不透明异步拒绝，在旧代码中产生启动失败弹窗。修复后，只有 AppData 就绪、笔记列表读取并渲染成功才标记启动完成；后续异常仍记录，但不冒充启动故障。真正的数据库初始化失败继续显示可导出的启动诊断。

同步增加 `pagehide`/`pageshow` 生命周期：离开时暂停计时器并取消网络请求，本机队列保留；返回时恢复同步。过期页面任务的取消不提示为保存/启动失败。私人页面和同步脚本纳入诊断构建指纹及精确静态路径白名单，便于后续区分部署版本；未放宽异常正文脱敏规则。

验证：`navigation_flow.py` 在手机尺寸 Chromium 通过实际往返、异步异常分类、挂起请求取消/恢复、保存同步、重载保留和真实启动失败；完整私人浏览器流程再次通过双设备、离线冲突、练习、删除、JSON 恢复、词典和导出。诊断构建/收集/契约单元检查通过，18 个 bundle 一致。全量重置、套题浏览器回归再次通过；静态检查仍仅有前述上游架构守卫失败。尚未完成用户这台 iPhone Safari 的复验；若原始底层异常仍发生，需要新的脱敏报告继续定位。

## 2026-11-17：DeepSeek 自动解析

新增服务器端 Chat Completions 调用、D1 请求预留/幂等/缓存及手机笔记解析预览。默认官方 `deepseek-flash`、关闭思考模式、JSON 输出和结构验证，每天最多 20 次新请求；失败计入限额，输入 4000 字符、输出 2500 token、40 秒超时。仅在运行时配置 `DEEPSEEK_API_KEY` 后启用；不读取、修改或提交真实密钥。

| 检查 | 结果 |
| --- | --- |
| `analysis.test.mjs` | 9/9 通过；验证实际请求参数、密钥隔离、缓存/重试、UTC 限额、失败计数、并发不同输入/相同输入/相同编号/编号冲突、截断/格式错误/超大输出、未配置及认证/CSRF |
| `worker.test.mjs` | 5/5 通过；原有同步、权限与设置流程保留，收集凭证不能使用解析接口 |
| `npm test --prefix developer` | 全部 837/837 通过 |
| `analysis_flow.py` | 手机尺寸 Chromium 通过：预览不覆盖旧笔记、主动追加/保存/云同步、迟到结果不填入新原文、限额错误保留内容、HTML 纯文本展示、无横向溢出、无密钥时保留手动功能 |
| `navigation_flow.py`、`browser_flow.py`（Chromium） | 通过；阅读往返、启动诊断、请求取消/恢复，以及双设备/离线冲突/练习/删除/备份/词典/导出回归 |
| 全量重置、套题练习 | `full_reset_flow.py`、`suite_practice_flow.py` 通过 |
| 构建及诊断 | Cloudflare 静态打包、18 个 bundle 一致、诊断构建/收集/契约检查通过 |
| `wrangler deploy --dry-run` | 新 Worker 模块打包通过，684 个静态文件；没有发起发布或远端迁移 |
| 静态总检查 | 仍仅前述 v2 架构守卫失败；没有放宽守卫，新增解析代码不在违规清单中 |

模型调用全部使用模拟响应，没有真实付费 API 请求。需由用户在 Cloudflare **Runtime variables and secrets / Production** 配置密钥，再做真实 DeepSeek 解析与 iPhone Safari 验收。没有将 Chromium 结果当作 Safari 通过，也没有保证模型答案正确。

## 2026-11-17：增加 OpenAI（GPT）接口

新增官方 Responses API 适配，默认 `gpt-5.4-mini`、`reasoning.effort=none`、`store:false`、严格 JSON Schema；密钥来自独立的 `OPENAI_API_KEY`，不复用 DeepSeek 密钥、自定义地址或模型。保持现有 DeepSeek 请求格式、缓存键和数据表；两家共用原有每日请求上限。网页增加服务选择，选择未配置的服务时保留手动功能；切换服务会撤销旧预览和请求重试编号，不自动改用另一家。

- `analysis.test.mjs` 13/13、`worker.test.mjs` 5/5 通过。新增覆盖 OpenAI 原始 REST 输出提取、严格 schema/不保存对话参数、服务密钥/地址隔离、缓存区分与共享限额、拒绝/不完整/错误输出、缺少 OpenAI 密钥不借用 DeepSeek 凭证。所有模型响应均模拟，没有真实付费 API 调用。
- 手机尺寸 Chromium 的 `analysis_flow.py` 通过，增加同一原文切换服务时丢弃迟到结果、OpenAI 请求选择、预览替换/保存、表单重置保留所选服务、无密钥时按钮禁用检查。`navigation_flow.py` 和完整 `browser_flow.py` 再次通过。
- 18 个 bundle 一致，诊断构建/启动/契约测试通过；Cloudflare 静态打包和 Worker dry-run 通过。静态总检查仍仅有此前同一架构守卫失败（source 8、tests 33，无新增文件违规），没有更改守卫。
- 静态检查后依次运行 `full_reset_flow.py`、`suite_practice_flow.py`，均通过；套题日志仍有已知可选资源 file-not-found，断言通过。
- 最新官方说明允许符合条件的 Pro 用户激活 API credits，但需关联 API 组织并完成领取；网站仍使用项目 API Key。不是将 ChatGPT 网页会话或消息配额当作 API 凭证。

尚待用户配置真实 OpenAI API Key、确认 API 组织余额或额度权益后验收；未完成真实 iPhone Safari 与真实模型调用验证。本轮没有更改数据库结构或笔记格式。

## 2026-11-17：例句朗读与点词查义

笔记页增加 `learn/sentenceTools.js`：原句听读、AI 预览直接点词、解析框与已保存笔记的听读入口。整行英文通过系统 Web Speech 播放，优先可用英式语音；点词使用既有 IELTS/ECDICT 词典与词形还原，显示释义、音标和来源。单词发音也使用系统语音。没有增加付费 TTS、外部查词 API、模型调用或数据表，不改变笔记内容、同步格式和导出文本；生产每日解析限额仍为 100。

- `sentence_tools_flow.py` 在手机尺寸 Chromium 通过：完整英文例句及单词的播放参数、停止/完成/播放错误/返回/后台处理、旧语音事件隔离；真实本地词典与单字母基本词、未收录提示、关闭并快速重新查词时丢弃旧响应；AI 预览、解析框、保存笔记的听读入口；HTML 按文本显示和无横向溢出。另验证无可用语音列表、长文本拒绝和语音引擎缺失时仍可查词。
- 语音引擎使用模拟对象检查传入文本和生命周期，模型响应也模拟；没有把自动化播放参数通过当作真实声音验收。测试中点词使用实际站内词典，没有付费调用。
- `analysis_flow.py`、`navigation_flow.py`、`browser_flow.py`（Chromium）通过，原有解析预览、保存/两设备同步、离线冲突、阅读往返、诊断、备份/导出等流程保留。后台接口测试 13/13 与 5/5 通过。
- 18 个 bundle 一致，诊断构建/启动/契约检查通过；新增脚本纳入构建指纹与精确诊断路径表，没有放宽诊断脱敏规则。静态总检查仍仅有原来的 v2 架构守卫失败（source 8、tests 33），无新增违规。
- 静态检查后依次执行 `full_reset_flow.py`、`suite_practice_flow.py`，均通过；Cloudflare 静态打包与 Worker dry-run 通过（685 个静态文件，确认生产 `AI_DAILY_LIMIT=100`）。

还需用户在实际 iPhone Safari 点按试播，检查设备音量、英语语音可用性、后台与返回体验。一般词典释义可能不符合句中语境；不认识或有歧义的用法仍需结合语法解析。尚不保证首次离线可加载词典或平台语音。

## 2026-11-17：自动解析“模型服务连接失败”排查

用户截图显示 DeepSeek 自动解析的通用连接失败提示，无法从截图确认真实失败阶段。原代码将请求构建/连接、响应流读取、以及完成解析后的 D1 缓存/次数刷新异常都归成同一提示；未验证密钥中是否含无法写入请求头的字符。没有读取用户生产密钥，也没有将某个推测宣称为本次事故根因。

修复：检查密钥格式后才预留调用次数；新增有登录与 CSRF 保护的 `POST /api/analysis/check`，只读模型列表、DeepSeek 官方可用余额状态，不调用生成、不写调用记录、不返回密钥/余额金额/上游错误正文。生成失败区分授权、余额、模型、限流、连接、接收中断与结果处理，未知异常仅输出固定安全信息。已生成且校验通过的结果即使缓存/次数刷新失败仍返回预览，并提示先保存，避免误导重复调用。页面“已配置”与真实检查通过分开，返回页面不会显示旧检查的取消错误。

- `analysis.test.mjs` 19/19、`worker.test.mjs` 5/5 通过。新增验证只读检查的 GET 路径/密钥隔离/不发原文/不增加次数、密钥字符错误在调用前拦截、HTTP 授权/余额/模型/限流分类、不暴露非自有异常的 message/status、连接和响应流失败阶段、缓存或次数刷新故障仍交付有效结果；检查接口验证登录、同源与收集凭证隔离。
- 手机尺寸 Chromium 的解析流程通过只读检查结果、保留已有笔记、显示错误代码、缓存告警仍有预览、非法密钥时禁用生成但允许检查。朗读/点词、阅读往返、完整私人同步/备份/导出流程再次通过。
- 构建指纹、18 个 bundle 与诊断构建/启动/契约检查通过；静态总检查仍仅原有 v2 架构守卫失败（source 8、tests 33），无新增违规。
- 静态检查后依次执行全量重置与套题练习浏览器回归，均通过；Worker dry-run 打包通过（685 个静态文件，生产限额仍为 100）。
- 静态检查后依次执行全量重置与套题练习浏览器回归，均通过；Worker dry-run 打包通过（685 个静态文件，生产限额仍为 100）。

测试使用模拟模型/连接检查响应；未在本环境持有或调用用户的真实生产密钥。未认证探测仅确认官方 `/models`、`/v1/models` 和 `/user/balance` 从开发环境返回 401，不能据此认定生产 Worker 的网络或用户授权正常。真实故障原因待用户在部署后运行“检查连接”，提供安全的检查结果继续定位。
