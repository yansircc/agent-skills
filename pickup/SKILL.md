---
name: pickup
description: 快速接手项目，了解当前开发状态
---

从持久化状态重建工作上下文：确定"现在在哪"。

项目是什么（CLAUDE.md）已在 system prompt 自动加载。接下来做什么由用户决定。pickup 只负责中间那一环：当前位置。

## 执行

1. 读取 `.claude/HANDOFF.md` — 上次 session 的意图轨迹和未完成态
2. 运行 `git status` + `git log --oneline -5` — 当前物理状态
3. 输出摘要：上次做到哪了、什么还 pending、工作区是否干净

不要：替用户决定本次目标、主动读 CLAUDE.md（已自动加载）、检查 specs 目录。
