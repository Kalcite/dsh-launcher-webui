/**
 * dsh-launcher 用量分析模块（server/usage.mjs）
 * - 扫描 DSH_HOME/sessions 下的会话日志（zstd 多帧解压）
 * - 解析 usage 事件（input/output/cache tokens），按模型 / 日 / 小时 / 会话聚合
 * - 计费：多模型单价表 + 峰谷时段 + 周末规则（全部可配置，默认 DeepSeek 官方定价）
 */
import { zstdDecompress } from "node:zlib";
import { promisify } from "node:util";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync
} from "node:fs";
import os from "node:os";
import path from "node:path";

const zstdDecompressAsync = promisify(zstdDecompress);
const ZSTD_MAGIC = 0xfd2fb528;

// 默认单价（元 / 百万 token）与峰谷规则，取自 DeepSeek 官方文档：
// https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
// 高峰时段 9:00-12:00、14:00-18:00（北京时间）；空闲 = 高峰 × 0.5。
// 2026-08-23（周日）00:00 起：周末（周六/日）全天按空闲价；
// 该日期之前周末仍区分峰谷时段。周末规则与价格可能随官方调整，页面可全部自定义。
// 模型单价 = 表格「高峰时段」列（缓存写入按输入未命中价计）：
//   deepseek-v4-flash            输入 3.0 / 输出 9.0   / 缓存命中 0.1
//   deepseek-v4-pro              输入 9.0 / 输出 27.0  / 缓存命中 0.3
//   deepseek-v4-flash-vision-exp 输入 3.0 / 输出 9.0   / 缓存命中 0.1
const DEFAULT_PRICING = {
  offPeakMultiplier: 0.5,          // 空闲 = 高峰 × 0.5
  peakSlots: [                     // 高峰时段（北京时间小时）
    { start: 9, end: 12 },
    { start: 14, end: 18 }
  ],
  weekendFlat: true,               // 周末（周六/日）全天按空闲价
  weekendFlatStart: "2026-08-23",  // 该日期（00:00 北京时间）起生效；留空 = 始终生效
  models: {
    "deepseek-v4-flash": { inputPerM: 3, outputPerM: 9, cacheReadPerM: 0.1, cacheWritePerM: 3 },
    "deepseek-v4-pro": { inputPerM: 9, outputPerM: 27, cacheReadPerM: 0.3, cacheWritePerM: 9 },
    "deepseek-v4-flash-vision-exp": { inputPerM: 3, outputPerM: 9, cacheReadPerM: 0.1, cacheWritePerM: 3 },
    "_default": { inputPerM: 3, outputPerM: 9, cacheReadPerM: 0.1, cacheWritePerM: 3 }
  }
};

/** 深度合并用户配置（兼容旧版扁平单价字段 → _default） */
export function mergePricing(overrides) {
  const p = structuredClone(DEFAULT_PRICING);
  if (!overrides) return p;
  for (const k of ["offPeakMultiplier", "peakSlots", "weekendFlat", "weekendFlatStart"]) {
    if (overrides[k] !== undefined) p[k] = overrides[k];
  }
  if (overrides.models && typeof overrides.models === "object") {
    p.models = { ...p.models, ...overrides.models };
  }
  // 兼容旧版扁平字段（写在 pricing 顶层的 inputPerM 等 → _default）
  if (overrides.inputPerM !== undefined || overrides.outputPerM !== undefined) {
    p.models._default = {
      inputPerM: overrides.inputPerM ?? p.models._default.inputPerM,
      outputPerM: overrides.outputPerM ?? p.models._default.outputPerM,
      cacheReadPerM: overrides.cacheReadPerM ?? p.models._default.cacheReadPerM,
      cacheWritePerM: overrides.cacheWritePerM ?? p.models._default.cacheWritePerM
    };
  }
  return p;
}

/* ------------------------------ zstd 多帧解压（移植自 dsh 的 scanZstdFrames） ------------------------------ */

