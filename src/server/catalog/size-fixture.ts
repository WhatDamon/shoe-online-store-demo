// 尺码基准（单一事实）：以脚长 mm 为锚，整档 EU 36–48（canonical），unisex/men 基础。
// 行间 mm 步进 ~6.7mm（Paris point），UK = US - 1，JP = 脚长 cm，CN 与 EU 同号。
// 注：无网络环境无法逐一对照 Zappos/REI 权威表；已按上述关系自洽性复核，建议任务 18 门禁时做一次领域抽查。
export const sizeRows = [
  { mm: 233, systems: { EU: 36, US: 5, UK: 4, JP: 23.5, CN: 36 } },
  { mm: 240, systems: { EU: 37, US: 5.5, UK: 4.5, JP: 24, CN: 37 } },
  { mm: 246, systems: { EU: 38, US: 6, UK: 5, JP: 24.5, CN: 38 } },
  { mm: 253, systems: { EU: 39, US: 6.5, UK: 5.5, JP: 25, CN: 39 } },
  { mm: 260, systems: { EU: 40, US: 7, UK: 6, JP: 25.5, CN: 40 } },
  { mm: 266, systems: { EU: 41, US: 8, UK: 7, JP: 26, CN: 41 } },
  { mm: 273, systems: { EU: 42, US: 8.5, UK: 7.5, JP: 26.5, CN: 42 } },
  { mm: 280, systems: { EU: 43, US: 9, UK: 8, JP: 27, CN: 43 } },
  { mm: 286, systems: { EU: 44, US: 9.5, UK: 8.5, JP: 27.5, CN: 44 } },
  { mm: 293, systems: { EU: 45, US: 10.5, UK: 9.5, JP: 28, CN: 45 } },
  { mm: 300, systems: { EU: 46, US: 11, UK: 10, JP: 28.5, CN: 46 } },
  { mm: 306, systems: { EU: 47, US: 12, UK: 11, JP: 29, CN: 47 } },
  { mm: 313, systems: { EU: 48, US: 12.5, UK: 11.5, JP: 29.5, CN: 48 } },
] as const
