# v4.1.0 审查与验证

日期：2026-10-31。独立分支 `codex/background-autonext`，不直接推送 main。

## 增量实现

- 复用原保速与恢复逻辑；新增事件驱动后台续播，有限重试并保守处理用户暂停、缓冲与未知原因。
- 增加五平台候选目录扫描、结构化完成状态、会话去重与单次原生目录导航；自然 ended 与平台明确完成必须同时成立。
- 加入 API、CLI 与一个中文面板。整页跳转不假装保留旧注入，重新安装后默认关闭自动化。
- 无新增运行依赖。原有 31 项测试全部保留。

## 独立对抗审查

实际复现并修复三项：恢复时同步停止仍点击目录；nextVideo.play() 永不兑现使连播挂起；停止/解绑/卸载后的迟到后台 play() 仍启动旧视频。分别增加取消 token 检查、10 秒启动期限及可取消等待、旧请求视频的迟到暂停保护；补充回归。重放视频的 ended 监听可重新武装，重复 ended 不产生多次导航。

完成更新最多等 15 秒，导航/新媒体最多等 20 秒，自动播放启动最多等 10 秒；每个候选只点击一次。扫描每次重取 DOM，课程改变、资源重复或未知状态停止；未知类型不当视频处理。

## 实际执行

```text
npm run check: exit 0
npm test: 59 passed, 0 failed
npm run test:browser: browserSmoke=PASS
```

真实 Chrome 使用独立临时配置、回环 HTTP、标准 video 解码本地生成的 WAV 媒体，无真实课程账号。一次通过的结果：前台 real=5，overallRate=5.010374；真实切换到其他标签页后 document.hidden=true，1.2013 秒媒体推进 4.38424 秒（含一次后台相关暂停续播），末次稳定采样 observedHidden=true、effectiveRate=4.987229。没有把切后台时的暂停段算成始终五倍速。

同一浏览器内验证第一段媒体原生自然 ended=true，测试目录元数据随后显示 completed，只产生一次目录点击，新媒体完成加载后 real=5、paused=false、currentId=two。测试中的完成元数据和目录由本地夹具提供；为缩短测试对夹具媒体进行过 seek，没有修改任何网站记录。

雨课堂适配回归：native=1.25、selected=1.25、isDrag=false、paused=true、menuRestored=true。以上不是五个平台真实课程的兼容证明，也没有验证电脑最小化、操作系统休眠、所有浏览器或全部页面版本。

## 来源与工程边界

实际阅读参考 A [Breeze1733/yuketang-auto-player 源码](https://github.com/Breeze1733/yuketang-auto-player/blob/HEAD/yuketang.user.js) 的 observePause/keepAlive；参考 B、C 及五平台目录事实见 [ADAPTERS.md](ADAPTERS.md)。阅读参考 D [hajimixiaojie/yuketang-auto-reader/course-helper.js](https://github.com/hajimixiaojie/yuketang-auto-reader/blob/HEAD/course-helper.js) 的 findVideoFrame、startVideo、getVideoState 与播放监控；只借鉴检查实际播放与期限的设计，没有沿用无限继续、结束近似或直接完成上报。所有新增代码独立编写，未复制参考项目实现。

本机 Git 代理失效，绕过失效代理的一次 clone 也被连接重置。保留原工作区，在独立目录基于已核验的 v4.0.0 文件创建本地基线提交和开发分支；若发布远程开发分支，则通过 GitHub tree/commit/ref 接口以实际 main 提交为父提交，避免覆盖 main 或上传其他个人文件。

## 未覆盖与受限情况

学习通和云班课缺单资源完成元数据时不能可靠自动连播；其他平台未知页面版本同样停止，需要 Agent 明确适配。全页跳转重新注入和启用是显式要求，不提供跨页自动登录或无限重载。网站策略导致无法后台播放时，如实报告 paused/error/进度不推进，不伪造支持。