function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) return { frames };
    offset += 4;
    if (offset === buffer.length) return { frames };
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 0x18) !== 0) return { frames };
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 0x20) !== 0;
    const checksum = (descriptor & 0x04) !== 0;
    const dictionaryFlag = descriptor & 0x03;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) return { frames };
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return { frames };
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 0x03;
      const blockSize = blockHeader >>> 3;
      if (blockType === 0x03) return { frames };
      const payloadBytes = blockType === 0x01 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return { frames };
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames };
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return { frames };
}

/** 解压一个会话日志文件（zstd 多帧拼接 或 明文 jsonl） */
async function decompressSessionLog(buf) {
  if (buf.length >= 4 && buf.readUInt32LE(0) === ZSTD_MAGIC) {
    const { frames } = scanZstdFrames(buf);
    const parts = [];
    for (const f of frames) {
      try {
        parts.push(await zstdDecompressAsync(buf.subarray(f.start, f.end)));
      } catch { /* 坏帧跳过 */ }
    }
    return Buffer.concat(parts).toString("utf8");
  }
  return buf.toString("utf8");
}

/* ------------------------------ 解析 ------------------------------ */

/**
 * usage 记账两种载体（dsh 0.1.3-alpha.1 起并存，按会话取最高版本文件读取）：
 * - v0 流式日志 `session.jsonl.zstd`：assistant/chunk 行 `data.chunk.usage`（chunk.type === "usage"）
 * - v2 持久日志 `session.v2.jsonl.zstd`：assistant/message 行 `data.usage`（同 token 字段）
 */
function parseUsageLine(line) {
  let j;
  try { j = JSON.parse(line); } catch { return null; }
  let u = null;
  const chunk = j?.data?.chunk ?? j?.chunk;
  if (chunk && chunk.type === "usage" && chunk.usage) u = chunk.usage; // v0 流式
  else if (j?.data?.usage && typeof j.data.usage === "object") u = j.data.usage; // v2 durable
  if (!u) return null;
  const ts = typeof j.time === "number" ? j.time : typeof j.ts === "number" ? j.ts : null;
  return {
    ts,
    input: u.inputTokens ?? 0,
    output: u.outputTokens ?? 0,
    cacheRead: u.cacheReadTokens ?? 0,
    cacheWrite: u.cacheWriteTokens ?? 0
  };
}

