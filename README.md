# 品牌售后政策采集服务

这是一个用于品牌售后政策的本地数据采集与归档服务。当前版本从仓库自带的合成来源记录读取一页数据，经过字段规整后写入进程内目录；来源内容和规整后的记录保留独立边界，便于在不访问外部系统的情况下复现采集过程。

来源中的每条政策记录带 `policyId`、`version`、`state`（`draft` / `published` / `active` / `withdrawn`）、`effectiveAt`、可选的 `effectiveUntil` 与 `withdrawnAt`，以及条款正文 `content`。采集时按「来源 + 政策 + 版本」存档，同一版本只在 `revision` 不降时更新，因此提前发布、之后撤回或改稿的版本都会留下轨迹。

客服查询不读「最近一次抓取到的那一版」，而是按咨询发生时间取版本：

- 咨询时间早于某版本的 `effectiveAt` 时不会引用该版本，即使它已经发布；
- 咨询时间达到 `effectiveAt`（含）后由新版本接管，旧版本不再引用；
- `effectiveUntil` 之后版本失效；已撤回版本只对撤回前的咨询有效；
- 没有可用版本时返回 `no-effective-version`/`unknown-policy`，不会拿相邻版本顶替。

每次答复都会把所依据的版本快照（版本号、适用区间、正文、修订号、抓取时间）封存在答复里。后续来源再抓到新版本、撤回或改稿，已发出的答复仍可通过 `explain(answerId)` 原样解释当时依据了什么。

```js
import { PolicyArchive } from './src/pipeline.mjs';

const archive = new PolicyArchive();
await archive.collect(); // 也可传入 { source, store } 以复现固定数据

const answer = archive.answer({
  policyId: 'returns',
  inquiryAt: '2026-11-20T10:00:00Z', // 咨询发生时间，不是抓取时间
});
// answer.basis 即当时适用的版本快照；answer.upcoming 列出尚未生效的后续版本

archive.explain(answer.answerId); // 之后随时回看当时依据
```

## 运行

需要 Node.js 20 或更高版本，不需要安装第三方依赖。

```sh
npm test
npm run build
node src/pipeline.mjs                              # 采集并汇总
node src/pipeline.mjs --policy returns --at 2026-11-20T10:00:00Z   # 按咨询时间查询
```

测试使用项目内的合成记录；执行不需要网络、凭据或外部服务。
