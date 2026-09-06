// Embedding 行领域类型：sqlite/postgres 两个 repository 实现共享（避免任一实现
// import 对方造成文件环；本文件为纯类型模块，运行时不产生依赖）。
export interface EmbeddingRow {
  productId: string
  contentHash: string
  model: string
  vector: number[]
}