/** 从 request/header 行提取模型名（usage 事件归属最近一次出现的模型） */
function parseModel(line) {
  try {
    const j = JSON.parse(line);
    if (j?.type === "request/header" && j?.data?.header?.config?.model) {
      return j.data.header.config.model;
    }
  } catch { /* 忽略 */ }
  return null;
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 会话日志文件名 → 格式版本：session.jsonl.zstd = 0；session.v2.jsonl.zstd = 2；非日志名返回 null */
function sessionLogVersion(name) {
  const m = /^session(?:\.v(\d+))?\.jsonl(?:\.zstd)?$/.exec(name);
  if (!m) return null;
  return m[1] ? Number(m[1]) : 0;
}

/**
 * 会话目录内挑选要读取的日志：取版本最高者（v2 覆盖 v0/v1，迁移 tmp / 生成计数文件一律忽略）。
 * 同版本同时存在 .zstd 与明文时优先 .zstd。
 */
function pickSessionLog(dir) {
  let best = null; // { name, version, file }
  for (const name of readdirSync(dir)) {
    const v = sessionLogVersion(name);
    if (v === null) continue;
    const file = path.join(dir, name);
    if (!best || v > best.version || (v === best.version && name.endsWith(".zstd"))) {
      best = { name, version: v, file };
    }
  }
  return best;
}

function walkSessions(home) {
  const root = path.join(home, "sessions");
  const files = [];
  if (!existsSync(root)) return files;
  for (const project of readdirSync(root)) {
    const projectDir = path.join(root, project);
    if (!statSync(projectDir).isDirectory()) continue;
    for (const sid of readdirSync(projectDir)) {
      const sessionDir = path.join(projectDir, sid);
      if (!statSync(sessionDir).isDirectory()) continue;
      const picked = pickSessionLog(sessionDir);
      if (picked) files.push({ file: picked.file, project, sid, version: picked.version });
    }
  }
  return files;
}

/* ------------------------------ 计费规则（前端同构逻辑） ------------------------------ */

function inPeakSlot(hour, pricing) {
  return pricing.peakSlots.some((s) => hour >= s.start && hour < s.end);
}

/** 该日期是否处于「周末全天空闲」生效期 */
function isWeekendFlatDate(date, pricing) {
  if (!pricing.weekendFlat) return false;
  const start = pricing.weekendFlatStart;
  if (!start) return true; // 未配置起始日期 → 始终生效
  return date >= start;    // YYYY-MM-DD 字符串可直接比较
}

/** (日期, 星期, 小时) 是否按高峰价计费 */
function isPeakAt(date, weekday, hour, pricing) {
  if ((weekday === 0 || weekday === 6) && isWeekendFlatDate(date, pricing)) return false;
  return inPeakSlot(hour, pricing);
}

function modelPriceOf(model, pricing) {
  return pricing.models[model] ?? pricing.models._default;
}

/** 单桶费用（按模型单价 × 峰谷系数） */
function costOfBucket(b, pricing) {
  const mult = isPeakAt(b.date, b.weekday, b.hour, pricing) ? 1 : pricing.offPeakMultiplier;
  let cost = 0;
  for (const [model, t] of Object.entries(b.models)) {
    const pr = modelPriceOf(model, pricing);
    cost += (t.input * pr.inputPerM + t.output * pr.outputPerM +
      t.cacheRead * pr.cacheReadPerM + t.cacheWrite * pr.cacheWritePerM) / 1e6 * mult;
  }
  return cost;
}

/* ------------------------------ 聚合工具 ------------------------------ */

function newTot() { return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }; }
function addTot(dst, u) {
  dst.input += u.input; dst.output += u.output;
  dst.cacheRead += u.cacheRead; dst.cacheWrite += u.cacheWrite;
}
function totOf(map, key) {
  let t = map.get(key);
  if (!t) { t = newTot(); map.set(key, t); }
  return t;
}
function bucketOf(map, key, date, weekday, hour) {
  let b = map.get(key);
  if (!b) { b = { date, weekday, hour, ...newTot(), models: new Map() }; map.set(key, b); }
  return b;
}
const byDateHourSort = (a, b) => (a.date === b.date ? a.hour - b.hour : (a.date < b.date ? -1 : 1));

/* ------------------------------ 用量总览 ------------------------------ */

/**
 * 聚合：
 * - byDayHour：日期 × 小时 × 模型（计费基准，支持周末规则按日期生效 + 多模型单价）
 * - byModel / byDay / byHour / byHourWeek（可视化）
 * - bySession：会话级（含自己的 dayHour，供会话钻取实时计费）
 */
