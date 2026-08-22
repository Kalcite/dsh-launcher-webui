/**
 * dsh-launcher 用量分析模块（server/usage.mjs）
 * - 扫描 DSH_HOME/sessions 下的会话日志（zstd 多帧解压）
 * - 解析 usage 事件（input/output/cache tokens），按日/会话/项目聚合
 * - 计费：单价表（元/百万 token，可配置），默认 deepseek 定价
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

// 默认单价与峰谷规则（元 / 百万 token，DeepSeek 官方文档，可被 config.json pricing 覆盖）：
// https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
// 官方：高峰时段 9:00-12:00、14:00-18:00（北京时间）；空闲 = 高峰 × 0.5；
//       2026-08-23 起周末（周六/日）全天按空闲价。
// 以下默认值为文档表格中 deepseek-v4-flash 对应列（0.05/1.5/4.5 组合的高峰价）。
const DEFAULT_PRICING = {
  inputPerM: 3,          // 高峰：输入（缓存未命中）
  outputPerM: 9,         // 高峰：输出
  cacheReadPerM: 0.1,    // 高峰：输入（缓存命中）
  cacheWritePerM: 3,     // 高峰：缓存写入（未命中写入，按输入未命中价）
  offPeakMultiplier: 0.5, // 空闲时段 = 高峰价 × 0.5
  peakSlots: [           // 高峰时段（北京时间小时）
    { start: 9, end: 12 },
    { start: 14, end: 18 }
  ],
  weekendFlat: true      // 周末（周六/日）全天按空闲价
};

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

/* ------------------------------ 解析与聚合 ------------------------------ */

function parseUsageLine(line) {
  let j;
  try { j = JSON.parse(line); } catch { return null; }
  // usage 事件位于 assistant/chunk 行的 data.chunk.usage（或兼容 chunk.usage）
  const chunk = j?.data?.chunk ?? j?.chunk;
  if (!chunk || chunk.type !== "usage" || !chunk.usage) return null;
  const u = chunk.usage;
  const ts = typeof j.time === "number" ? j.time : typeof j.ts === "number" ? j.ts : null;
  return {
    ts,
    input: u.inputTokens ?? 0,
    output: u.outputTokens ?? 0,
    cacheRead: u.cacheReadTokens ?? 0,
    cacheWrite: u.cacheWriteTokens ?? 0
  };
}

/** 从 request/header 行提取模型名 */
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
      for (const name of ["session.jsonl.zstd", "session.jsonl"]) {
        const f = path.join(sessionDir, name);
        if (existsSync(f)) {
          files.push({ file: f, project, sid });
          break;
        }
      }
    }
  }
  return files;
}

/** 用量总览：聚合 byDay / byHour / bySession / totals，含计费（默认单价） */
export async function usageOverview(cfg) {
  const home = cfg.dshHome ?? path.join(os.homedir(), ".dsh");
  const pricing = { ...DEFAULT_PRICING, ...(cfg.pricing ?? {}) };
  const costOf = (u) =>
    (u.input / 1e6) * pricing.inputPerM +
    (u.output / 1e6) * pricing.outputPerM +
    (u.cacheRead / 1e6) * pricing.cacheReadPerM +
    (u.cacheWrite / 1e6) * pricing.cacheWritePerM;

  const byDay = new Map();
  const byHour = Array.from({ length: 24 }, () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }));
  // 按 (星期 × 小时) 聚合：168 桶，weekday=0 周日（JS getDay），支持峰谷/周末实时计费
  const byHourWeek = Array.from({ length: 168 }, () => ({ weekday: 0, hour: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }));
  const bySession = new Map();
  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0, cost = 0, sessions = 0;

  for (const { file, project, sid } of walkSessions(home)) {
    try {
      const text = await decompressSessionLog(readFileSync(file));
      let sessionInput = 0, sessionOutput = 0, sessionCacheRead = 0, sessionCacheWrite = 0;
      let firstTs = null, lastTs = null, events = 0;
      const sessionHourWeek = Array.from({ length: 168 }, () => ({ weekday: 0, hour: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }));
      const models = new Set();
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const m = parseModel(line);
        if (m) models.add(m);
        const u = parseUsageLine(line);
        if (!u) continue;
        events++;
        input += u.input; output += u.output; cacheRead += u.cacheRead; cacheWrite += u.cacheWrite;
        sessionInput += u.input; sessionOutput += u.output; sessionCacheRead += u.cacheRead; sessionCacheWrite += u.cacheWrite;
        if (u.ts) {
          if (firstTs === null || u.ts < firstTs) firstTs = u.ts;
          if (lastTs === null || u.ts > lastTs) lastTs = u.ts;
          const dt = new Date(u.ts);
          const key = dayKey(u.ts);
          const d = byDay.get(key) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
          d.input += u.input; d.output += u.output; d.cacheRead += u.cacheRead; d.cacheWrite += u.cacheWrite;
          byDay.set(key, d);
          const h = dt.getHours();
          byHour[h].input += u.input; byHour[h].output += u.output;
          byHour[h].cacheRead += u.cacheRead; byHour[h].cacheWrite += u.cacheWrite;
          const hw = byHourWeek[dt.getDay() * 24 + h];
          hw.weekday = dt.getDay(); hw.hour = h;
          hw.input += u.input; hw.output += u.output; hw.cacheRead += u.cacheRead; hw.cacheWrite += u.cacheWrite;
          const shw = sessionHourWeek[dt.getDay() * 24 + h];
          shw.weekday = dt.getDay(); shw.hour = h;
          shw.input += u.input; shw.output += u.output; shw.cacheRead += u.cacheRead; shw.cacheWrite += u.cacheWrite;
        }
      }
      if (sessionInput || sessionOutput) {
        sessions++;
        bySession.set(sid, {
          id: sid,
          project,
          models: [...models],
          input: sessionInput,
          output: sessionOutput,
          cacheRead: sessionCacheRead,
          cacheWrite: sessionCacheWrite,
          events,
          firstTs,
          updatedAt: lastTs,
          hourWeek: sessionHourWeek.filter((b) => b.input || b.output || b.cacheRead || b.cacheWrite),
          cost: costOf({ input: sessionInput, output: sessionOutput, cacheRead: sessionCacheRead, cacheWrite: sessionCacheWrite })
        });
      }
    } catch { /* 单文件损坏跳过 */ }
  }

  cost = costOf({ input, output, cacheRead, cacheWrite });
  const days = [...byDay.entries()].map(([date, v]) => ({
    date, ...v, cost: costOf(v)
  })).sort((a, b) => (a.date < b.date ? -1 : 1));
  const hours = byHour.map((v, hour) => ({ hour, ...v, cost: costOf(v) }));
  const hourWeek = byHourWeek.filter((b) => b.input || b.output || b.cacheRead || b.cacheWrite);

  return {
    home,
    pricing,
    totals: { input, output, cacheRead, cacheWrite, cost, sessions, activeDays: days.length },
    byDay: days,
    byHour: hours,
    byHourWeek: hourWeek,
    bySession: [...bySession.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  };
}
