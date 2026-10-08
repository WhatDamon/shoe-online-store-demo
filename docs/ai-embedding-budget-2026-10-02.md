# AI embedding 预算边界 — 2026-10-02

本轮把聊天检索中的 embedding 网络调用纳入现有原子日预算。聊天 provider 和 embedding 使用不同的 reservation，避免检索在 provider 预占之前绕过预算，也避免把两类模型的账混成一次请求。

## 行为

- 能力探测、查询 embedding、缺失商品的批量 embedding 都经过同一个按请求注入的预算包装器。
- 每次网络调用在发出前按输入字符数估算 token 并原子预占；成功后以该估算写入 `ai_usage`（embedding 模型名、completion 为 0）。
- 非 2xx、超时、网络错误或解析失败按 `abandoned` 保守计入预占，不自动重试；检索随后按既有规则降级关键词。
- embedding 预算耗尽时，检索不会调用 provider，聊天返回稳定的 `budget` 拒答。
- 缓存命中不会发商品批量 embedding；每次语义查询仍需一次查询向量调用。

## 验证

- 新增聊天预算回归：查询与商品批量 embedding 各自产生 reservation，结算后没有遗留 reserved token。
- `npm run typecheck` 通过；AI、检索和聊天预算定向测试通过。
- 完整 `npm run verify`、生产构建和 Python 门禁需作为本轮交付门禁继续执行。

## 限制

embedding provider 没有统一返回 usage 的合同，因此账本使用输入字符估算；这属于日预算和成本核对，不是第三方账单证明。预算、限流和 Session 仍是单实例有界状态，多实例部署前仍需容量与共享状态证据。
