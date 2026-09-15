# 0004 — AI 输出永不携带价格

**状态：** 已采纳 · **日期：** 2026-09-04（重构期追记）

## 背景

站点有两种价格：**demo 价带**（`$59–79`，`seed.ts` 中的 `DEMO_PRICES` 轮转，数据层已标注 placeholder）
与**真实店价**（Shopify 商店以店币 ¥ 计价，由 Buy Button 自行呈现）。

AI 导购会在对话里返回商品卡（`productCards` 事件）并生成介绍文案。一个自然的做法是让卡片带上价格，
「看起来更完整」。

## 决策

**AI 的任何输出都不携带价格。** 三层同时约束：

1. **线协议**：`ProductCard` 事件类型**没有** price 字段 —— 不是「不填」，是**类型上不存在**。
2. **prompt**：所有模式的 system prompt 只注入 `title / description / Code / Colors / Available sizes /
Photos / Details`，**注入内容本身不含价格**（`src/server/ai/context.ts` 的 `productContextOf`）。
   模型只能基于注入内容作答，故它无法「知道」价格。
3. **文案**：卡片下的模型文案同样不出现货币符号或金额。

`src/server/ai/context.test.ts` 用一个结构性断言守住这条：对全部 29 款真实商品跑
`toCard` / `digestLines` / `productContextOf`，正则 `/\$\s*\d/` 与 `/\bUSD\b/i` **必须零命中**。

## 后果

#### 正面

- **不会误导**：demo 价带是虚构的，让它出现在对话里等于把占位数据当事实讲给用户。
- **不会自相矛盾**：真实店价由 Buy Button 以店币呈现；AI 再报一个 $ 价会与结账页冲突。
- **永不漂移**：demo 价带改档、商店换币种，AI 层无需改动，因为它根本不参与。
- 便宜：少注入一份数据，少一批需要维护的措辞。

#### 负面 / 需要持续承担

- 对话里不能直接比价，用户必须点进 PDP 看价。这是**刻意的克制**，与「AI 不抢戏」的产品原则一致。
- 新增商品卡字段时必须记得：**不要**顺手把 price 加进 `ProductCard`。`context.test.ts` 的
  正则断言是这道防线的可执行部分，但它只覆盖 context 层，线协议层靠类型（没有该字段，加不进去）。

## 相关

`src/domain/chat-events.ts` 的 `ProductCard` · `src/server/ai/context.ts` ·
`src/server/ai/context.test.ts` · `CONTEXT.md` 的 ChatEvent 一节
