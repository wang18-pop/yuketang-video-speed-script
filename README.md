# video-speed-tool

客户端播放器倍速工具：显式应用倍率、使用 HTMLMediaElement 原生 getter 读回、测量播放状态、恢复本工具保存的状态。包含用户脚本面板和 Node.js CDP 命令行入口，两者使用同一份 `ykt-5x.js`，无第三方运行依赖。

**不会启动播放、续播、修改心跳或完成度、生成观看记录。设置倍率成功、HTTP 成功或媒体结束，都不代表课程完成。**

## 环境与版本

- Node.js >= 22.4，使用内置 fetch / WebSocket；本次实际测试 Node.js 24.22.1、Windows、Chrome 无头模式。
- 已安装的 Chrome / Chromium，或能够在页面主世界运行且提供站点 jQuery 的用户脚本环境。
- 页面适配仅限 `https://www.yuketang.cn/ai-workspace/lms-graph/<CLASSROOM_ID>/video/<VIDEO_ID>`。
- 适配结构来自旧项目对 web 1.2.339 的记录；**未在真实平台复验该版本，也未验证当前版本长期兼容**。运行时要求 `.xtplayer.__vue__.$data.player.video` 与容器内 video 是同一对象，且 options、倍速菜单及 jQuery API 符合预期；无法确定身份时失败。
- 本地模拟的 DOM / 菜单处理器不是平台源码，测试不证明真实平台行为。

## 安装与检查

```sh
npm ci --ignore-scripts
npm run check
npm test
```

本项目是直接运行的脚本，无打包或构建步骤。保留锁文件便于复核。

可选的真实 Chromium 本地模拟测试（PowerShell 7）：

```powershell
$env:BROWSER = '<CHROMIUM_EXECUTABLE>'
npm run test:browser
```

此测试使用临时浏览器配置和本地 HTML，禁用域名解析，使用原生 video 倍率访问器；不加载媒体、不连接账号。需要允许启动本地浏览器进程。

## 使用

将 `ykt-5x.js` 安装为用户脚本，或在已经确认的目标页面主世界执行完整文件。右下角提供 2–5 倍及恢复按钮。脚本安装后**不会自动应用或自动播放**，不再读写旧版 localStorage 配置。

```js
ykt5x.apply(5)             // 0.25–16；结果 ok 必须为 true
ykt5x.state()              // real 为原生读回；sp 为播放器配置
await ykt5x.measure(60000) // 页面 API 单位：毫秒，10–300000
ykt5x.cancelMeasure()
ykt5x.restore()
ykt5x.dispose()            // 先恢复，成功后移除本工具面板和 API
```

CLI 仅连接用户已经手动开启的本机 CDP。它不会启动浏览器或开放调试端口；不要向公网暴露 CDP，不要在示例中填写账号凭据。浏览器采用隔离配置且由用户管理。

```sh
node agent-5x.mjs --help
node agent-5x.mjs --list
node agent-5x.mjs --target=<TARGET_ID> --state
node agent-5x.mjs --target=<TARGET_ID> --apply=5
node agent-5x.mjs --target=<TARGET_ID> --apply=5 --measure=60
node agent-5x.mjs --target=<TARGET_ID> --restore
```

选项：

| 选项 | 含义 |
| --- | --- |
| `--cdp=http://127.0.0.1:9222` | 仅接受 HTTP loopback；返回的 WebSocket 也必须是本机地址 |
| `--target=<TARGET_ID>` | 精确选择标签页 ID |
| `--match=<SUBSTRING>` | 在合法视频页内进一步筛选；零个或多个结果均失败 |
| `--url=<VIDEO_PAGE_URL>` | 精确匹配已打开页面，**不导航**；URL 用占位符并在终端正确引号包围 |
| `--timeout=10000` | 100–60000 毫秒；用于发现、连接和请求超时，以及就绪轮询期限 |
| `--measure=60` | CLI 单位：秒，0.01–300；必须配合 apply |
| `--json` | 兼容参数；所有结果本来就是 JSON |

