import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3, RefreshCw, Save, Coins, Flame, PieChart, TrendingUp,
  Clock, MoonStar, Sun, Plus, Trash2, CalendarDays, Cpu, RotateCcw
} from "lucide-react";
import { api, type UsagePricing, type ModelPrice, type DayHourBucket, type SessionRow } from "../api";

type UsageData = Awaited<ReturnType<typeof api.usage>>;

function fmtTok(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

function fmtCost(n: number): string {
  return "¥" + n.toFixed(2);
}

function fmtPct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

function fmtDuration(ms: number): string {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m} 分钟`;
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/* ------------------------------ 峰谷计费（前端实时计算，与后端 usage.mjs 同构） ------------------------------ */

const DEFAULT_PRICING: UsagePricing = {
  offPeakMultiplier: 0.5,
  peakSlots: [{ start: 9, end: 12 }, { start: 14, end: 18 }],
  weekendFlat: true,
  weekendFlatStart: "2026-08-23",
  models: {
    "deepseek-v4-flash": { inputPerM: 3, outputPerM: 9, cacheReadPerM: 0.1, cacheWritePerM: 3 },
    "deepseek-v4-pro": { inputPerM: 9, outputPerM: 27, cacheReadPerM: 0.3, cacheWritePerM: 9 },
    "deepseek-v4-flash-vision-exp": { inputPerM: 3, outputPerM: 9, cacheReadPerM: 0.1, cacheWritePerM: 3 },
    "_default": { inputPerM: 3, outputPerM: 9, cacheReadPerM: 0.1, cacheWritePerM: 3 }
  }
};

const MODEL_NAMES: Record<string, string> = {
  "deepseek-v4-flash": "V4 Flash",
  "deepseek-v4-pro": "V4 Pro",
  "deepseek-v4-flash-vision-exp": "V4 Flash Vision",
  "_default": "默认（其他模型）",
  unknown: "未知模型"
};

function modelName(model: string): string {
  return MODEL_NAMES[model] ?? model;
}

function inPeakSlot(hour: number, pricing: UsagePricing): boolean {
  return pricing.peakSlots.some((s) => hour >= s.start && hour < s.end);
}

/** 该日期是否处于「周末全天空闲」生效期 */
function isWeekendFlatDate(date: string, pricing: UsagePricing): boolean {
  if (!pricing.weekendFlat) return false;
  if (!pricing.weekendFlatStart) return true;
  return date >= pricing.weekendFlatStart;
}

/** (日期, 星期, 小时) 是否按高峰价（2026-08-23 前周末仍分峰谷） */
function isPeakAt(date: string, weekday: number, hour: number, pricing: UsagePricing): boolean {
  if ((weekday === 0 || weekday === 6) && isWeekendFlatDate(date, pricing)) return false;
  return inPeakSlot(hour, pricing);
}

function modelPriceOf(model: string, pricing: UsagePricing): ModelPrice {
  return pricing.models[model] ?? pricing.models._default;
}

/** 单桶费用（按模型单价 × 峰谷系数） */
function bucketCost(b: DayHourBucket, pricing: UsagePricing): number {
  const mult = isPeakAt(b.date, b.weekday, b.hour, pricing) ? 1 : pricing.offPeakMultiplier;
  let cost = 0;
  for (const [model, t] of Object.entries(b.models)) {
    const pr = modelPriceOf(model, pricing);
    cost += (t.input * pr.inputPerM + t.output * pr.outputPerM +
      t.cacheRead * pr.cacheReadPerM + t.cacheWrite * pr.cacheWritePerM) / 1e6 * mult;
  }
  return cost;
}

function bucketTokens(b: DayHourBucket): number {
  return b.input + b.output + b.cacheRead + b.cacheWrite;
}

const PIE_COLORS = {
  cacheRead: "var(--accent)",
  input: "var(--warn)",
  output: "var(--ok)",
  cacheWrite: "var(--err)"
};

const MODEL_COLORS = ["var(--accent)", "var(--accent-2)", "var(--ok)", "var(--warn)", "var(--err)", "#22d3ee"];

/** Token 构成饼图（conic-gradient），通用：可传总量或单会话 */
function CompositionPie({ input, output, cacheRead, cacheWrite, pricing }: {
  input: number; output: number; cacheRead: number; cacheWrite: number; pricing: UsagePricing;
}) {
  const segs = useMemo(() => {
    const items = [
      { key: "cacheRead", label: "缓存命中输入", v: cacheRead },
      { key: "input", label: "输入（缓存未命中）", v: input },
      { key: "output", label: "输出", v: output },
      { key: "cacheWrite", label: "缓存写入", v: cacheWrite }
    ];
    const total = items.reduce((s, i) => s + i.v, 0) || 1;
    let acc = 0;
    const priceOf = (key: string) =>
      key === "input" ? pricing.models._default.inputPerM : key === "output" ? pricing.models._default.outputPerM : key === "cacheRead" ? pricing.models._default.cacheReadPerM : pricing.models._default.cacheWritePerM;
    const out = items.filter((i) => i.v > 0).map((i) => {
      const start = (acc / total) * 100;
      acc += i.v;
      const end = (acc / total) * 100;
      return { ...i, start, end, pct: i.v / total, price: priceOf(i.key) };
    });
    return { out, total };
  }, [input, output, cacheRead, cacheWrite, pricing]);

  if (!segs.total) {
    return <div className="pie-empty">暂无数据</div>;
  }
  const stops = segs.out.map((s) => `${PIE_COLORS[s.key as keyof typeof PIE_COLORS]} ${s.start}% ${s.end}%`).join(", ");
  return (
    <div className="pie-wrap">
      <div className="pie" style={{ background: `conic-gradient(${stops})` }}>
        <div className="pie-hole">
          <span className="pie-total">{fmtTok(segs.total)}</span>
          <span className="pie-sub">总 tokens</span>
        </div>
      </div>
      <div className="pie-legend">
        {segs.out.map((s) => (
          <div key={s.key} className="pie-legend-row">
            <span className="pie-dot" style={{ background: PIE_COLORS[s.key as keyof typeof PIE_COLORS] }} />
            <span className="pie-lbl">{s.label}</span>
            <span className="pie-val">{fmtTok(s.v)} · {fmtPct(s.pct)}</span>
            <span className="pie-price">¥{s.price}/M</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 模型构成：各模型 tokens 与费用（显示在图样里） */
function ModelBars({ byModel, modelCost }: {
  byModel: UsageData["byModel"]; modelCost: Map<string, number>;
}) {
  const maxTok = Math.max(1, ...byModel.map((m) => m.input + m.output));
  return (
    <div className="model-bars">
      {byModel.map((m, i) => {
        const cost = modelCost.get(m.model) ?? m.cost ?? 0;
        const w = Math.max(2, ((m.input + m.output) / maxTok) * 100);
        return (
          <div key={m.model} className="mb-row" title={`${modelName(m.model)}\n输入 ${fmtTok(m.input)} · 输出 ${fmtTok(m.output)} · 缓存读 ${fmtTok(m.cacheRead)}\n费用 ${fmtCost(cost)}`}>
            <span className="mb-name">
              <span className="mb-dot" style={{ background: MODEL_COLORS[i % MODEL_COLORS.length] }} />
              {modelName(m.model)}
            </span>
            <div className="mb-track"><div className="mb-bar" style={{ width: `${w}%`, background: MODEL_COLORS[i % MODEL_COLORS.length] }} /></div>
            <span className="mb-tok">{fmtTok(m.input + m.output)}</span>
            <span className="mb-cost">{fmtCost(cost)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** 30 天消耗柱状图（div 柱，tooltip 全量；费用为峰谷实时） */
function DayBars({ days, dayCost }: {
  days: UsageData["byDay"]; dayCost: Map<string, number>;
}) {
  const last30 = days.slice(-30);
  const max = Math.max(1, ...last30.map((d) => d.input + d.output));
  return (
    <div className="bars bars-days">
      {last30.map((d) => {
        const v = d.input + d.output;
        const h = v > 0 ? Math.max(3, (v / max) * 120) : 1;
        return (
          <div key={d.date} className="bar-col" title={`${d.date}\n输入 ${fmtTok(d.input)} · 输出 ${fmtTok(d.output)} · 缓存读 ${fmtTok(d.cacheRead)}\n费用 ${fmtCost(dayCost.get(d.date) ?? d.cost)}`}>
            <div className="bar" style={{ height: h }} />
            <span className="bar-x">{d.date.slice(8)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** 24 小时消耗分布（由 byDayHour 聚合，高峰时段高亮） */
function HourBars({ hourAgg, pricing }: {
  hourAgg: { hour: number; total: number }[]; pricing: UsagePricing;
}) {
  const max = Math.max(1, ...hourAgg.map((h) => h.total));
  return (
    <div className="bars bars-hours">
      {hourAgg.map((h) => {
        const peak = inPeakSlot(h.hour, pricing);
        const hh = h.total > 0 ? Math.max(3, (h.total / max) * 120) : 1;
        return (
          <div key={h.hour} className="bar-col" title={`${String(h.hour).padStart(2, "0")}:00${peak ? " · 高峰时段" : " · 空闲时段"}\n总 ${fmtTok(h.total)}`}>
            <div className={`bar ${peak ? "peak" : ""}`} style={{ height: hh }} />
            <span className="bar-x">{h.hour % 6 === 0 ? h.hour : ""}</span>
          </div>
        );
      })}
    </div>
  );
}

/** 日期 × 小时 消耗热力：按真实日期标注峰谷（2026-08-23 前周末分峰谷，之后周末全天空闲） */
function DayHourHeatmap({ buckets, pricing }: {
  buckets: DayHourBucket[]; pricing: UsagePricing;
}) {
  const { dates, map, max } = useMemo(() => {
    const m = new Map<string, DayHourBucket>();
    let mx = 1;
    for (const b of buckets) {
      m.set(`${b.date}|${b.hour}`, b);
      mx = Math.max(mx, bucketTokens(b));
    }
    const ds = [...new Set(buckets.map((b) => b.date))].sort().slice(-30);
    return { dates: ds, map: m, max: mx };
  }, [buckets]);

  const WK = ["日", "一", "二", "三", "四", "五", "六"];
  return (
    <div className="week-heat">
      <div className="wh-labels wh-labels-day">
        <span className="wh-corner" />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="wh-hlabel">{h % 4 === 0 ? h : ""}</span>
        ))}
      </div>
      {dates.map((date) => {
        const dt = new Date(date + "T00:00:00");
        const wd = dt.getDay();
        const isWk = wd === 0 || wd === 6;
        const flatNow = isWeekendFlatDate(date, pricing);
        return (
          <div key={date} className="wh-row">
            <span className={`wh-wlabel ${isWk ? "wk" : ""}`}>
              {date.slice(5).replace("-", "/")} 周{WK[wd]}
            </span>
            {Array.from({ length: 24 }, (_, h) => {
              const b = map.get(`${date}|${h}`);
              const v = b ? bucketTokens(b) : 0;
              const lvl = v > 0 ? Math.min(4, Math.ceil((v / max) * 4)) : 0;
              const peak = isPeakAt(date, wd, h, pricing);
              return (
                <div
                  key={h}
                  className={`wh-cell l${lvl}${peak ? " peak" : ""}${isWk && flatNow ? " wk" : ""}`}
                  title={b
                    ? `${date} ${String(h).padStart(2, "0")}:00 · 周${WK[wd]}${peak ? " · 高峰" : " · 空闲"}\n输入 ${fmtTok(b.input)} · 输出 ${fmtTok(b.output)} · 缓存读 ${fmtTok(b.cacheRead)} · 费用 ${fmtCost(bucketCost(b, pricing))}`
                    : `${date} ${String(h).padStart(2, "0")}:00`}
                />
              );
            })}
          </div>
        );
      })}
      <div className="heatmap-legend">
        <span>少</span>
        {[0, 1, 2, 3, 4].map((l) => <span key={l} className={`wh-cell l${l}`} />)}
        <span>多</span>
        <span className="wh-legend-note"><Sun size={10} /> 周末全天空闲（{pricing.weekendFlatStart || "始终"} 起）</span>
        <span className="wh-legend-note"><Clock size={10} /> 高峰时段描边</span>
      </div>
    </div>
  );
}

/** GitHub 风格热力图：最近 365 天 */
function Heatmap({ byDay }: { byDay: UsageData["byDay"] }) {
  const cells = useMemo(() => {
    const map = new Map(byDay.map((d) => [d.date, d]));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - 364);
    const totalOf = (d: { input: number; output: number }) => d.input + d.output;
    const values = byDay.map(totalOf).sort((a, b) => a - b);
    const q = (p: number) => values[Math.min(values.length - 1, Math.floor(values.length * p))] || 0;
    const t1 = q(0.25) || 1, t2 = q(0.5) || 1, t3 = q(0.75) || 1;
    const weeks: { date: Date; level: number; info: string }[][] = [];
    let week: { date: Date; level: number; info: string }[] = [];
    for (let i = 0; i < 365; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const day = map.get(key);
      const t = day ? totalOf(day) : 0;
      let level = 0;
      if (t > 0) level = t > t3 ? 4 : t > t2 ? 3 : t > t1 ? 2 : 1;
      const info = day
        ? `${key} · ${fmtTok(day.input)} in / ${fmtTok(day.output)} out · ${fmtCost(day.cost)}`
        : key;
      week.push({ date: d, level, info });
      if (week.length === 7) { weeks.push(week); week = []; }
    }
    if (week.length) weeks.push(week);
    return weeks;
  }, [byDay]);

  const months = useMemo(() => {
    const start = new Date();
    start.setDate(start.getDate() - 364);
    const out: { label: string; col: number }[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      const daysSince = Math.floor((d.getTime() - start.getTime()) / 86400000);
      out.push({ label: `${d.getMonth() + 1}月`, col: Math.floor(daysSince / 7) });
    }
    return out;
  }, []);

  return (
    <div className="heatmap">
      <div className="heatmap-months">
        <span />
        {months.map((m, i) => (
          <span key={i} style={{ gridColumnStart: m.col + 2 }}>{m.label}</span>
        ))}
      </div>
      <div className="heatmap-grid">
        {cells.map((week, wi) => (
          <div key={wi} className="heatmap-col">
            {week.map((c, di) => (
              <div key={di} className={`hm-cell l${c.level}`} title={c.info} />
            ))}
          </div>
        ))}
      </div>
      <div className="heatmap-legend">
        <span>少</span>
        {[0, 1, 2, 3, 4].map((l) => <span key={l} className={`hm-cell l${l}`} />)}
        <span>多</span>
      </div>
    </div>
  );
}

/* ------------------------------ 会话级分析 ------------------------------ */

/** 会话实时费用（按 dayHour 峰谷 + 模型；无数据时回退后端估算） */
function sessionCost(s: SessionRow, pricing: UsagePricing): number {
  if (!s.dayHour?.length) return s.cost ?? 0;
  return s.dayHour.reduce((sum, b) => sum + bucketCost(b, pricing), 0);
}

/** 单个会话详情：构成饼图 + 峰谷账单 + 24h 分布 + 元信息 */
function SessionDetail({ s, pricing }: { s: SessionRow; pricing: UsagePricing }) {
  const bill = useMemo(() => {
    let total = 0, peak = 0, offPeak = 0, allPeak = 0;
    for (const b of s.dayHour ?? []) {
      const c = bucketCost(b, pricing);
      total += c;
      if (isPeakAt(b.date, b.weekday, b.hour, pricing)) peak += c; else offPeak += c;
      for (const [model, t] of Object.entries(b.models)) {
        const pr = modelPriceOf(model, pricing);
        allPeak += (t.input * pr.inputPerM + t.output * pr.outputPerM +
          t.cacheRead * pr.cacheReadPerM + t.cacheWrite * pr.cacheWritePerM) / 1e6;
      }
    }
    return { total, peak, offPeak, savings: allPeak - total };
  }, [s, pricing]);

  const hourAgg = useMemo(() => {
    const out = Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0 }));
    for (const b of s.dayHour ?? []) out[b.hour].total += bucketTokens(b);
    return out;
  }, [s]);
  const max = Math.max(1, ...hourAgg.map((h) => h.total));

  const start = s.firstTs ? new Date(s.firstTs) : null;
  const end = s.updatedAt ? new Date(s.updatedAt) : null;
  const dur = start && end ? Math.max(0, end.getTime() - start.getTime()) : null;

  return (
    <div className="session-detail">
      <div className="sd-grid">
        <CompositionPie input={s.input} output={s.output} cacheRead={s.cacheRead} cacheWrite={s.cacheWrite} pricing={pricing} />
        <div className="sd-right">
          <div className="billing-grid">
            <div className="billing-card peak"><span className="billing-lbl"><Clock size={12} /> 高峰费用</span><span className="billing-val">{fmtCost(bill.peak)}</span></div>
            <div className="billing-card off"><span className="billing-lbl"><MoonStar size={12} /> 空闲费用</span><span className="billing-val">{fmtCost(bill.offPeak)}</span></div>
            <div className="billing-card save"><span className="billing-lbl">合计（峰谷）</span><span className="billing-val">{fmtCost(bill.total)}</span></div>
            <div className="billing-card"><span className="billing-lbl">相对全高峰节省</span><span className="billing-val">{fmtCost(Math.max(0, bill.savings))}</span></div>
          </div>
          <div className="sd-meta">
            <span>模型：{s.models.map((m) => modelName(m)).join(", ") || "—"}</span>
            <span>时长：{dur ? fmtDuration(dur) : "—"}</span>
            <span>时间：{start ? `${fmtTime(start.getTime())} → ${end ? fmtTime(end.getTime()) : "…"}` : "—"}</span>
            <span>usage 事件：{s.events ?? 0} 次</span>
          </div>
        </div>
      </div>
      <div className="bars bars-hours sd-bars">
        {hourAgg.map((h) => (
          <div key={h.hour} className="bar-col" title={`${String(h.hour).padStart(2, "0")}:00${inPeakSlot(h.hour, pricing) ? " · 高峰" : " · 空闲"} · ${fmtTok(h.total)}`}>
            <div className={`bar ${inPeakSlot(h.hour, pricing) ? "peak" : ""}`} style={{ height: h.total > 0 ? Math.max(3, (h.total / max) * 100) : 1 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ 计价编辑器 ------------------------------ */

const PRICE_FIELDS: { key: keyof ModelPrice; label: string }[] = [
  { key: "inputPerM", label: "输入（未命中）" },
  { key: "outputPerM", label: "输出" },
  { key: "cacheReadPerM", label: "输入（缓存命中）" },
  { key: "cacheWritePerM", label: "缓存写入" }
];

function PricingEditor({ pricing, setPricing, data }: {
  pricing: UsagePricing;
  setPricing: (p: UsagePricing) => void;
  data: UsageData | null;
}) {
  const modelKeys = useMemo(() => {
    const set = new Set<string>(Object.keys(pricing.models));
    for (const m of data?.byModel ?? []) set.add(m.model);
    return [...set];
  }, [pricing.models, data]);

  const setModelField = (model: string, key: keyof ModelPrice, v: number) => {
    setPricing({
      ...pricing,
      models: {
        ...pricing.models,
        [model]: { ...(pricing.models[model] ?? pricing.models._default), [key]: v }
      }
    });
  };

  return (
    <div className="price-editor">
      {/* 全局规则 */}
      <div className="slot-editor">
        <span className="slot-label">高峰时段（北京时间，可增删）</span>
        <div className="slot-list">
          {pricing.peakSlots.map((s, i) => (
            <div key={i} className="slot-row">
              <input type="number" min={0} max={23} value={s.start}
                onChange={(e) => {
                  const v = Math.min(23, Math.max(0, Number(e.target.value) || 0));
                  setPricing({ ...pricing, peakSlots: pricing.peakSlots.map((x, j) => (j === i ? { ...x, start: v } : x)) });
                }} />
              <span>—</span>
              <input type="number" min={1} max={24} value={s.end}
                onChange={(e) => {
                  const v = Math.min(24, Math.max(1, Number(e.target.value) || 0));
                  setPricing({ ...pricing, peakSlots: pricing.peakSlots.map((x, j) => (j === i ? { ...x, end: v } : x)) });
                }} />
              <button className="btn btn-ghost btn-xs" onClick={() => setPricing({ ...pricing, peakSlots: pricing.peakSlots.filter((_, j) => j !== i) })}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <button className="btn btn-ghost btn-xs" onClick={() => setPricing({ ...pricing, peakSlots: [...pricing.peakSlots, { start: 9, end: 12 }] })}>
            <Plus size={12} /> 添加时段
          </button>
        </div>
        <label className="set-field slot-mult">
          <span>空闲倍率（高峰 × 系数）</span>
          <input type="number" step="0.05" min={0} max={1} value={pricing.offPeakMultiplier}
            onChange={(e) => setPricing({ ...pricing, offPeakMultiplier: Math.max(0, Number(e.target.value) || 0) })} className="mono" />
        </label>
      </div>

      <div className="slot-editor">
        <label className="slot-toggle">
          <input type="checkbox" checked={pricing.weekendFlat}
            onChange={(e) => setPricing({ ...pricing, weekendFlat: e.target.checked })} />
          <span>周末（周六/日）全天按空闲价</span>
        </label>
        <label className="set-field slot-start">
          <span>生效日期（YYYY-MM-DD，该日期 00:00 起）</span>
          <input type="date" value={pricing.weekendFlatStart}
            onChange={(e) => setPricing({ ...pricing, weekendFlatStart: e.target.value })} className="mono" />
        </label>
        <button className="btn btn-ghost btn-xs" onClick={() => setPricing(structuredClone(DEFAULT_PRICING))} title="恢复 DeepSeek 官方默认计价">
          <RotateCcw size={12} /> 恢复官方默认
        </button>
      </div>

      {/* 模型单价 */}
      <div className="model-prices">
        {modelKeys.map((model) => {
          const pr = pricing.models[model] ?? pricing.models._default;
          const isDefault = model === "_default";
          return (
            <details key={model} className="mp-item" open={!isDefault}>
              <summary>
                <span className="mp-name">
                  <span className="mb-dot" style={{ background: isDefault ? "var(--idle)" : MODEL_COLORS[modelKeys.indexOf(model) % MODEL_COLORS.length] }} />
                  {modelName(model)}
                  <span className="mp-ids">{isDefault ? "兜底（未列出的模型）" : model}</span>
                </span>
                <span className="mp-sum">输入 ¥{pr.inputPerM}/M · 输出 ¥{pr.outputPerM}/M · 缓存 ¥{pr.cacheReadPerM}/M</span>
              </summary>
              <div className="mp-fields">
                {PRICE_FIELDS.map((f) => (
                  <label key={f.key} className="set-field">
                    <span>{f.label}</span>
                    <input type="number" step="0.05" min={0} value={pr[f.key]}
                      onChange={(e) => setModelField(model, f.key, Math.max(0, Number(e.target.value) || 0))} className="mono" />
                  </label>
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------ 页面 ------------------------------ */

export function UsageCard() {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pricing, setPricing] = useState<UsagePricing>(structuredClone(DEFAULT_PRICING));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleSession = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.usage();
      setData(r);
      setPricing(r.pricing);
    } catch (e) {
      setError(String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const savePricing = async () => {
    setError(null);
    try {
      const r = await api.usagePricing(pricing);
      if (r.ok) await load();
    } catch (e) {
      setError(String(e));
    }
  };

  /* 实时账单：按 byDayHour（日期×小时×模型）× 峰谷系数 × 模型单价 */
  const billing = useMemo(() => {
    const buckets = data?.byDayHour ?? [];
    let total = 0, peak = 0, offPeak = 0, allPeak = 0, peakTok = 0, offTok = 0;
    const dayCost = new Map<string, number>();
    const modelCost = new Map<string, number>();
    for (const b of buckets) {
      const c = bucketCost(b, pricing);
      total += c;
      const pk = isPeakAt(b.date, b.weekday, b.hour, pricing);
      dayCost.set(b.date, (dayCost.get(b.date) ?? 0) + c);
      if (pk) { peak += c; peakTok += bucketTokens(b); }
      else { offPeak += c; offTok += bucketTokens(b); }
      for (const [model, t] of Object.entries(b.models)) {
        const pr = modelPriceOf(model, pricing);
        const raw = (t.input * pr.inputPerM + t.output * pr.outputPerM +
          t.cacheRead * pr.cacheReadPerM + t.cacheWrite * pr.cacheWritePerM) / 1e6;
        allPeak += raw;
        modelCost.set(model, (modelCost.get(model) ?? 0) + raw * (pk ? 1 : pricing.offPeakMultiplier));
      }
    }
    return {
      total, peak, offPeak, savings: allPeak - total,
      peakTok, offTok,
      peakShare: peakTok + offTok > 0 ? peakTok / (peakTok + offTok) : 0,
      dayCost, modelCost
    };
  }, [data, pricing]);

  const hourAgg = useMemo(() => {
    const out = Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0 }));
    for (const b of data?.byDayHour ?? []) out[b.hour].total += bucketTokens(b);
    return out;
  }, [data]);

  const t = data?.totals;
  const peakText = pricing.peakSlots.map((s) => `${s.start}:00-${s.end}:00`).join(" / ");

  return (
    <section className="card deploy-card">
      <div className="card-head">
        <div className="card-title">
          <span className="icon-box">
            <BarChart3 size={17} />
          </span>
          <div>
            <h2>用量分析</h2>
            <p className="sub">Token 消耗 · 多模型峰谷计费账单（数据源：{data?.home ?? "…"}）</p>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
          <RefreshCw size={14} /> 刷新
        </button>
      </div>

      {/* 统计卡 */}
      <div className="usage-stats">
        <div className="ustat"><span className="ustat-label"><Coins size={13} /> 总费用（实时峰谷）</span><span className="ustat-value accent">{fmtCost(billing.total)}</span></div>
        <div className="ustat"><span className="ustat-label">输入 tokens</span><span className="ustat-value">{fmtTok(t?.input ?? 0)}</span></div>
        <div className="ustat"><span className="ustat-label">输出 tokens</span><span className="ustat-value">{fmtTok(t?.output ?? 0)}</span></div>
        <div className="ustat"><span className="ustat-label">缓存读取</span><span className="ustat-value">{fmtTok(t?.cacheRead ?? 0)}</span></div>
        <div className="ustat"><span className="ustat-label">会话数</span><span className="ustat-value">{t?.sessions ?? 0}</span></div>
        <div className="ustat"><span className="ustat-label">活跃天数</span><span className="ustat-value">{t?.activeDays ?? 0}</span></div>
      </div>

      {/* 饼图 + 峰谷账单 */}
      <div className="usage-cols">
        <div className="usage-col">
          <h3 className="section-title"><PieChart size={14} /> Token 构成</h3>
          {data ? <CompositionPie input={data.totals.input} output={data.totals.output} cacheRead={data.totals.cacheRead} cacheWrite={data.totals.cacheWrite} pricing={pricing} /> : <p className="hint">加载中…</p>}
        </div>
        <div className="usage-col">
          <h3 className="section-title"><TrendingUp size={14} /> 峰谷账单（随单价/规则实时计算）</h3>
          <div className="billing-grid">
            <div className="billing-card peak">
              <span className="billing-lbl"><Clock size={12} /> 高峰费用</span>
              <span className="billing-val">{fmtCost(billing.peak)}</span>
            </div>
            <div className="billing-card off">
              <span className="billing-lbl"><MoonStar size={12} /> 空闲费用</span>
              <span className="billing-val">{fmtCost(billing.offPeak)}</span>
            </div>
            <div className="billing-card save">
              <span className="billing-lbl">相对全高峰节省</span>
              <span className="billing-val">{fmtCost(Math.max(0, billing.savings))}</span>
            </div>
            <div className="billing-card">
              <span className="billing-lbl">高峰 token 占比</span>
              <span className="billing-val">{fmtPct(billing.peakShare)}</span>
            </div>
          </div>
          <p className="billing-note">
            <Sun size={11} /> 高峰：{peakText}（北京）· 空闲 = 高峰 × {pricing.offPeakMultiplier}
            {pricing.weekendFlat
              ? (pricing.weekendFlatStart
                ? ` · 周末全天空闲（${pricing.weekendFlatStart} 起，此前周末仍分峰谷）`
                : " · 周末全天空闲")
              : " · 周末区分峰谷"}
          </p>
        </div>
      </div>

      {/* 模型构成 */}
      <h3 className="section-title" style={{ marginTop: 16 }}>
        <Cpu size={14} /> 模型构成（各模型 tokens 与费用，多模型分别计价）
      </h3>
      {data && data.byModel.length > 0
        ? <ModelBars byModel={data.byModel} modelCost={billing.modelCost} />
        : <p className="hint">加载中…</p>}

      {/* 30 天柱状图 */}
      <h3 className="section-title" style={{ marginTop: 16 }}>最近 30 天消耗（输入 + 输出）</h3>
      {data ? <DayBars days={data.byDay} dayCost={billing.dayCost} /> : <p className="hint">加载中…</p>}

      {/* 24 小时分布 */}
      <h3 className="section-title" style={{ marginTop: 16 }}>24 小时消耗分布（高峰时段高亮）</h3>
      {data ? <HourBars hourAgg={hourAgg} pricing={pricing} /> : <p className="hint">加载中…</p>}

      {/* 日期 × 小时热力 */}
      <h3 className="section-title" style={{ marginTop: 16 }}>
        <CalendarDays size={14} /> 日期 × 小时 消耗热力（按真实日期标注峰谷）
      </h3>
      {data ? <DayHourHeatmap buckets={data.byDayHour} pricing={pricing} /> : <p className="hint">加载中…</p>}

      {/* 计费单价编辑器 */}
      <h3 className="section-title" style={{ marginTop: 16 }}>计费单价与峰谷规则（元 / 百万 token，可自定义）</h3>
      <PricingEditor pricing={pricing} setPricing={setPricing} data={data} />
      <div className="pricing-actions">
        <button className="btn btn-primary btn-sm" onClick={savePricing}>
          <Save size={14} /> 保存计价
        </button>
        <span className="hint">
          默认值取自 DeepSeek 官方定价文档（V4 Flash / Pro / Flash Vision），修改后账单实时重算；保存后写入 config.json。
          官方周末全天空闲规则自 2026-08-23 起生效，页面按日期精确计费（此前周末仍分峰谷）。
        </span>
      </div>

      {/* 热力图 */}
      <h3 className="section-title" style={{ marginTop: 16 }}>Token 消耗热力图（近 365 天）</h3>
      {data ? <Heatmap byDay={data.byDay} /> : <p className="hint">加载中…</p>}

      {/* 按日明细 */}
      <h3 className="section-title" style={{ marginTop: 16 }}>最近 30 天明细（费用为峰谷实时计算）</h3>
      <div className="usage-table">
        <div className="ut-head"><span>日期</span><span>输入</span><span>输出</span><span>缓存读</span><span>费用</span></div>
        {data?.byDay.slice(-30).reverse().map((d) => {
          const c = billing.dayCost.get(d.date) ?? d.cost;
          return (
            <div key={d.date} className="ut-row">
              <span>{d.date}</span>
              <span>{fmtTok(d.input)}</span>
              <span>{fmtTok(d.output)}</span>
              <span>{fmtTok(d.cacheRead)}</span>
              <span className={c > 5 ? "warn" : ""}>{fmtCost(c)}</span>
            </div>
          );
        })}
      </div>

      {/* 按会话 */}
      <h3 className="section-title" style={{ marginTop: 16 }}>会话分析（点「分析」查看单会话详情）</h3>
      {data && data.bySession.length > 0 && (
        <div className="session-compare">
          {data.bySession.map((s) => {
            const c = sessionCost(s, pricing);
            const maxC = Math.max(0.01, ...data.bySession.map((x) => sessionCost(x, pricing)));
            return (
              <div key={s.id} className="sc-row" title={`${s.project} · ${s.id.slice(0, 8)} · 实时费用 ${fmtCost(c)}`}>
                <span className="sc-lbl">{s.project} · {s.id.slice(0, 8)}</span>
                <div className="sc-track"><div className={`sc-bar${c > maxC * 0.6 ? " hot" : ""}`} style={{ width: `${Math.max(1.5, (c / maxC) * 100)}%` }} /></div>
                <span className="sc-val">{fmtCost(c)}</span>
              </div>
            );
          })}
        </div>
      )}
      <div className="usage-table">
        <div className="ut-head ut-head-session"><span>项目 / 会话</span><span>模型</span><span>输入</span><span>输出</span><span>缓存读</span><span>费用（峰谷）</span><span /></div>
        {data?.bySession.map((s) => {
          const open = expanded.has(s.id);
          const c = sessionCost(s, pricing);
          return (
            <div key={s.id}>
              <div className="ut-row ut-row-session">
                <span title={s.id}>{s.project} · {s.id.slice(0, 8)}</span>
                <span>{s.models.map((m) => modelName(m)).join(", ") || "—"}</span>
                <span>{fmtTok(s.input)}</span>
                <span>{fmtTok(s.output)}</span>
                <span>{fmtTok(s.cacheRead)}</span>
                <span className={c > 5 ? "warn" : ""}>{fmtCost(c)}</span>
                <span>
                  <button className="btn btn-ghost btn-xs" onClick={() => toggleSession(s.id)}>
                    {open ? "收起" : "分析"}
                  </button>
                </span>
              </div>
              {open && <SessionDetail s={s} pricing={pricing} />}
            </div>
          );
        })}
      </div>

      {error && <div className="error-banner"><span><Flame size={13} /> {error}</span></div>}
    </section>
  );
}
