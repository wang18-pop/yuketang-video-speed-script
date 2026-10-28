# 雨课堂视频加速脚本

客户端播放器倍速工具：显式应用倍率、使用 HTMLMediaElement 原生 getter 读回、测量播放状态、恢复本工具保存的状态。包含用户脚本面板和 Node.js CDP 命令行入口，两者使用同一份 `ykt-5x.js`，无第三方运行依赖。

私有仓库：[wang18-pop/yuketang-video-speed-script](https://github.com/wang18-pop/yuketang-video-speed-script)。需要使用有访问权限的 GitHub 账号登录查看。内部文件名仍为 `ykt-5x.js`、`agent-5x.mjs`，包名为 `yuketang-video-speed-script`。

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

## 先选择使用方式

| 场景 | 需要什么 | 操作入口 | 验证范围 |
| --- | --- | --- | --- |
| 电脑浏览器，日常手动使用 | 浏览器 + Tampermonkey（油猴） | 网页右下角按钮 | 文件具备油猴元数据；管理器与真实平台组合尚未实测 |
| 桌面终端 / 命令行 | Node.js >= 22.4 + 本机 Chrome CDP | `node agent-5x.mjs` | CLI、本机 mock CDP 与模拟播放器已测试 |
| AI Agent | 能运行本地命令的 Agent + 上一行的环境 | 调用 CLI，检查 JSON 与退出码 | 不自动登录或接管普通浏览器 |
| 安卓手机 / 平板 | 支持油猴的浏览器，例如 Firefox for Android | 网页按钮 | 安装路线有官方支持；本脚本未做安卓真机验证 |
| iPhone / iPad | Safari + Tampermonkey 或 Userscripts 扩展 | 网页按钮 | 扩展有官方安装路线；本脚本未做 iOS 真机验证 |
| 雨课堂独立桌面客户端、手机 App、微信内置页面 | 不属于当前支持范围 | 无 | 不能把浏览器脚本当作客户端插件安装 |

**电脑端在这里指浏览器网页；桌面命令行是另外一种操作入口。本项目没有独立桌面应用、手机 App 或安装包。** 油猴使用不需要 Node.js；命令行和 Agent 使用不需要额外安装油猴。

## 电脑浏览器：安装到油猴

1. 使用 Chrome、Edge 或 Firefox，从 [Tampermonkey 官网](https://www.tampermonkey.net/)选择对应浏览器的正式扩展。
2. Chromium 浏览器若提示脚本执行权限，进入油猴的扩展详情，启用“允许用户脚本”；没有该开关时按对应版本启用开发者模式。仅安装扩展不一定已经获得脚本执行权限，见[油猴官方说明](https://www.tampermonkey.net/faq.php?q=Q209)。
3. 登录 GitHub，打开仓库内的 [ykt-5x.js](ykt-5x.js)。复制**完整源码**，包括开头 `// ==UserScript==` 到 `// ==/UserScript==` 的元数据；不要复制 GitHub 页面的导航或 Markdown 代码围栏。也可使用本地同名文件内容。
4. 点击油猴图标 → 控制面板 → 添加新脚本。删除编辑器默认模板，粘贴完整源码，保存（电脑通常用 Ctrl+S；macOS 用 Command+S），确认脚本已启用。手动粘贴安装是[油猴官方支持的方式](https://www.tampermonkey.net/faq.php?q=Q102)。
5. 在**同一个安装了油猴的浏览器**中，由你自己登录平台、打开具体视频网页。地址必须符合下面的结构，占位符应为平台实际地址的一部分，不是照抄输入：

   ```text
   https://www.yuketang.cn/ai-workspace/lms-graph/<CLASSROOM_ID>/video/<VIDEO_ID>
   ```

6. 完整刷新这个视频页面，等播放器加载。右下角应出现 `2× / 3× / 4× / 5× / 恢复` 按钮。如果是从站点首页通过 SPA 跳转进视频页，首次使用尤其需要在具体视频地址上完整刷新。
7. 点击 `5×`。按钮旁结果应有 `ok:true`、`real:5`、`sp:5`；其中 real 来自原生访问器。然后由你自己点击播放器的播放按钮。
8. 暂停仍用播放器自己的暂停按钮。要撤销本工具设置，点击“恢复”；它恢复应用前的倍率与配置，**不保证是 1×**，也不负责暂停。

安装只会添加面板，**不会自动应用或自动播放**。刷新、切换视频或播放器重建后需要重新确认并点击倍率。不要同时启用旧版与新版脚本；已安装旧版时，在油猴中编辑原条目替换源码，或先禁用旧条目再添加。

当前文件名不是 `.user.js`，且仓库是私有的，因此不要依赖点 Raw 后自动安装。使用上面的“复制源码 → 油猴新建脚本”流程。这个手动安装方式也不提供仓库自动更新；更新时需再次替换源码。

## 桌面终端：使用 Node.js 命令行

下面是 Windows / PowerShell 7 的流程。macOS / Linux 的 CLI 参数相同，但 Chrome 路径和浏览器启动命令需要按系统调整，未在这两种系统复测。

### 1. 获取项目并检查 Node.js

可以在已登录 GitHub 的浏览器中使用 Code → Download ZIP 并解压，或用已经配置 GitHub 访问权限的 Git 克隆：

```powershell
git clone --branch codex/audit-and-repair https://github.com/wang18-pop/yuketang-video-speed-script.git
Set-Location ./yuketang-video-speed-script
node --version
node ./agent-5x.mjs --help
```

Node.js 需 >= 22.4，可从 [Node.js 官网](https://nodejs.org/)安装。ZIP 下载用户应先在终端进入**实际解压出的项目目录**，不要照抄上面的 Set-Location 目录名。本项目零运行依赖，使用 CLI 不必先 npm install；开发与复核可执行前面的安装检查命令。

### 2. 手动启动独立的调试浏览器

先检查 9222 是否已经被占用；占用时不要关闭未知进程，应确认已有服务，或为新浏览器和下方 CLI 一起选择其他本机端口。

```powershell
Get-NetTCPConnection -State Listen -LocalPort 9222 -ErrorAction SilentlyContinue
```

如果没有占用，可在 PowerShell 7 中执行下面的启动示例。这会打开供你交互操作的独立 Chrome 窗口；Chrome 不在默认安装路径时，应先把 `$chrome` 改为自己的可执行文件路径。

```powershell
$chrome = Join-Path $env:ProgramFiles 'Google/Chrome/Application/chrome.exe'
$profile = Join-Path $env:LOCALAPPDATA 'YuketangVideoSpeed/ChromeProfile'
& $chrome '--remote-debugging-address=127.0.0.1' '--remote-debugging-port=9222' "--user-data-dir=$profile"
```

此配置目录仅供这个调试窗口使用，不要放进项目或提交 Git。它与普通 Chrome 的登录状态分开，需要你在新窗口里自己完成登录并打开目标视频网页。Chrome 136 起，调试开关需要配合非默认用户目录，见 [Chrome 官方说明](https://developer.chrome.com/blog/remote-debugging-port)。CLI 本身不启动浏览器、不开放端口、不导航、不代填账号；CDP 仅连接本机。

### 3. 选择目标、应用与恢复

在项目目录执行：

```powershell
node ./agent-5x.mjs --list
```

从输出 `targets` 中找到目标 ID。列表只包含符合域名与页面类型条件的视频标签页，不输出真实课程链接；为空时先检查是否在**刚启动的调试窗口**中打开了正确视频页面。多个候选时先自行确认目标，不能随便取第一项。

把下面字符串 `TARGET_ID` 替换为确认的 ID，再按顺序操作：

```powershell
node ./agent-5x.mjs --target="TARGET_ID" --state
node ./agent-5x.mjs --target="TARGET_ID" --apply=5
```

成功应看到顶层 `ok:true`，并确认 result 中 `real:5`、`sp:5`。需要播放时，由你在浏览器里点击播放；命令不会启动播放。要采样，先确认视频已正常播放，再执行：

```powershell
node ./agent-5x.mjs --target="TARGET_ID" --apply=5 --measure=60
```

测量时避免拖动；发生 seek 时倍率会返回 null。暂停会计入 pauseSec。自然结束只代表媒体结束，不代表课程完成。

撤销修改：

```powershell
node ./agent-5x.mjs --target="TARGET_ID" --restore
```

最后关闭独立调试浏览器即可停止该窗口的 CDP。不要同时用其他倍速插件反复修改同一播放器。若你选择了其他端口，每条 CLI 命令都要追加例如 `--cdp=http://127.0.0.1:9230`，且浏览器启动参数中的端口也必须一致。

## Agent：调用已有命令行入口

这里的 Agent 指**能够在本机运行终端命令**的工具；只有文字对话、没有本地执行能力的 Agent 不能直接控制浏览器。本项目无需特定 AI SDK、API Key 或 MCP 插件，Agent 调用 `agent-5x.mjs` 即可。

先由用户按上一节准备 Node.js、独立 CDP 窗口、登录和目标视频页，再向 Agent 明确授权具体操作。可以使用这个提示词，自己替换项目路径：

```text
项目目录：<PROJECT_DIRECTORY>。
我已手动准备好本机 CDP http://127.0.0.1:9222 和目标视频页面。
请先阅读 README，运行 --list 和 --state 核对目标。
多个候选时让我确认，不要随便选择。
我授权你对确认的目标执行 --apply=5，并报告退出码和 JSON 中的 ok、real、sp。
不要登录账号、启动播放、跳转视频、修改学习记录、输出凭据或真实课程链接。
没有额外授权时不要测量或操作其他页面；失败时停止并报告。
当我要求撤销时，对同一目标执行 --restore，并报告是否实际恢复或跳过了复用实例。
```

Agent 操作顺序为 `--list → 确认目标 → --state → --apply=5 → 核对结果`。仅凭进程有输出、UI 写着 5× 或 JSON 中某个子字段不能判定成功；必须同时检查退出码、顶层 ok 和实际状态。

测量需要额外明确要求，例如“我已手动开始播放，请对同一目标采样 60 秒”；对应命令为 `--apply=5 --measure=60`，不是自动播放指令。CLI 的 measure 单位是**秒**，页面 API 的 measure 单位是**毫秒**。

## 安卓手机 / 平板

推荐安装路线是 Firefox for Android + Tampermonkey；[Mozilla 的扩展页面明确标注 Android 支持](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)。**这只证明管理器支持，不代表本脚本已在手机上验证成功。**

1. 在 Firefox for Android 的扩展管理中安装 Tampermonkey，并启用所需的网站访问权限。
2. 在该浏览器登录有仓库访问权限的 GitHub 账号，打开 `ykt-5x.js`，复制完整源码。
3. 打开 Tampermonkey 控制面板 → 新建脚本 → 替换默认内容 → 保存并启用。不同版本的菜单位置可能不同。
4. 在同一浏览器打开目标视频网页，尝试打开“桌面版网站 / 请求桌面网站”，然后完整刷新。只有 URL 与播放器结构都符合电脑网页版适配条件时才可能工作；桌面模式不保证平台一定提供相同结构。
5. 在网页内等待播放器加载，出现面板后点击 `5×`，检查结果，再由你自己点击播放。看不到面板或提示未就绪时，不要判定已经应用成功。
6. 要恢复时退出全屏，在网页中点击“恢复”。手机原生全屏可能不会显示网页面板；可先在普通网页视图操作，再进入全屏。

不要在雨课堂 App、微信内置浏览器或未装脚本管理器的其他浏览器里寻找这个面板。本脚本没有手机后台保活功能，锁屏、切后台后不保证持续播放或倍率；安卓本地 Node.js / CDP 方案未适配。

## iPhone / iPad

使用 Safari 的用户脚本扩展。Tampermonkey 官方提供 [iOS 安装入口](https://www.tampermonkey.net/index.php?browser=safari)；也可以使用 [Userscripts 官方项目](https://github.com/quoid/userscripts)，其说明列有 iOS / iPadOS 安装和脚本目录方式。**当前脚本未在 iPhone / iPad 上实测，以下是安装与尝试路线。**

### 方式 A：Safari + Tampermonkey

1. 从官方入口安装适合当前 iOS 的 Tampermonkey。
2. 在系统设置或 Safari 扩展管理中启用它，允许访问目标站点；具体入口取决于系统版本。
3. 如果当前版本提供新建脚本编辑器，按电脑端流程粘贴完整源码并保存；若使用文件导入，按该扩展的导入界面选择脚本文件。
4. 在 Safari 打开具体视频网页，选择“请求桌面网站”后完整刷新。面板出现且应用结果确认成功后，再手动播放。

### 方式 B：Safari + Userscripts

1. 安装 Userscripts，打开其 App，确认脚本保存目录；在 Safari 扩展设置中启用扩展，并允许访问目标网站。
2. 将仓库 `ykt-5x.js` 的**源码内容**保存为 `ykt-5x.user.js`，放到 Userscripts 指定的目录。这里只改手机本地副本名称，仓库内部文件名不变。确认没有保存成 `.js.txt`，内容不是 GitHub HTML 网页。
3. 在 Safari 打开具体视频网页，通过扩展菜单确认脚本已被识别和启用。私有仓库不依赖公开安装链接；官方支持直接向脚本目录保存 `.user.js` 文件，见 [Userscripts 安装说明](https://github.com/quoid/userscripts#usage)。
4. 请求桌面网站并刷新，退出原生全屏后查看网页面板。点击 `5×`、核对结果，再手动播放；撤销用“恢复”。

iOS 的播放器、原生全屏及页面结构可能与电脑不同。如果始终没有面板、无法找到播放器或实际倍率不是 5，当前设备 / 页面组合就尚未验证可用；不要用修改 URL 匹配规则来假装兼容。此项目不提供 iOS App 内注入或手机 Agent 执行方案。

## 页面 API 与 CLI 参数参考

页面主世界中安装完成后，可在开发者控制台使用：

```js
ykt5x.apply(5)             // 0.25–16；结果 ok 必须为 true
ykt5x.state()              // real 为原生读回；sp 为播放器配置
await ykt5x.measure(60000) // 页面 API 单位：毫秒，10–300000
ykt5x.cancelMeasure()
ykt5x.restore()
ykt5x.dispose()            // 先恢复，成功后移除本工具面板和 API
```

如果脚本管理器隔离世界导致控制台看不到 API，不要据此宣称脚本未安装，先检查面板结果及管理器执行状态；本项目要求脚本能够访问页面播放器对象。不同管理器的隔离设置尚未逐一验证。

CLI 选项：

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
