export const MAX_MESSAGE_CHARS = Number(process.env.AI_MAX_MESSAGE_CHARS ?? 800)
export const MAX_OUTPUT_TOKENS = Number(process.env.AI_MAX_OUTPUT_TOKENS ?? 500)
export const estTokens = (s: string) => Math.ceil(s.length / 4)
export const truncateMessage = (s: string) =>
  s.length > MAX_MESSAGE_CHARS ? s.slice(0, MAX_MESSAGE_CHARS) : s
