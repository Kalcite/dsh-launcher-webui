import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3, RefreshCw, Save, Coins, Flame, PieChart, TrendingUp,
  Clock, MoonStar, Sun, Plus, Trash2, CalendarDays
} from "lucide-react";
import { api, type UsagePricing } from "../api";

type UsageData = Awaited<ReturnType<typeof api.usage>>;
type Bucket = { weekday: number; hour: number; input: number; output: number; cacheRead: number; cacheWrite: number };

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

/* ------------------------------ 峰谷计费（前端实时计算） ------------------------------ */

function inPeakSlot(hour: number, pricing: UsagePricing): boolean {
  return pricing.peakSlots.some((s) => hour >= s.start && hour < s.end);
}

/** 某 (weekday, hour) 桶是否为高峰价；周末全天空闲（weekendFlat） */
function isPeakBucket(b: { weekday: number; hour: number }, pricing: UsagePricing): boolean {
  if (pricing.weekendFlat && (b.weekday === 0 || b.weekday === 6)) return false;
  return inPeakSlot(b.hour, pricing);
}

function bucketCost(b: Bucket, pricing: UsagePricing): number {
  const mult = isPeakBucket(b, pricing) ? 1 : (pricing.offPeakMultiplier ?? 1);
  return (
    ((b.input * pricing.inputPerM + b.output * pricing.outputPerM +
      b.cacheRead * pricing.cacheReadPerM + b.cacheWrite * pricing.cacheWritePerM) / 1e6) * mult
  );
}

function bucketTokens(b: Bucket): number {
  return b.input + b.output + b.cacheRead + b.cacheWrite;
}

const PIE_COLORS = {
  cacheRead: "var(--accent)",
  input: "var(--warn)",
  output: "var(--ok)",
  cacheWrite: "var(--err)"
};

