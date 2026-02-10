---
name: handoff
description: 执行 Session Handoff，为下一个 session 做好交接准备
---

将本次 session 中代码不编码的知识写入 `.claude/HANDOFF.md`。

代码和 git history 自动持久化，CLAUDE.md 记录结构性知识，MEMORY.md 记录经验教训。handoff 只保存它们都不覆盖的增量：

1. **意图轨迹** — 做了什么决定、为什么、拒绝了什么替代方案
2. **未完成态** — 什么 pending、卡在哪、下一步是什么

## 执行

1. 回顾本次 session 的对话，提取意图轨迹和未完成态
2. 读取当前 `.claude/HANDOFF.md`
3. 更新 HANDOFF.md：当前 session 写在最前面，之前的 session 压缩合并
4. 如果本次 session 有值得跨 session 复用的教训，更新 MEMORY.md

不要：更新 CLAUDE.md、整理 specs、创建 commit — 如果需要，用户会单独要求。
