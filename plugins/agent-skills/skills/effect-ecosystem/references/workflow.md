# Reference: `@effect/workflow` and `@effect/cluster`

`@effect/workflow` belongs at the durable orchestration boundary: long-running
business processes, resumable activities, timers, retries, compensation, and
stateful execution history. It is not a replacement for ordinary `Effect.gen`
program structure inside a request handler.

`@effect/cluster` belongs at the distributed runtime boundary: sharding,
entity-style distribution, worker placement, and node-to-node execution
concerns. It is not a substitute for local service composition with `Layer`.

## Boundary Rules

- Use `@effect/workflow` when the business process must survive process restart,
  network failure, delayed callbacks, or human wait states.
- Use `@effect/cluster` when the runtime topology is part of the problem:
  distributed workers, sharded state, or location-transparent services.
- Keep domain algebra independent from the runner. Workflow definitions should
  call domain services; domain services should not know which workflow backend
  executes them.
- Keep ordinary request/response code on `Effect`, `Layer`, `HttpApi`, `Rpc`,
  and `Schedule`. Do not introduce workflow just because code has multiple
  steps.

## Scanner Contract

Scanner v1 does not enforce workflow shape. Scanner v2 may add a deterministic
package-presence rule only after this prose contract exists:

- `shape: ["workflow"]` requires `@effect/workflow`.
- Workflow suitability remains an agent judgment against this document and
  `SKILL.md`; scanner only proves dependency presence or absence.
