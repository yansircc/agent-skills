# Generated Delivery Checklist

Source of truth: `contracts/rules.json`.

- [ ] EFF001 禁用原生 try/catch。改用 Effect.try / Effect.tryPromise 包裹副作用,失败通道用 Data.TaggedError
- [ ] EFF002 禁用 async function。改写为 Effect.gen(function* () { ... }) + yield*
- [ ] EFF003 禁用 async 箭头函数。改写为 Effect.gen + yield*
- [ ] EFF004 禁用 await。Effect 内部用 yield*; 在边界用 Effect.runPromise / NodeRuntime.runMain
- [ ] EFF005 禁用 Promise 静态方法。改用 Effect.all({ concurrency }) / Effect.race / Effect.partition
- [ ] EFF006 禁用 axios。改用 @effect/platform/HttpClient,配合 Schema 化解码
- [ ] EFF007 禁用 zod。改用 effect/Schema (双向 codec)
- [ ] EFF008 禁用 yup。改用 effect/Schema
- [ ] EFF009 禁用 arktype。改用 effect/Schema
- [ ] EFF010 禁用 io-ts。改用 effect/Schema
- [ ] EFF011 禁用 lodash。改用 effect/Array / effect/HashMap / effect/HashSet / effect/Option 等
- [ ] EFF012 禁用 ramda。改用 effect 内置集合与组合子
- [ ] EFF013 禁用 ts-pattern。改用 effect/Match
- [ ] EFF014 禁用 @tanstack/react-query。改用 effect-atom (@effect-atom/atom-react) + Result 状态机
- [ ] EFF015 禁用 zustand。改用 effect-atom (Atom.make)
- [ ] EFF016 禁用 jotai。改用 effect-atom
- [ ] EFF017 禁用 react-hook-form。改用 @lucas-barake/effect-form
- [ ] EFF018 禁用 formik。改用 @lucas-barake/effect-form
- [ ] EFF019 禁用 @tanstack/react-form。改用 @lucas-barake/effect-form
- [ ] EFF020 禁用 node 原生 fs。改用 @effect/platform/FileSystem (Context 注入)
- [ ] EFF021 禁用 node 原生 path。改用 @effect/platform/Path
- [ ] EFF022 禁用 setTimeout。改用 Effect.sleep(Duration 字面量)
- [ ] EFF023 禁用 setInterval。改用 Effect.repeat + Schedule.spaced / Schedule.fixed,配合 Effect.forkScoped
- [ ] EFF024 禁止 new Error。所有领域错误用 Data.TaggedError class 声明
- [ ] EFF025 禁用 throw。失败用 yield* new MyTaggedError({ ... }) 或 Effect.fail
- [ ] EFF026 业务代码禁用 Date.now()。改用 Clock.currentTimeMillis (可测试)
- [ ] EFF027 禁止直读 process.env。改用 Config.string / Config.redacted + Layer 注入
- [ ] EFF028 禁用 node-cron。改用 Schedule.cron("M H D M W") + Effect.repeat
- [ ] EFF029 禁用 trpc。改用 @effect/rpc (Schema 化请求/响应/错误)
- [ ] EFF030 禁用 prisma。改用 @effect/sql-* 适配器 + SqlClient + Migrator
- [ ] EFF031 避免 moment/dayjs/date-fns。改用 effect/DateTime (带时区)
- [ ] EFF032 业务代码避免 new Date()。读时间用 Clock,日历计算用 DateTime;存时间戳用 number/ISO string
