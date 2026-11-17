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
