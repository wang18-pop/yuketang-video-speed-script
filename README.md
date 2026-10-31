# 网页视频五倍速脚本 v4.1.0

让 ai 根据当前网页视频修改倍数，并按用户选择启用后台续播和未完成视频连播。

## 电脑网页使用方法

复制仓库地址给 ai，让它根据你当前的视频插入五倍数脚本：

[https://github.com/wang18-pop/yuketang-video-speed-script](https://github.com/wang18-pop/yuketang-video-speed-script)

先选择当前视频并应用五倍速，再在同一个中文面板中按需开启「后台续播」「自动连播」。两项默认关闭。「停止自动化」取消保速、续播和导航；「恢复」进一步恢复原倍速。停止自动化不会主动暂停用户原本正在播放的视频。

自动连播只在当前视频自然结束、平台明确记录完成之后，点击目录中的下一条可确认未完成的视频，再绑定新播放器、应用所选倍率并尝试播放。不处理作业或答题。未知状态、重复资源、播放被拒或导航超时会停止。

## 平台范围

保留标准 HTML5 视频与雨课堂播放器适配。内置雨课堂、学习通、智慧树、智慧职教、云班课的候选目录识别；每个平台的页面版本、资源标识、类型及完成元数据都必须能可靠识别。学习通章节任务数不能当成单个视频完成状态，云班课拖拽许可不能代表未看。缺少可靠信息时需要 Agent 按当前页面补充适配，不能宣称这些平台所有课程已兼容。见 [目录依据与边界](ADAPTERS.md)。

## Agent API

原接口 `apply(5, index)`、`state()`、`videos()`、`measure(ms)`、`restore()`、`dispose()` 保留；`window.ykt5x` 仍是 `window.video5x` 的别名。

```javascript
window.video5x.apply(5, 0)
window.video5x.background.enable()
window.video5x.background.state()
window.video5x.background.disable()
window.video5x.autonext.enable()
window.video5x.autonext.state()
window.video5x.autonext.disable()
window.video5x.catalogue.scan()
window.video5x.stop()
```

`background.state()` 提供暂停、缓冲、错误、真实倍率和 `progress`；检查 `observedHidden`、实际媒体推进量及有效倍率后，才能报告观察到后台播放。无法确定的暂停不会强制恢复。后台续播最多 3 次退避重试，拒绝自动播放时停止。

`catalogue.register(scanFunction)` 允许 Agent 在核实当前 DOM 后补充网站适配，传 `null` 恢复内置扫描。函数每次返回新快照：`{platform, courseKey, items:[{id,title,kind,status,active,element}]}`。`kind` 为 `video/other/unknown`；`status` 为 `completed/in_progress/not_started/unknown`；`element` 必须是当前可原生点击的目录元素。不得自行补写平台完成状态。

## Agent CLI

Node.js >=22.4，浏览器已配置本机 CDP。CLI 不启动浏览器或登录。先 `--list` 选择用户指定标签页，再用 `--target=<id>`：

```text
node agent-5x.mjs --list
node agent-5x.mjs --videos --target=<id>
node agent-5x.mjs --apply=5 --video=0 --target=<id>
node agent-5x.mjs --background=on --target=<id>
node agent-5x.mjs --background=state --target=<id>
node agent-5x.mjs --background=off --target=<id>
node agent-5x.mjs --catalogue --target=<id>
node agent-5x.mjs --autonext=on --target=<id>
node agent-5x.mjs --autonext=state --target=<id>
node agent-5x.mjs --autonext=off --target=<id>
node agent-5x.mjs --stop --target=<id>
node agent-5x.mjs --restore --target=<id>
```

每次 CLI 调用都会核实并安装当前版本控制器。SPA 切换可在已启用的连播会话内重新扫描和绑定；整页跳转会销毁临时注入及运行会话，Agent 必须在新页面重新执行安装和启用命令。用户脚本管理器重新加载脚本后也默认关闭自动化，需用户或 Agent 重新确认启用，不自动恢复旧会话。

## 限制与验证

后台浏览器节流、自动播放策略和跨域 iframe 可能限制功能；隔离 frame 需在对应上下文注入。浏览器关闭、电脑休眠或网站拒绝后台播放时不能保证继续。脚本不伪造可见性，不屏蔽全站事件，不上报或伪造学习进度。

实际执行命令和证据见 [AUDIT.md](AUDIT.md)：本地单测及真实 Chrome 本机媒体夹具已运行，五个平台真实课程尚未逐站验证。