export async function usageOverview(cfg) {
  const home = cfg.dshHome ?? path.join(os.homedir(), ".dsh");
  const pricing = mergePricing(cfg.pricing);

  const byDay = new Map();
  const byHour = Array.from({ length: 24 }, () => newTot());
  const byHourWeek = Array.from({ length: 168 }, () => newTot());
  const byDayHour = new Map();
  const byModel = new Map();
  const bySession = new Map();
  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0, sessions = 0;

  for (const { file, project, sid } of walkSessions(home)) {
    try {
      const text = await decompressSessionLog(readFileSync(file));
      const sTot = newTot();
      const sDayHour = new Map();
      const models = new Set();
      let currentModel = null, firstTs = null, lastTs = null, events = 0;
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const m = parseModel(line);
        if (m) currentModel = m;
        const u = parseUsageLine(line);
        if (!u) continue;
        events++;
        const model = currentModel ?? "unknown";
        input += u.input; output += u.output; cacheRead += u.cacheRead; cacheWrite += u.cacheWrite;
        addTot(sTot, u);
        addTot(totOf(byModel, model), u);
        models.add(model);
        if (u.ts) {
          if (firstTs === null || u.ts < firstTs) firstTs = u.ts;
          if (lastTs === null || u.ts > lastTs) lastTs = u.ts;
          const dt = new Date(u.ts);
          const date = dayKey(u.ts);
          addTot(totOf(byDay, date), u);
          addTot(byHour[dt.getHours()], u);
          addTot(byHourWeek[dt.getDay() * 24 + dt.getHours()], u);
          const gb = bucketOf(byDayHour, `${date}|${dt.getHours()}`, date, dt.getDay(), dt.getHours());
          addTot(gb, u);
          addTot(totOf(gb.models, model), u);
          const sb = bucketOf(sDayHour, `${date}|${dt.getHours()}`, date, dt.getDay(), dt.getHours());
          addTot(sb, u);
          addTot(totOf(sb.models, model), u);
        }
      }
      if (sTot.input || sTot.output) {
        sessions++;
        const sBuckets = [...sDayHour.values()]
          .map((b) => ({ ...b, models: Object.fromEntries(b.models) }))
          .sort(byDateHourSort);
        bySession.set(sid, {
          id: sid,
          project,
          models: [...models],
          input: sTot.input,
          output: sTot.output,
          cacheRead: sTot.cacheRead,
          cacheWrite: sTot.cacheWrite,
          events,
          firstTs,
          updatedAt: lastTs,
          dayHour: sBuckets,
          cost: sBuckets.reduce((s, b) => s + costOfBucket(b, pricing), 0)
        });
      }
    } catch { /* 单文件损坏跳过 */ }
  }

  const byDateHour = [...byDayHour.values()]
    .map((b) => ({ ...b, models: Object.fromEntries(b.models) }))
    .sort(byDateHourSort);

  // 按模型费用（逐桶 × 峰谷系数）
  const modelCosts = new Map();
  for (const b of byDateHour) {
    const mult = isPeakAt(b.date, b.weekday, b.hour, pricing) ? 1 : pricing.offPeakMultiplier;
    for (const [model, t] of Object.entries(b.models)) {
      const pr = modelPriceOf(model, pricing);
      const c = (t.input * pr.inputPerM + t.output * pr.outputPerM +
        t.cacheRead * pr.cacheReadPerM + t.cacheWrite * pr.cacheWritePerM) / 1e6 * mult;
      modelCosts.set(model, (modelCosts.get(model) ?? 0) + c);
    }
  }

  const cost = byDateHour.reduce((s, b) => s + costOfBucket(b, pricing), 0);
  const days = [...byDay.entries()].map(([date, v]) => {
    const dayCost = byDateHour
      .filter((b) => b.date === date)
      .reduce((s, b) => s + costOfBucket(b, pricing), 0);
    return { date, ...v, cost: dayCost };
  }).sort((a, b) => (a.date < b.date ? -1 : 1));
  const hours = byHour.map((v, hour) => ({ hour, ...v, cost: 0 }));
  const hourWeek = byHourWeek
    .map((v, i) => ({ weekday: Math.floor(i / 24), hour: i % 24, ...v }))
    .filter((b) => b.input || b.output || b.cacheRead || b.cacheWrite);

  return {
    home,
    pricing,
    totals: { input, output, cacheRead, cacheWrite, cost, sessions, activeDays: days.length },
    byModel: [...byModel.entries()]
      .map(([model, t]) => ({ model, ...t, cost: modelCosts.get(model) ?? 0 }))
      .sort((a, b) => a.model.localeCompare(b.model)),
    byDay: days,
    byHour: hours,
    byHourWeek: hourWeek,
    byDayHour: byDateHour,
    bySession: [...bySession.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  };
}