失败退出码为 1。`ok` 为顶层操作结果，包含 apply 或测量失败；不要只看输出存在或页面返回字符串。

## 恢复与生命周期

- 重复 apply 保留第一次备份，同倍率且状态一致时不会重复点击或绑定监听。
- 每次操作重新解析 video / player / options / menu / 菜单项 / 媒体源 / URL。实例或菜单替换后 state 标记 stale；下一次显式 apply 先恢复原实例，再为新实例备份。
- restore 经原菜单处理器恢复内部选中值，再恢复配置属性描述符、原生实际倍率、菜单属性与内容、缓存和原标签文本。它不硬编码 1 倍，也不改变暂停状态。
- 同一个 video 被新媒体源或新 player 复用时，不把上个实例的备份写入新实例；返回 `skippedReusedInstance: true`。这表示旧快照已放弃，不能宣称新视频被恢复。
- 恢复失败返回 `ok:false, retryable:true` 并保留备份。保持原页面并重试；不要在此时重复安装另一个版本。若站点已替换私有 API，完整刷新页面可清除本工具的内存修改，但可能影响页面自己的未保存状态。
- 刷新后控制器及备份消失；用户脚本可重新安装面板，但需要再次明确应用。SPA 切换不会自动改速。
- 不安装媒体属性包装；原有自定义 getter / setter 保持不动，若它阻止实际改速则返回失败。旧版 trace/untrace 写入栈包装、自动补速定时器和持久化 cfg 已移除。

## 测量解释与限制

`wallSec` 是墙钟时间；`waitSec` 包含结束时尚未退出的 waiting；`pauseSec` 与 `seekSec` 分别统计暂停和跳转状态。`overallRate` 使用媒体时间增量/墙钟，`netRate` 使用媒体时间增量/playing 状态时间。

检测到 seeking 时，两项倍率均为 null；替换实例、导航或取消时返回明确 reason、`ok:false` 和 null 倍率。自然 ended 可以终止采样，**不是课程完成判据**。真实浏览器的后台节流、事件丢失、极短采样和解码开销仍会影响数值；本工具不测量实际呈现帧率。

测量同一时刻只允许一项。结束和异常路径用 finally 移除监听及定时器。CDP 断连会立即拒绝待响应请求并关闭客户端；连接已丢失时无法保证向页面发送取消命令，页面采样最长 300 秒后自行清理。它没有诊断属性包装，也不会自动播放。

该旧版播放器需要设置 `options.isDrag=true` 才能避免其时间回滚；这也可能改变拖动限制，是客户端行为副作用。工具不保证平台或教师对倍率的接受方式，也不读取、推断或写入学习完成记录。

## 故障排查

| 结果 | 处理 |
| --- | --- |
| 找不到唯一目标 | `--list` 仅列出合法页的 ID，再使用 `--target`；不会回退其他标签页 |
| Controller installation failed | 注入未实际执行、旧控制器冲突或方法不完整；保持失败状态，检查版本 |
| Player readiness timeout | 等播放器加载后重试；检查结构是否属于适配版本，不用固定 sleep 推断成功 |
| Supported jQuery required | 页面未提供适配的 jQuery；不自动加载第三方库 |
| Apply failed | 检查 rollback 结果；只信原生倍率和内部配置读回，不以 UI 文本判断成功 |
| Restore step failed | 保留页面重试；对象/菜单已损坏时可能需要完整刷新 |
| WebSocket disconnected / Page context changed | 操作已失败；重新确认目标后发起新请求 |

## 发布边界与许可证

发布使用 `.gitignore` 白名单：两个入口、测试、包清单、锁文件和项目文档。原目录历史课程记录、实验报告、覆盖率模型和原文件备份保留在本机，不纳入 Git。不得使用 `git add -f` 绕过排除规则。

未发现原项目许可证，未替项目添加新开源许可证。仓库为私有；第三方来源边界见 [THIRD_PARTY.md](THIRD_PARTY.md)。审查结论和实际验证见 [AUDIT.md](AUDIT.md)。
