# 目录适配的实际依据

日期：2026-10-31。只读取公开源码、运行本地夹具；未登录五个平台或验证真实课程。实现为独立编写，未复制参考项目的函数或业务流程代码。

已读取 LICENSE：ComplexAutomation 为 GPL-3.0，Sciroccogti、OCS、BlueShitSupport 为 MIT。这里只借鉴目录事实与设计，未粘贴其实现；GPL 项目业务逻辑不纳入本脚本。

## 已实际阅读的实现

- 雨课堂新版：[nagelanping/yuketang-ComplexAutomation](https://github.com/nagelanping/yuketang-ComplexAutomation/blob/HEAD/yuketang-ComplexAutomation.user.js)。读取 `getAllScourse()`（2353附近）、`autoSelect()`（4751附近）、`handleNext()`（4779附近）：目录 `.nav-item-leaf-box`，当前项目内部 `.leaf-item.is-active`，通过真实项目点击切换，递归中需要重复导航保护。该参考没有证明所有新版目录都有稳定资源ID、类型或完成状态，因此本实现不从目录位置生成这些元数据。
- 雨课堂旧版：[Sciroccogti/seu-yuketang-autoplay](https://github.com/Sciroccogti/seu-yuketang-autoplay/blob/HEAD/autoplay.js)，63–86附近：`.leaf-detail`、`.icon--shipin` 和 `.progress-time .progress-wrap .item`；只有明确标签才可认定完成。没有沿用其ID加一导航。
- 学习通：[OCS cx.ts](https://github.com/ocsjs/ocsjs/blob/HEAD/packages/scripts/src/projects/cx.ts)，1285–1310附近：`.posCatalog_select`、`.posCatalog_active`、`cur`章节ID、`.jobUnfinishCount`。这些是章节级而非单视频级；只有明确的资源类型信息才标记视频，避免把包含作业的章节当成视频。
- 智慧树：[OCS zhs.ts](https://github.com/ocsjs/ocsjs/blob/HEAD/packages/scripts/src/projects/zhs.ts)，97–115附近：`.clearfix.video`、`.current_play`、`.time_icofinish`。完成图标存在可证明完成；图标不存在不自动解释为未开始。
- 智慧职教：[OCS icve.ts](https://github.com/ocsjs/ocsjs/blob/HEAD/packages/scripts/src/projects/icve.ts)，296–399附近：`.s_point[itemtype]`、`.s_pointerct`、`.done_icon_show`；636–700附近AI版目录：`.panelList .node`、`.active`、`i.wc`。另读 zjy.ts 的 next/getCourseData 流程，未沿用其URL拼接跳转。
- 云班课：[BlueShitSupport app.py](https://github.com/2017IOTrepo/BlueShitSupport/blob/HEAD/src/app.py)，`get_course_src()`：资源在 `.hide-div` 的子元素中，资源ID来自 `data-value`，资源地址 `data-href`，名称 `.res-info .res-name`。`data-is-drag` 是拖动相关字段，不能证明已看或未看，本实现没有使用它判断完成。另读 sugar66/mosoteach_mooc/main.js，其方法是直接上报进度且没有可复用目录判定，因此没有采用。

## 保守边界

内置五个平台目录识别与 `data-video5x-resource` 显式元数据合同；不同页面缺稳定ID、课程ID、视频类型或完成状态时，返回缺失/unknown并停止，而不是伪称兼容。此版本不等于五个平台所有UI版本均已实测适配。用户Agent可先审查当前DOM后通过 `catalogue.register(scanFunction)` 补充可靠映射。函数返回含可原生点击element的当前目录快照；每次scan重读，重复ID/失效element拒绝。

`data-resource-id` / `data-id` / `data-type` / `data-status` / `data-progress` / `data-course-id` 等通用字段只在DOM明确存在时消费，是本工具的显式元数据入口，不声称所有目标平台原生具有这些字段。没有元数据时不会伪造字段。

测试：`node --test test/catalogue.test.mjs`，7 passed，0 failed。五个平台代表夹具只证明对这些结构与明确元数据的处理，不能替代真实站点验收。