/** Token 构成饼图（conic-gradient） */
function TokenPie({ data, pricing }: { data: UsageData; pricing: UsagePricing }) {
  const t = data.totals;
  const segs = useMemo(() => {
    const items = [
      { key: "cacheRead", label: "缓存命中输入", v: t.cacheRead },
      { key: "input", label: "输入（缓存未命中）", v: t.input },
      { key: "output", label: "输出", v: t.output },
      { key: "cacheWrite", label: "缓存写入", v: t.cacheWrite }
    ];
    const total = items.reduce((s, i) => s + i.v, 0) || 1;
    let acc = 0;
    const priceOf = (key: string) =>
      key === "input" ? pricing.inputPerM : key === "output" ? pricing.outputPerM : key === "cacheRead" ? pricing.cacheReadPerM : pricing.cacheWritePerM;
    const out = items.filter((i) => i.v > 0).map((i) => {
      const start = (acc / total) * 100;
      acc += i.v;
      const end = (acc / total) * 100;
      return { ...i, start, end, pct: i.v / total, price: priceOf(i.key) };
    });
    return { out, total };
  }, [t, pricing]);

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

/** 30 天消耗柱状图（div 柱，tooltip 全量） */
function DayBars({ byDay }: { byDay: UsageData["byDay"] }) {
  const days = byDay.slice(-30);
  const max = useMemo(() => Math.max(1, ...days.map((d) => d.input + d.output)), [days]);
  return (
    <div className="bars bars-days">
      {days.map((d) => {
        const v = d.input + d.output;
        const h = v > 0 ? Math.max(3, (v / max) * 120) : 1;
        return (
          <div key={d.date} className="bar-col" title={`${d.date}\n输入 ${fmtTok(d.input)} · 输出 ${fmtTok(d.output)} · 缓存读 ${fmtTok(d.cacheRead)}\n费用 ${fmtCost(d.cost)}`}>
            <div className="bar" style={{ height: h }} />
            <span className="bar-x">{d.date.slice(8)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** 24 小时消耗分布（含高峰时段高亮，来自 byHourWeek 跨周聚合） */
function HourBars({ hourAgg, pricing }: { hourAgg: { hour: number; total: number; inP: number; outP: number; cr: number; cw: number }[]; pricing: UsagePricing }) {
  const max = Math.max(1, ...hourAgg.map((h) => h.total));
  return (
    <div className="bars bars-hours">
      {hourAgg.map((h) => {
        const peak = inPeakSlot(h.hour, pricing);
        const hh = h.total > 0 ? Math.max(3, (h.total / max) * 120) : 1;
        return (
          <div key={h.hour} className="bar-col" title={`${String(h.hour).padStart(2, "0")}:00${peak ? " · 高峰" : " · 空闲"}\n总 ${fmtTok(h.total)} · 输入 ${fmtTok(h.inP)} · 输出 ${fmtTok(h.outP)} · 缓存读 ${fmtTok(h.cr)}`}>
            <div className={`bar ${peak ? "peak" : ""}`} style={{ height: hh }} />
            <span className="bar-x">{h.hour % 6 === 0 ? h.hour : ""}</span>
          </div>
        );
      })}
    </div>
  );
}

/** 星期 × 小时 热力（168 格），周末全天空闲高亮 */
function WeekHeat({ buckets, pricing }: { buckets: Bucket[]; pricing: UsagePricing }) {
  const map = useMemo(() => {
    const m = new Map<number, Bucket>();
    let max = 1;
    for (const b of buckets) {
      m.set(b.weekday * 24 + b.hour, b);
      max = Math.max(max, bucketTokens(b));
    }
    return { m, max };
  }, [buckets]);

  const rows = [1, 2, 3, 4, 5, 6, 0]; // 周一 → 周日
  const labels = ["一", "二", "三", "四", "五", "六", "日"];
  return (
    <div className="week-heat">
      <div className="wh-labels">
        <span className="wh-corner" />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="wh-hlabel">{h % 4 === 0 ? h : ""}</span>
        ))}
      </div>
      {rows.map((wd, ri) => (
        <div key={wd} className="wh-row">
          <span className={`wh-wlabel ${wd === 0 || wd === 6 ? "wk" : ""}`}>{labels[ri]}</span>
          {Array.from({ length: 24 }, (_, h) => {
            const b = map.m.get(wd * 24 + h);
            const v = b ? bucketTokens(b) : 0;
            const lvl = v > 0 ? Math.min(4, Math.ceil((v / map.max) * 4)) : 0;
            const peak = isPeakBucket({ weekday: wd, hour: h }, pricing);
            return (
              <div
                key={h}
                className={`wh-cell l${lvl}${peak ? " peak" : ""}${wd === 0 || wd === 6 ? " wk" : ""}`}
                title={b ? `周${labels[ri]} ${String(h).padStart(2, "0")}:00${peak ? " · 高峰" : " · 空闲"}\n输入 ${fmtTok(b.input)} · 输出 ${fmtTok(b.output)} · 缓存读 ${fmtTok(b.cacheRead)} · 费用 ${fmtCost(bucketCost(b, pricing))}` : `周${labels[ri]} ${String(h).padStart(2, "0")}:00`}
              />
            );
          })}
        </div>
      ))}
      <div className="heatmap-legend">
        <span>少</span>
        {[0, 1, 2, 3, 4].map((l) => <span key={l} className={`wh-cell l${l}`} />)}
        <span>多</span>
        <span className="wh-legend-note"><Sun size={10} /> 周末全天空闲价</span>
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

/* ------------------------------ 页面 ------------------------------ */

export function UsageCard() {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pricing, setPricing] = useState<UsagePricing>({
    inputPerM: 3, outputPerM: 9, cacheReadPerM: 0.1, cacheWritePerM: 3,
    offPeakMultiplier: 0.5,
    peakSlots: [{ start: 9, end: 12 }, { start: 14, end: 18 }],
    weekendFlat: true
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

  /* 实时账单：按 byHourWeek 每桶 × 峰谷系数 */
  const billing = useMemo(() => {
    const buckets = data?.byHourWeek ?? [];
    let total = 0, peak = 0, offPeak = 0, allPeak = 0, peakTok = 0, offTok = 0;
    for (const b of buckets) {
      const c = bucketCost(b, pricing);
      total += c;
      allPeak += (b.input * pricing.inputPerM + b.output * pricing.outputPerM +
        b.cacheRead * pricing.cacheReadPerM + b.cacheWrite * pricing.cacheWritePerM) / 1e6;
      if (isPeakBucket(b, pricing)) { peak += c; peakTok += bucketTokens(b); }
      else { offPeak += c; offTok += bucketTokens(b); }
    }
    return {
      total, peak, offPeak,
      savings: (allPeak - total),
      peakTok, offTok,
      peakShare: peakTok + offTok > 0 ? peakTok / (peakTok + offTok) : 0
    };
  }, [data, pricing]);

  const hourAgg = useMemo(() => {
    const out = Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0, inP: 0, outP: 0, cr: 0, cw: 0 }));
    for (const b of data?.byHourWeek ?? []) {
      const h = out[b.hour];
      h.inP += b.input; h.outP += b.output; h.cr += b.cacheRead; h.cw += b.cacheWrite;
      h.total += bucketTokens(b);
    }
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
            <p className="sub">Token 消耗 · 峰谷计费账单（数据源：{data?.home ?? "…"}）</p>
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
          {data ? <TokenPie data={data} pricing={pricing} /> : <p className="hint">加载中…</p>}
        </div>
        <div className="usage-col">
          <h3 className="section-title"><TrendingUp size={14} /> 峰谷账单（随单价实时计算）</h3>
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
            <Sun size={11} /> 高峰时段：{peakText}（北京时间）· 空闲 = 高峰 × {pricing.offPeakMultiplier}
            {pricing.weekendFlat ? " · 周末全天空闲价" : ""}
          </p>
        </div>
      </div>

      {/* 30 天柱状图 */}
      <h3 className="section-title" style={{ marginTop: 16 }}>最近 30 天消耗（输入 + 输出）</h3>
      {data ? <DayBars byDay={data.byDay} /> : <p className="hint">加载中…</p>}

      {/* 24 小时分布 */}
      <h3 className="section-title" style={{ marginTop: 16 }}>24 小时消耗分布（高峰时段高亮）</h3>
      {data ? <HourBars hourAgg={hourAgg} pricing={pricing} /> : <p className="hint">加载中…</p>}

      {/* 星期 × 小时热力 */}
      <h3 className="section-title" style={{ marginTop: 16 }}>
        <CalendarDays size={14} /> 星期 × 小时 消耗热力（峰谷 / 周末空闲）
      </h3>
      {data ? <WeekHeat buckets={data.byHourWeek} pricing={pricing} /> : <p className="hint">加载中…</p>}

      {/* 计费单价编辑器 */}
      <h3 className="section-title" style={{ marginTop: 16 }}>计费单价（元 / 百万 token）</h3>
      <div className="pricing-grid">
        {([
          ["inputPerM", "输入（缓存未命中）"],
          ["outputPerM", "输出"],
          ["cacheReadPerM", "输入（缓存命中）"],
          ["cacheWritePerM", "缓存写入"]
        ] as const).map(([key, label]) => (
          <label key={key} className="set-field">
            <span>高峰 · {label}</span>
            <input
              type="number"
              step="0.05"
              min={0}
              value={pricing[key]}
              onChange={(e) => setPricing((p) => ({ ...p, [key]: Math.max(0, Number(e.target.value) || 0) }))}
              className="mono"
            />
          </label>
        ))}
        <label className="set-field">
          <span>空闲倍率（高峰 × 系数）</span>
          <input
            type="number"
            step="0.05"
            min={0}
            max={1}
            value={pricing.offPeakMultiplier}
            onChange={(e) => setPricing((p) => ({ ...p, offPeakMultiplier: Math.max(0, Number(e.target.value) || 0) }))}
            className="mono"
          />
        </label>
      </div>

      <div className="slot-editor">
        <span className="slot-label">高峰时段（北京时间，可增删）</span>
        <div className="slot-list">
          {pricing.peakSlots.map((s, i) => (
            <div key={i} className="slot-row">
              <input
                type="number" min={0} max={23} value={s.start}
                onChange={(e) => {
                  const v = Math.min(23, Math.max(0, Number(e.target.value) || 0));
                  setPricing((p) => ({ ...p, peakSlots: p.peakSlots.map((x, j) => (j === i ? { ...x, start: v } : x)) }));
                }}
              />
              <span>—</span>
              <input
                type="number" min={1} max={24} value={s.end}
                onChange={(e) => {
                  const v = Math.min(24, Math.max(1, Number(e.target.value) || 0));
                  setPricing((p) => ({ ...p, peakSlots: p.peakSlots.map((x, j) => (j === i ? { ...x, end: v } : x)) }));
                }}
              />
              <button className="btn btn-ghost btn-xs" onClick={() => setPricing((p) => ({ ...p, peakSlots: p.peakSlots.filter((_, j) => j !== i) }))}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <button
            className="btn btn-ghost btn-xs"
            onClick={() => setPricing((p) => ({ ...p, peakSlots: [...p.peakSlots, { start: 9, end: 12 }] }))}
          >
            <Plus size={12} /> 添加时段
          </button>
        </div>
        <label className="slot-toggle">
          <input
            type="checkbox"
            checked={pricing.weekendFlat}
            onChange={(e) => setPricing((p) => ({ ...p, weekendFlat: e.target.checked }))}
          />
          <span>周末（周六/日）全天按空闲价</span>
        </label>
      </div>

      <div className="pricing-actions">
        <button className="btn btn-primary btn-sm" onClick={savePricing}>
          <Save size={14} /> 保存单价
        </button>
        <span className="hint">默认值来自 DeepSeek 官方定价文档（deepseek-v4-flash），修改后账单实时重算；保存后写入 config.json</span>
      </div>

      {/* 热力图 */}
      <h3 className="section-title" style={{ marginTop: 16 }}>Token 消耗热力图（近 365 天）</h3>
      {data ? <Heatmap byDay={data.byDay} /> : <p className="hint">加载中…</p>}

      {/* 按日明细 */}
      <h3 className="section-title" style={{ marginTop: 16 }}>最近 30 天明细（费用为高峰价估算）</h3>
      <div className="usage-table">
        <div className="ut-head"><span>日期</span><span>输入</span><span>输出</span><span>缓存读</span><span>费用</span></div>
        {data?.byDay.slice(-30).reverse().map((d) => (
          <div key={d.date} className="ut-row">
            <span>{d.date}</span>
            <span>{fmtTok(d.input)}</span>
            <span>{fmtTok(d.output)}</span>
            <span>{fmtTok(d.cacheRead)}</span>
            <span className={d.cost > 5 ? "warn" : ""}>{fmtCost(d.cost)}</span>
          </div>
        ))}
      </div>

      {/* 按会话 */}
      <h3 className="section-title" style={{ marginTop: 16 }}>会话明细</h3>
      <div className="usage-table">
        <div className="ut-head"><span>项目 / 会话</span><span>模型</span><span>输入</span><span>输出</span><span>费用</span></div>
        {data?.bySession.map((s) => (
          <div key={s.id} className="ut-row">
            <span title={s.id}>{s.project} · {s.id.slice(0, 8)}</span>
            <span>{s.models.join(", ") || "—"}</span>
            <span>{fmtTok(s.input)}</span>
            <span>{fmtTok(s.output)}</span>
            <span className={s.cost > 5 ? "warn" : ""}>{fmtCost(s.cost)}</span>
          </div>
        ))}
      </div>

      {error && <div className="error-banner"><span><Flame size={13} /> {error}</span></div>}
    </section>
  );
}
