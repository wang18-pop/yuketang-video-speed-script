# 审查与验证

日期：2026-10-28。范围：本地静态分析、模拟播放器、独立无头浏览器、本机 mock CDP；未连接真实课程账号、播放课程或改变学习记录。

## 问题、影响与修复

| 问题 | 影响 | 修复及验证 |
| --- | --- | --- |
| evaluate 的入参是 JSON.stringify 后的源码字符串 | 控制器未安装却可能输出成功 | 执行源码本体；检查结构化安装结果、版本及 API；字符串返回和异常必须失败 |
| 无匹配时回退首个标签页，子串匹配无域名约束 | 操作无关页面 | 域名、路径、page 类型、唯一目标和 loopback WebSocket 联合校验；不自动导航或启动 CDP |
| 两入口维护两份控制器 | 修复漂移 | CLI 直接读取并执行同一份用户脚本 |
| 重复 apply 覆盖备份、旧 video/player/menu 引用 | 状态损坏或跨实例恢复 | 动态身份检查、首次备份、重复操作幂等；新实例显式应用；复用源/路由/对象时跳过旧快照 |
| DOM data-speed 与 jQuery 缓存不一致 | UI 显示成功但实际速率不同 | 备份并同步缓存，原生 getter 与配置共同验证；失败进行回滚并报告结果 |
| restore 硬编码 1 倍，仅修改表面配置 | 原始倍率、闭包选中值和配置丢失 | 经原菜单处理器恢复内部选中值，恢复原倍率、描述符、菜单、缓存和标签；失败保留可重试备份 |
| trace/untrace 无条件覆盖、删除 video 属性 | 删除其他代码的 getter/setter 或方法 | 移除写入栈包装；测量仅使用事件，保留其他代码的属性 |
| waiting 未结算、seek 计入播放增量 | 虚报实际倍率 | 结算尾部 waiting；区分 pause/seek/end/replacement/navigation；有 seek 或中断时不输出倍率结论 |
| WebSocket 关闭不拒绝 pending、连接和发现无期限、异常漏 close | 挂起或泄漏 | 连接/请求/HTTP 超时、关闭及导航统一拒绝 pending，finally 关闭；页面测量 finally 清理监听和定时器 |
| 数值兜底隐藏非法输入、顶层 ok 忽略 apply | 错误成功报告 | 拒绝非法/无限/越界值，严格单一 action；顶层 ok 随操作结果、失败退出 1 |
| 自动重应用和后台定时器跨生命周期运行 | 无法可靠停止或恢复 | 安装只显示面板，显式 apply；无自动播放、续播或强制改速循环 |

## 实际验证

环境：Windows、Node.js 24.22.1、Git 2.55.0.windows.5、Chrome 156.0.8078.48。

执行命令及关键输出：

```text
npm run check
# 两个入口及全部测试脚本 node --check，exit 0

npm test
# tests 19; pass 19; fail 0; cancelled 0; skipped 0

npm run test:browser
# {"browserSmoke":"PASS","ok":true,"native":1.25,"selected":1.25,"paused":true,"menuRestored":true}

npm install --package-lock-only --ignore-scripts --offline
# audited 1 package; found 0 vulnerabilities（无第三方依赖，不代表完整安全保证）
```

覆盖：目标不匹配/歧义/伪装域名、安装字符串与异常、非法参数、重复 apply、预热缓存、失败回滚、首次及重复恢复、菜单/实例/媒体源/SPA 替换、外部属性保留、手动暂停、正常模拟倍率、尾部 waiting、seek、取消/导航/结束/实例替换、并发测量拒绝、监听清理、连接超时/关闭/异常/发送失败/导航、真实本机 WebSocket 断连及 HTTP 发现超时、CLI 非零退出。

最初的测试也确实暴露并修正了测试夹具问题：中文路径的 URL 解码、属性描述符的默认 enumerable、无头 HTML 中 return 后换行，以及 WebSocket 异常断连的事件顺序。测试未通过时没有视作验收成功。

## 发布与数据检查

- 原目录没有 Git 仓库和已有远程历史；无可重写的旧历史。原文件先备份到本地排除目录，再写入已验证版本；其他既有文件保持原位。
- 历史材料包含账号/课程标识及个人实验日志，全部排除。模式扫描未检出常见 GitHub token、Bearer 凭据或私钥格式；这不是对所有秘密形式的穷尽证明。
- 只提交 `.gitignore`、两个入口、package.json / lock、README / AUDIT / THIRD_PARTY 和三个测试文件。发布前再次检查暂存内容、空白错误、个人路径、敏感模式及文件清单；不使用 git add -f。
- 未发现 LICENSE，也未新增开源许可证；来源不确定性见 THIRD_PARTY.md。旧报告中的平台源码摘录和覆盖率模型不发布。

## 剩余限制

- 本地模拟及原生 getter 测试不证明真实平台当前或长期兼容；适配版本来自旧记录，私有接口可能变化。
- 未测试真实平台播放器重建、闭包实现、完成度、心跳、课程长时间播放、后台节流、丢帧或用户脚本管理器隔离世界。
- 菜单处理器或配置被冻结/失效时，恢复可能失败，返回明确错误并保留重试快照。媒体源/实例被复用后主动放弃旧快照，不跨视频写入。
- CDP 断开后客户端无法保证再向页面发取消指令；采样最长 300 秒自行清理，不安装属性包装。
- 不带自动重应用、旧 cfg 持久化及 trace/untrace 写入栈 API；这些旧功能的移除是为消除状态覆盖及清理风险。安装和刷新均需明确应用。
- isDrag 修改可能同时放宽播放器拖动限制。测量说明见 README；任何成功结果均不等同学习记录完成。
