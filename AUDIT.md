# Agent 接口与审查记录

版本：4.0.0。日期：2026-10-29。只面向电脑网页，不新增运行依赖。

## Agent 执行顺序

1. 读取 `ykt-5x.js`，在用户指定视频所在的页面上下文执行源码本体。不要把源码 JSON 字符串当作脚本执行。安装本身不会应用倍速。
2. 调用 `window.video5x.videos()` 列出视频，再调用 `window.video5x.apply(5, index)`。多个视频时必须明确选择；第二参数也可直接传当前视频元素。无第二参数时沿用已选视频，或选择唯一视频。
3. 读取 `window.video5x.state()`，核对 `ok`、`real`、`target`、`keeping`。不要仅凭网站倍速标签宣布成功。雨课堂适配另检查内部选中值 `sp` 和 `isDrag`。
4. 用户正在播放时可调用 `await window.video5x.measure(3000)` 验证实际媒体推进速度。发生跳转、中断或拖动时不要使用无效倍率；`cancelMeasure()` 可取消。
5. `restore()` 停止保速并恢复原倍速；`dispose()` 进一步删除面板与全局 API。恢复失败返回 `retryable` 并保留备份，修复原因后重试。旧名称 `window.ykt5x` 保留为同一个 API 的别名，文件名保留以兼容原仓库链接。

仅显式 apply 后每 500 ms 检查一次已选视频的倍率，网站重置时重新设置。视频、来源、路由或播放器发生变化时停止保速，Agent 应重新检查和明确应用；不会自动选择下一个视频。保速失败会停止并报告错误。脚本不自动播放、不跳转时间、不修改学习记录。

## CLI

CLI 读取同一份控制器，使用 Node.js >=22.4 的内置模块。浏览器须已由用户或其 Agent 配置本机 CDP。脚本不启动浏览器或登录。先用 `node agent-5x.mjs --list` 查找页面，再用 `--target=<id>` 锁定用户指定标签页。

- `node agent-5x.mjs --videos --target=<id>`：列出视频索引。
- `node agent-5x.mjs --apply=5 --target=<id> --video=0`：应用并保速。
- `node agent-5x.mjs --state --target=<id>`：读回状态。
- `node agent-5x.mjs --restore --target=<id>`：恢复。

目标必须为 HTTP(S) 的唯一 page，CDP 及 WebSocket 必须位于 loopback。禁止回退到不明确的首个标签页。非法参数、失败操作、超时或断连以非零退出码结束。

## 支持边界

标准 HTML5 视频使用原生 playbackRate；雨课堂可识别的 xtplayer 保留已有菜单与 Vue 响应式配置适配。可发现同源 iframe 及开放 Shadow DOM 中的视频，并对所选视频保速。多个视频不会一并加速；尚无视频或媒体未就绪会返回失败。

跨域或 sandbox 隔离的 iframe 会计入 blockedFrames，需要 Agent 在目标 frame 内另行执行。封闭 Shadow DOM、非标准或拒绝倍速的播放器需要按网站适配；直播即使属性接受 5 也不保证实际加速。浏览器可能限制可用倍率或五倍速声音。本轮只验证本机 Chrome，没有逐网站或其他浏览器验收。

## 实际验证

实际执行结果：`npm run check` exit 0；`npm test` 31 passed、0 failed；`npm run test:browser` exit 0、browserSmoke=PASS。测试覆盖非法输入、空/未就绪视频、多视频选择、原倍速恢复、媒体错误、站点重设、保速失败、来源/路由替换、取消与并发测量、回滚失败重试、过期绑定重新应用、CDP 超时/断连及非零退出。

独立审查复现并修复：HTML5 转雨课堂时两份备份冲突；媒体 error/未就绪时错误丢弃备份；CLI 以旧绑定状态阻止重新 apply。三项均补充回归，独立复核已关闭。

真实 Chrome 使用独立临时配置和仅本机 HTTP 夹具。通用测试由原生 video 元素解码本地生成的 WAV 媒体：最终运行 1.2009 秒推进 5.928405 秒，overallRate=4.936635（此前一次为 5.000087）；无 seek、暂停或缓冲。另验证多视频、同源 iframe、开放 Shadow DOM、隔离 frame 报告、网站重设后的保速、恢复到 1.25 倍及保持暂停。雨课堂菜单与 Vue getter/setter 使用本地模拟夹具，最终 native=1.25、selected=1.25、isDrag=false、menuRestored=true。

此证据证明本地核心及真实 Chromium 媒体链路通过，不是本轮真实雨课堂或全部网站的兼容证明。

