# KPOP 粉丝站 Implementation Plan

> 2026-10-16 修订：原来的账号、后台和抓取计划作废。按修订后的设计做静态前端。

**Goal:** 一组不用登录的静态页面，读 `web/data/db.js`，回答回归、生日和涨跌。

**Architecture:** `web/logic.js` 是纯函数，测试不打开浏览器。`web/ui.js` 只负责把结果画进 HTML。数据文件就是数据库导出。

**Tech Stack:** HTML、CSS、无构建的浏览器脚本、Node 自带的 `node --test`。

**Spec:** `docs/superpowers/specs/2026-10-16-kpop-fan-site-design.md`

## Global Constraints

- 简体中文。主时间北京，副时间韩国，格式 `YYYY-MM-DD HH:MM`。
- 不登录。关注存在 `localStorage` 键 `fan-follows`。
- 待定不进首页和日历的日期列表。关注不足 5 个不补全站。没有开始快照或增量为 0 不进榜。
- 发行页正文里要有中文名、北京时间和出处标签，不能有 iframe 或 YouTube 播放器。

## 文件

- `web/logic.js` — 时间窗、可见性、日历、榜、首页
- `web/ui.js` — 画页面、读写本机关注
- `web/data/db.js` — 示例数据，形状与使用方的库一致
- `web/*.html`、`web/site.css`
- `tests/logic.test.js`

## 任务

1. 写 `logic.js` 和失败测试，跑 `node --test tests/logic.test.js` 到通过。
2. 写页面，用示例数据在 2026-10-16 能看到未来七天、生日和昨天的涨跌。
3. 跑测试，并在浏览器里打开首页、发行页和变化榜。
