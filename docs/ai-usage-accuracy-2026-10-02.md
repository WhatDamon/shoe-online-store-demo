# AI 用量精度更新 — 2026-10-02

本轮在不改变预算预占、失败保守记账和单请求幂等边界的前提下，补齐真实聊天 provider 的用量传递。

## 行为

- `OpenAICompatProvider` 默认发送 `stream_options.include_usage=true`，读取最终流 chunk 的 `prompt_tokens` 和 `completion_tokens`。
- 聊天编排把 usage 作为内部流事件传给结算层；只有非负安全整数才会进入 `ai_usage` 和日预算计数。
- provider 不返回 usage、返回非法数字，或通过 `AI_INCLUDE_USAGE=0` 明确关闭时，仍使用原有字符估算。
- provider 已开始后发生失败、超时或取消，仍按 `abandoned` 保守消耗预占；不会为了获取 usage 自动重试第二次请求。

## 验证

新增回归覆盖：兼容流最终 usage 写入精确 token 数、非法 usage 回退估算、既有取消/超时/失败结算。相关 AI 测试共 **41 项通过**；完整 `npm run verify` 需继续作为交付门禁。

## 限制

精确 usage 依赖网关实现 OpenAI streaming usage 扩展；不兼容网关应设置 `AI_INCLUDE_USAGE=0`，并接受估算账本。embedding 调用仍不纳入聊天预算，护栏和 Session 仍是单实例有界状态。`ai_usage` 是成本估算/核对记录，不是第三方账单证明。
