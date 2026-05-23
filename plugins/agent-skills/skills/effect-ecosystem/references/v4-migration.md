# Reference: Effect v4 (codename "smol") — 迁移与变化

Effect v4 已于 2026 年 2 月进入 beta。本文记录 v3 → v4 的关键变化、迁移策略、和当前的兼容矩阵。

## 1. 核心信息

- **代号**：`smol`（仓库 `Effect-TS/effect-smol`）。
- **状态**：beta，核心稳定，`effect/unstable/*` 模块允许 breaking change。
- **维护策略**：v3 继续 bug fix / 安全补丁，但**新功能只进 v4**（feature freeze on v3）。
- **官方文档**：https://effect-ts-effect-smol-1.mintlify.app/

## 2. 不变的部分

**核心心智模型完全保留**：`Effect`、`Layer`、`Schema`、`Stream`、`Cause`、`Scope`、`Fiber`、Generator 写法、Tagged Error / Service Tag、Schedule —— 全部不动。已有的 Effect 项目，业务代码几乎 1:1 迁移。

## 3. 关键变化

### 3.1 Fiber Runtime 重写

- 更低内存占用、更快执行、更简单内部结构。
- 业务代码不感知，自动提速。

### 3.2 Bundle Size 大幅缩减

- 包含 Effect + Stream + Schema 的最小程序：v3 约 70KB → v4 约 20KB。
- 极限 tree-shaking 下 ~6.3KB (min+gzip)。
- 直接回应了 Effect 在前端使用的最大顾虑。

### 3.3 统一版本号

- v3 中 `effect@3.x.y` / `@effect/platform@0.a.b` / `@effect/sql@0.c.d` 各自独立版本，经常对不上号。
- v4 后**所有生态包共享同一版本号**：`effect@4.0.0-beta.0` 必然配对 `@effect/sql-pg@4.0.0-beta.0`，依赖管理质变简化。

### 3.4 包合并 / 重组

- `@effect/platform`、`@effect/rpc`、`@effect/cluster` 的核心**合并进 `effect` 主包**。
- 仅 provider-specific / platform-specific 实现（SQL 驱动、AI provider、`@effect/platform-node` 等）保持独立包。
- 这意味着 v4 项目可能直接 `import { HttpClient } from "effect"`（具体 export 路径以 migration guide 为准）。

### 3.5 API 重命名 / 行为变化

- `Schema` 模块路径调整。
- Service 定义偏好 class-based `Context.Tag` 模式更彻底。
- `Generator` yieldable 语义统一。
- Layer 组合算子部分重命名（详见 https://github.com/Effect-TS/effect-smol/blob/main/MIGRATION.md）。

### 3.6 迁移工具

- 官方在开发 codemod、AI 辅助 migration skills（与本 skill 形态类似）。
- 团队优先发布 beta，工具随后到位。
- Sandro Maglione 等早期迁移者报告 worker bundle 从 900KB 降到 779KB，但提醒大型项目用 AI 辅助迁移容易"在仓库和 API 间走神"。

## 4. 当前是否要迁移？

| 项目阶段 | 建议 |
|---|---|
| 新建项目 (greenfield) | 优先 v4 beta（核心稳定），享受 bundle / 性能收益。 |
| 生产 v3 项目 | 等 v4 稳定 + codemod 成熟再迁。**保持 v3 但禁止引入 v3-only 新模块**（避免迁移负债）。 |
| 库 / SDK 作者 | 双轨发布或紧跟 v4 beta，依赖 peerDependencies 表达版本约束。 |
| 受限运行时（Convex 等） | 早期 v4 有 globals 兼容问题（已修复，但确认目标环境支持）。 |

## 5. 迁移步骤模板

```
1. 用 effect v4 + 全部生态包同版本号 freeze 一个分支。
2. 跑现有测试套件（@effect/vitest），按报错 fix。
   - 90% 是 import 路径调整 / Schema API 重命名。
3. 检查 Layer 类型签名是否需要调整。
4. 检查所有 @effect/platform / @effect/rpc 的 import 是否改为 effect 主包。
5. 检查 bundle size 收益验证升级价值。
6. 灰度发布。
```

## 6. v3 / v4 双写策略（库 / 共享代码）

- 业务逻辑只用核心 API（`Effect.gen`、`yield*`、`Effect.map/flatMap`、`Layer.*`、`Schema.*`）—— 这些跨版本兼容。
- 涉及 platform / rpc / sql / ai 等周边包时，通过抽象自家 Service 隔离版本细节。

## 7. 与本 skill 的关系

- 本 skill 的所有规则在 v3 / v4 都有效。
- API 示例以 v3 为主（生态成熟），v4 等价 API 通过对照 migration guide 即可。
- 检测到代码同时混用 v3 和 v4 包时，**立即报警并要求统一**。

## 8. 资源

- [Effect v4 Beta 公告](https://effect.website/blog/releases/effect/40-beta/)
- [InfoQ 报道](https://www.infoq.com/news/2026/04/effect-v4-beta/)
- [官方 migration guide (effect-smol)](https://github.com/Effect-TS/effect-smol/blob/main/MIGRATION.md)
- [v4 文档站](https://effect-ts-effect-smol-1.mintlify.app/)
- [Sandro Maglione 实战迁移记录](https://www.sandromaglione.com/newsletter/my-effect-v4-beta-migrations)
