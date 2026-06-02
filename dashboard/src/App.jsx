import { useState, useEffect } from "react";
import { AreaChart, Area, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

const SUPABASE_URL = "https://cupcsspfmkgbcovtgszm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1cGNzc3BmbWtnYmNvdnRnc3ptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzI4ODMsImV4cCI6MjA5NDg0ODg4M30.Y8o09mcvdJuSSfgsVGnhoUyRpIUPVl8-gkigJXXee8E";
const HEADERS = { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY };
const COMMODITIES = [
  { id: "corn", label: "Corn", icon: "🌽" },
  { id: "wheat", label: "Wheat", icon: "🌾" },
  { id: "soybeans", label: "Soybeans", icon: "🫘" },
];

function fmt(n, d) { if (d === undefined) d = 2; return Number(n).toFixed(d); }
function fmtK(n) { return n >= 1000 ? (n / 1000).toFixed(1) + "k" : fmt(n); }

function calcMA(prices, period) {
  return prices.map(function(_, i) {
    if (i < period - 1) return null;
    var slice = prices.slice(i - period + 1, i + 1);
    return slice.reduce(function(a, b) { return a + b; }, 0) / period;
  });
}
function calcRSI(prices, period) {
  if (!period) period = 14;
  var rsi = new Array(prices.length).fill(null);
  for (var i = period; i < prices.length; i++) {
    var gains = 0, losses = 0;
    for (var j = i - period + 1; j <= i; j++) {
      var diff = prices[j] - prices[j - 1];
      if (diff > 0) gains += diff; else losses -= diff;
    }
    var ag = gains / period, al = losses / period;
    if (al === 0) { rsi[i] = 100; continue; }
    rsi[i] = 100 - (100 / (1 + ag / al));
  }
  return rsi;
}
function calcBollinger(prices, period, multiplier) {
  if (!period) period = 20; if (!multiplier) multiplier = 2;
  return prices.map(function(_, i) {
    if (i < period - 1) return { upper: null, lower: null };
    var slice = prices.slice(i - period + 1, i + 1);
    var mean = slice.reduce(function(a, b) { return a + b; }, 0) / period;
    var std = Math.sqrt(slice.reduce(function(a, b) { return a + Math.pow(b - mean, 2); }, 0) / period);
    return { upper: mean + multiplier * std, lower: mean - multiplier * std };
  });
}
function calcEMA(prices, period) {
  var k = 2 / (period + 1), ema = new Array(prices.length).fill(null), fv = -1;
  for (var i = 0; i < prices.length; i++) { if (prices[i] !== null) { fv = i; break; } }
  if (fv === -1) return ema;
  ema[fv] = prices[fv];
  for (var i = fv + 1; i < prices.length; i++) {
    ema[i] = (prices[i] === null ? ema[i-1] : prices[i] * k + ema[i-1] * (1 - k));
  }
  return ema;
}
function calcMACD(prices) {
  var e12 = calcEMA(prices, 12), e26 = calcEMA(prices, 26);
  var ml = prices.map(function(_, i) { return (e12[i] === null || e26[i] === null) ? null : e12[i] - e26[i]; });
  var sl = calcEMA(ml.filter(function(v) { return v !== null; }), 9);
  var res = new Array(prices.length).fill(null), ni = 0;
  ml.forEach(function(v, i) {
    if (v !== null) { res[i] = { macd: v, signal: sl[ni] || null, histogram: sl[ni] !== null ? v - sl[ni] : null }; ni++; }
    else res[i] = { macd: null, signal: null, histogram: null };
  });
  return res;
}
function calcSR(prices) {
  var s = prices.slice().sort(function(a, b) { return a - b; });
  return { support: s[Math.floor(s.length * 0.1)], resistance: s[Math.floor(s.length * 0.9)] };
}
function calcZScore(prices) {
  var mean = prices.reduce(function(a, b) { return a + b; }, 0) / prices.length;
  var std = Math.sqrt(prices.reduce(function(a, b) { return a + Math.pow(b - mean, 2); }, 0) / prices.length);
  return std === 0 ? 0 : (prices[prices.length - 1] - mean) / std;
}
function getTrend(prices) {
  if (prices.length < 5) return "neutral";
  var r = prices.slice(-5), pct = (r[r.length-1] - r[0]) / r[0] * 100;
  return pct > 1 ? "bullish" : pct < -1 ? "bearish" : "neutral";
}

function MiniChart(props) {
  var data = props.data, color = props.color, gradId = props.gradId;
  return (
    <ResponsiveContainer width="100%" height={50}>
      <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.4} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={"url(#" + gradId + ")"} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function CustomTooltip(props) {
  var active = props.active, payload = props.payload, label = props.label;
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: "#1a1f3e", border: "1px solid #2d3561", borderRadius: 10, padding: "10px 14px", fontSize: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
      <p style={{ color: "#a0aec0", marginBottom: 6, fontWeight: 600 }}>{label}</p>
      {payload.map(function(p, i) {
        if (p.value === null || p.value === undefined) return null;
        return <p key={i} style={{ color: p.color, margin: "2px 0" }}>{p.name}: <strong>{typeof p.value === "number" ? p.value.toFixed(2) : p.value}</strong></p>;
      })}
    </div>
  );
}

function SignalBadge(props) {
  var s = props.signal;
  var g = s === "BUY" ? "linear-gradient(135deg,#00d4aa,#00b894)" : s === "SELL" ? "linear-gradient(135deg,#ff6b9d,#e84393)" : "linear-gradient(135deg,#a29bfe,#6c5ce7)";
  return <span style={{ background: g, color: "#fff", padding: "4px 14px", borderRadius: 20, fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", boxShadow: "0 2px 12px rgba(0,0,0,0.3)" }}>{s}</span>;
}

export default function App() {
  var [commodity, setCommodity] = useState("corn");
  var [data, setData] = useState([]);
  var [loading, setLoading] = useState(true);
  var [activeTab, setActiveTab] = useState("overview");
  var [lastUpdated, setLastUpdated] = useState(null);
  var [aiAnalysis, setAiAnalysis] = useState("");
  var [aiLoading, setAiLoading] = useState(false);
  var [dark, setDark] = useState(true);

  var bg = dark ? "#0d1117" : "#f0f2ff";
  var sidebar = dark ? "#161b2e" : "#ffffff";
  var card = dark ? "#1a1f3e" : "#ffffff";
  var cardBorder = dark ? "#2d3561" : "#e8eaf6";
  var text = dark ? "#e8edf5" : "#1a1f3e";
  var textSub = dark ? "#8892b0" : "#6272a4";
  var textMuted = dark ? "#4a5568" : "#b0b8d0";
  var chartGrid = dark ? "#1e2545" : "#eef0f8";

  function loadData(c) {
    setLoading(true);
    fetch(SUPABASE_URL + "/rest/v1/commodity_prices?commodity=eq." + c + "&order=date.desc&limit=60", { headers: HEADERS })
      .then(function(r) { return r.json(); })
      .then(function(rows) { setData(rows); setLastUpdated(new Date()); setLoading(false); })
      .catch(function(e) { console.error(e); setLoading(false); });
  }

  useEffect(function() {
    loadData(commodity);
    var iv = setInterval(function() { loadData(commodity); }, 5 * 60 * 1000);
    return function() { clearInterval(iv); };
  }, [commodity]);

  var latest = data[0], prev = data[1];
  var cbotDelta = latest && prev ? latest.closing_cbot - prev.closing_cbot : 0;
  var cbotPct = prev && prev.closing_cbot ? (cbotDelta / prev.closing_cbot) * 100 : 0;
  var argDelta = latest && prev ? latest.arg_price - prev.arg_price : 0;
  var alertActive = Math.abs(cbotPct) >= 2;

  var prices = data.slice().reverse().map(function(d) { return d.closing_cbot; });
  var dates = data.slice().reverse().map(function(d) { return d.date ? d.date.slice(5) : ""; });
  var argPrices = data.slice().reverse().map(function(d) { return d.arg_price; });

  var ma7 = calcMA(prices, 7), ma21 = calcMA(prices, 21);
  var rsiArr = calcRSI(prices, 14);
  var bollArr = calcBollinger(prices, 20, 2);
  var macdArr = calcMACD(prices);
  var srLevels = calcSR(prices);
  var zScore = calcZScore(prices);
  var trend = getTrend(prices);

  var currentRSI = rsiArr[rsiArr.length - 1];
  var currentMACD = macdArr[macdArr.length - 1];
  var currentBoll = bollArr[bollArr.length - 1];

  var rsiSignal = currentRSI !== null ? (currentRSI < 30 ? "BUY" : currentRSI > 70 ? "SELL" : "HOLD") : "HOLD";
  var macdSignal = currentMACD && currentMACD.macd !== null && currentMACD.signal !== null ? (currentMACD.macd > currentMACD.signal ? "BUY" : "SELL") : "HOLD";
  var trendSignal = trend === "bullish" ? "BUY" : trend === "bearish" ? "SELL" : "HOLD";
  var buyCount = [rsiSignal, macdSignal, trendSignal].filter(function(s) { return s === "BUY"; }).length;
  var sellCount = [rsiSignal, macdSignal, trendSignal].filter(function(s) { return s === "SELL"; }).length;
  var overallSignal = buyCount >= 2 ? "BUY" : sellCount >= 2 ? "SELL" : "HOLD";

  var chartData = dates.map(function(date, i) {
    return {
      date: date,
      close: prices[i] !== undefined ? parseFloat(prices[i].toFixed(2)) : null,
      ma7: ma7[i] !== null ? parseFloat(ma7[i].toFixed(2)) : null,
      ma21: ma21[i] !== null ? parseFloat(ma21[i].toFixed(2)) : null,
      upper: bollArr[i].upper !== null ? parseFloat(bollArr[i].upper.toFixed(2)) : null,
      lower: bollArr[i].lower !== null ? parseFloat(bollArr[i].lower.toFixed(2)) : null,
      rsi: rsiArr[i] !== null ? parseFloat(rsiArr[i].toFixed(2)) : null,
      histogram: macdArr[i].histogram !== null ? parseFloat(macdArr[i].histogram.toFixed(4)) : null,
      arg: argPrices[i] ? Math.round(argPrices[i]) : null,
      ret: data[data.length - 1 - i] && data[data.length - 1 - i].fut_ret ? parseFloat((data[data.length - 1 - i].fut_ret * 100).toFixed(2)) : null,
    };
  });

  var miniClose = prices.slice(-15).map(function(v) { return { v: v }; });
  var miniArg = argPrices.slice(-15).map(function(v) { return { v: v }; });
  var miniRSI = rsiArr.filter(function(v) { return v !== null; }).slice(-15).map(function(v) { return { v: v }; });

  function runAIAnalysis() {
    setAiLoading(true); setAiAnalysis(""); setActiveTab("analysis");
    setTimeout(function() { setAiAnalysis(generateReport()); setAiLoading(false); }, 800);
  }

  function generateReport() {
    if (!latest || prices.length < 5) return "Not enough data.";
    var lines = [], cbot = latest.closing_cbot, prev5 = prices.slice(-6, -1);
    var pct5 = ((cbot - prev5[0]) / prev5[0] * 100);
    lines.push("PRICE SUMMARY — " + latest.date);
    lines.push("─────────────────────────────────────────");
    if (cbotDelta > 0) lines.push("▲ UP " + Math.abs(cbotDelta).toFixed(2) + " (" + Math.abs(cbotPct).toFixed(2) + "%) — closed at " + cbot.toFixed(2) + " ¢/bu.");
    else if (cbotDelta < 0) lines.push("▼ DOWN " + Math.abs(cbotDelta).toFixed(2) + " (" + Math.abs(cbotPct).toFixed(2) + "%) — closed at " + cbot.toFixed(2) + " ¢/bu.");
    else lines.push("→ FLAT — closed at " + cbot.toFixed(2) + " ¢/bu.");
    lines.push("5-session: " + (pct5 >= 0 ? "+" : "") + pct5.toFixed(2) + "% — " + (pct5 > 2 ? "sustained uptrend." : pct5 < -2 ? "sustained selling pressure." : "consolidating."));
    lines.push("");
    lines.push("TECHNICAL INDICATORS");
    lines.push("─────────────────────────────────────────");
    if (currentRSI !== null) {
      var r = "RSI(14) = " + currentRSI.toFixed(1) + " → ";
      if (currentRSI < 30) r += "OVERSOLD — bounce potential.";
      else if (currentRSI < 45) r += "Bearish — sellers in control.";
      else if (currentRSI < 55) r += "Neutral — no clear bias.";
      else if (currentRSI < 70) r += "Bullish — buyers in control.";
      else r += "OVERBOUGHT — pullback risk.";
      lines.push(r);
    }
    if (currentMACD && currentMACD.histogram !== null)
      lines.push("MACD = " + currentMACD.histogram.toFixed(4) + " → " + (currentMACD.histogram > 0 ? "Bullish momentum." : "Bearish momentum."));
    if (currentBoll && currentBoll.upper !== null)
      lines.push("Bollinger → " + (cbot > currentBoll.upper ? "Above upper — overbought." : cbot < currentBoll.lower ? "Below lower — oversold." : "Inside band. Normal volatility."));
    lines.push("Z-Score = " + zScore.toFixed(2) + (Math.abs(zScore) > 2 ? " → ⚠ EXTREME move!" : " → Normal range."));
    var ma7v = ma7[ma7.length-1], ma21v = ma21[ma21.length-1];
    if (ma7v && ma21v) lines.push("MA7=" + ma7v.toFixed(2) + " | MA21=" + ma21v.toFixed(2) + " → " + (ma7v > ma21v ? "Bullish alignment." : "Bearish alignment."));
    lines.push("");
    lines.push("KEY LEVELS");
    lines.push("─────────────────────────────────────────");
    lines.push("Support:    " + srLevels.support.toFixed(2) + " ¢/bu");
    lines.push("Resistance: " + srLevels.resistance.toFixed(2) + " ¢/bu");
    lines.push("Price is " + ((cbot - srLevels.support) / srLevels.support * 100).toFixed(1) + "% above support, " + ((srLevels.resistance - cbot) / cbot * 100).toFixed(1) + "% below resistance.");
    if (cbot < srLevels.support * 1.01) lines.push("⚠ Testing support — break below could accelerate selling.");
    else if (cbot > srLevels.resistance * 0.99) lines.push("⚠ Testing resistance — breakout could trigger buying.");
    lines.push("");
    lines.push("LOCAL MARKET (EGP)");
    lines.push("─────────────────────────────────────────");
    lines.push("Dollar Rate: " + latest.dollar_rate.toFixed(2) + " EGP/USD");
    lines.push("ARG Price:   " + Math.round(latest.arg_price).toLocaleString() + " EGP");
    lines.push("BRZ Price:   " + Math.round(latest.brz_price).toLocaleString() + " EGP");
    if (argDelta > 0) lines.push("ARG rose " + Math.abs(argDelta).toFixed(0) + " EGP — higher cost for buyers.");
    else if (argDelta < 0) lines.push("ARG fell " + Math.abs(argDelta).toFixed(0) + " EGP — relief for buyers.");
    lines.push("");
    lines.push("OVERALL SIGNAL: " + overallSignal);
    lines.push("─────────────────────────────────────────");
    if (overallSignal === "BUY") lines.push("Bullish bias (" + buyCount + " buy / " + sellCount + " sell). Watch resistance: " + srLevels.resistance.toFixed(2) + ".");
    else if (overallSignal === "SELL") lines.push("Bearish bias (" + sellCount + " sell / " + buyCount + " buy). Watch support: " + srLevels.support.toFixed(2) + ".");
    else lines.push("Mixed signals — consolidation. Wait for breakout.");
    lines.push("\nGenerated by AdmMedSofts Commodity Intelligence");
    return lines.join("\n");
  }

  var cc = COMMODITIES.find(function(c) { return c.id === commodity; });

  // KPI card component
  function KpiCard(props) {
    var label = props.label, value = props.value, unit = props.unit, sub = props.sub, subUp = props.subUp, gradient = props.gradient, miniData = props.miniData, miniColor = props.miniColor, gradId = props.gradId, mape = props.mape;
    return (
      <div style={{ background: gradient, borderRadius: 18, padding: "20px 22px 14px", color: "#fff", boxShadow: "0 8px 32px rgba(0,0,0,0.25)", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -25, right: -25, width: 90, height: 90, borderRadius: "50%", background: "rgba(255,255,255,0.08)" }} />
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", opacity: 0.85, marginBottom: 6 }}>{label}</div>
        <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1, marginBottom: 2 }}>{value}</div>
        <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 10 }}>{unit}</div>
        {sub !== undefined && sub !== null && (
          <div style={{ fontSize: 12, fontWeight: 700, background: "rgba(255,255,255,0.18)", borderRadius: 8, padding: "3px 9px", display: "inline-block", marginBottom: 8 }}>
            {subUp !== undefined ? (subUp >= 0 ? "▲ " : "▼ ") : ""}{sub}
          </div>
        )}
        {mape !== undefined && (
          <div style={{ fontSize: 11, opacity: 0.85, marginTop: 4 }}>
            {mape !== null ? "MAPE: " + mape.toFixed(2) + "%" : "MAPE: accumulating..."}
          </div>
        )}
        {miniData && miniData.length > 0 && (
          <div style={{ marginTop: 4 }}>
            <MiniChart data={miniData} color={miniColor || "#fff"} gradId={gradId || "g1"} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: bg, color: text, fontFamily: "'DM Sans', 'Segoe UI', sans-serif", transition: "all 0.3s" }}>

      {/* Sidebar */}
      <div style={{ position: "fixed", left: 0, top: 0, bottom: 0, width: 220, background: sidebar, borderRight: "1px solid " + cardBorder, display: "flex", flexDirection: "column", zIndex: 100, boxShadow: "4px 0 24px rgba(0,0,0,0.3)" }}>

        <div style={{ padding: "22px 18px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 2 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: "linear-gradient(135deg, #a29bfe, #6c5ce7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, boxShadow: "0 4px 12px rgba(108,92,231,0.5)" }}>🌽</div>
            <div>
              <div style={{ fontSize: 9, letterSpacing: "0.18em", color: textMuted, textTransform: "uppercase", fontWeight: 700 }}>AdmMedSofts</div>
              <div style={{ fontSize: 14, fontWeight: 900, color: text, lineHeight: 1.1 }}>Commodity Hub</div>
            </div>
          </div>
        </div>

        {/* Dark/Light Toggle */}
        <div style={{ padding: "0 14px 10px" }}>
          <button onClick={function() { setDark(!dark); }} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderRadius: 10, border: "1px solid " + cardBorder, background: "transparent", cursor: "pointer", color: textSub, fontSize: 12, fontWeight: 600 }}>
            <span>{dark ? "🌙 Dark" : "☀️ Light"}</span>
            <div style={{ width: 38, height: 20, borderRadius: 10, background: dark ? "linear-gradient(135deg,#a29bfe,#6c5ce7)" : "#ddd", position: "relative", transition: "all 0.3s" }}>
              <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: dark ? 20 : 2, transition: "left 0.3s", boxShadow: "0 1px 4px rgba(0,0,0,0.3)" }} />
            </div>
          </button>
        </div>

        <div style={{ padding: "4px 10px", marginBottom: 4 }}>
          <div style={{ fontSize: 10, color: textMuted, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8, paddingLeft: 8, fontWeight: 700 }}>Markets</div>
          {COMMODITIES.map(function(c) {
            var active = commodity === c.id;
            return (
              <button key={c.id} onClick={function() { setCommodity(c.id); }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 10, border: "none", cursor: "pointer", marginBottom: 2, background: active ? "linear-gradient(135deg,#a29bfe,#6c5ce7)" : "transparent", color: active ? "#fff" : textSub, fontWeight: active ? 700 : 400, fontSize: 13, transition: "all 0.2s", boxShadow: active ? "0 4px 14px rgba(108,92,231,0.45)" : "none" }}>
                <span style={{ fontSize: 15 }}>{c.icon}</span>{c.label}
                {c.id !== "corn" && <span style={{ marginLeft: "auto", fontSize: 10, background: active ? "rgba(255,255,255,0.2)" : cardBorder, color: active ? "#fff" : textMuted, padding: "2px 7px", borderRadius: 6, fontWeight: 700 }}>Soon</span>}
              </button>
            );
          })}
        </div>

        <div style={{ padding: "4px 10px", marginBottom: 4 }}>
          <div style={{ fontSize: 10, color: textMuted, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8, paddingLeft: 8, fontWeight: 700 }}>Views</div>
          {[["overview","📊","Overview"],["charts","📈","Price Charts"],["analysis","🧠","AI Analysis"],["returns","💹","Returns"],["table","📋","Raw Data"]].map(function(item) {
            var id = item[0], icon = item[1], label = item[2], active = activeTab === id;
            return (
              <button key={id} onClick={function() { setActiveTab(id); }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 10, border: "none", cursor: "pointer", marginBottom: 2, background: active ? (dark ? "rgba(162,155,254,0.15)" : "rgba(108,92,231,0.08)") : "transparent", color: active ? "#a29bfe" : textSub, fontWeight: active ? 700 : 400, fontSize: 13, borderLeft: active ? "3px solid #a29bfe" : "3px solid transparent" }}>
                <span>{icon}</span>{label}
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: "auto", padding: "14px" }}>
          <button onClick={function() { loadData(commodity); }} style={{ width: "100%", padding: "8px", borderRadius: 10, border: "1px solid " + cardBorder, background: "transparent", color: textSub, fontSize: 12, cursor: "pointer", marginBottom: 8, fontWeight: 600 }}>↻ Refresh</button>
          <button onClick={runAIAnalysis} style={{ width: "100%", padding: "9px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#a29bfe,#6c5ce7)", color: "#fff", fontSize: 12, cursor: "pointer", fontWeight: 800, boxShadow: "0 4px 14px rgba(108,92,231,0.45)" }}>🧠 Run AI Analysis</button>
          {lastUpdated && <div style={{ fontSize: 10, color: textMuted, marginTop: 8, textAlign: "center" }}>Updated {lastUpdated.toLocaleTimeString()}</div>}
        </div>
      </div>

      {/* Main */}
      <div style={{ marginLeft: 220, padding: "24px 28px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0, color: text, letterSpacing: "-0.5px" }}>
              {cc ? cc.icon : ""} {cc ? cc.label : ""} Market
            </h1>
            <div style={{ fontSize: 12, color: textSub, marginTop: 3 }}>CBOT Futures · EGP Local Prices · {latest ? latest.date : "—"}</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {alertActive && <div style={{ background: "linear-gradient(135deg,#ff6b9d,#e84393)", borderRadius: 10, padding: "7px 14px", fontSize: 12, color: "#fff", fontWeight: 700, boxShadow: "0 4px 14px rgba(232,67,147,0.4)" }}>⚠ {fmt(Math.abs(cbotPct))}% move</div>}
            <div style={{ background: card, border: "1px solid " + cardBorder, borderRadius: 10, padding: "7px 14px", fontSize: 12, color: textSub, fontWeight: 600 }}>{data.length} pts</div>
            <div style={{ background: trend === "bullish" ? "linear-gradient(135deg,#00d4aa,#00b894)" : trend === "bearish" ? "linear-gradient(135deg,#ff6b9d,#e84393)" : "linear-gradient(135deg,#a29bfe,#6c5ce7)", borderRadius: 10, padding: "7px 14px", fontSize: 12, color: "#fff", fontWeight: 800, boxShadow: "0 4px 12px rgba(0,0,0,0.2)" }}>
              {trend === "bullish" ? "▲ Bullish" : trend === "bearish" ? "▼ Bearish" : "→ Neutral"}
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300, color: textSub, fontSize: 14 }}>
            <div style={{ textAlign: "center" }}><div style={{ fontSize: 36, marginBottom: 12 }}>⏳</div>Loading market data...</div>
          </div>
        ) : !latest ? (
          <div style={{ textAlign: "center", padding: 60, color: textSub }}><div style={{ fontSize: 36, marginBottom: 12 }}>📭</div><div>No data yet</div></div>
        ) : (
          <div>
            {/* KPI Cards */}
            {(activeTab === "overview" || activeTab === "charts" || activeTab === "analysis") && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 14 }}>
                  <KpiCard label="CBOT Close" value={fmt(latest.closing_cbot)} unit="¢/bu" sub={fmt(Math.abs(cbotDelta)) + " (" + fmt(Math.abs(cbotPct)) + "%)"} subUp={cbotDelta} gradient="linear-gradient(135deg, #a29bfe, #6c5ce7)" miniData={miniClose} miniColor="rgba(255,255,255,0.8)" gradId="g1" />
                  <KpiCard label="ARG Local Price" value={fmtK(latest.arg_price)} unit="EGP" sub={fmt(Math.abs(argDelta)) + " EGP"} subUp={argDelta} gradient="linear-gradient(135deg, #fd79a8, #e84393)" miniData={miniArg} miniColor="rgba(255,255,255,0.8)" gradId="g2" />
                  <KpiCard label="Dollar Rate" value={fmt(latest.dollar_rate)} unit="EGP/USD" gradient="linear-gradient(135deg, #00cec9, #00b894)" gradId="g3" />
                  <KpiCard label="RSI (14)" value={currentRSI ? currentRSI.toFixed(1) : "—"} unit={currentRSI ? (currentRSI < 30 ? "Oversold" : currentRSI > 70 ? "Overbought" : "Neutral") : ""} gradient="linear-gradient(135deg, #fdcb6e, #e17055)" miniData={miniRSI} miniColor="rgba(255,255,255,0.8)" gradId="g4" />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
                  <KpiCard label="CBOT Next-Day Forecast" value={latest.cbot_predicted ? fmt(latest.cbot_predicted) : "—"} unit="¢/bu predicted" gradient="linear-gradient(135deg, #6c5ce7, #a29bfe)" mape={latest.mape_cbot} gradId="g5" />
                  <KpiCard label="ARG Forecast Accuracy" value={latest.arg_predicted ? fmtK(latest.arg_predicted) : "—"} unit="EGP predicted" gradient="linear-gradient(135deg, #00b894, #00cec9)" mape={latest.mape_arg} gradId="g6" />
                  <KpiCard label="BRZ Forecast Accuracy" value={latest.brz_predicted ? fmtK(latest.brz_predicted) : "—"} unit="EGP predicted" gradient="linear-gradient(135deg, #e84393, #fd79a8)" mape={latest.mape_brz} gradId="g7" />
                </div>
              </div>
            )}

            {/* Overview */}
            {activeTab === "overview" && (
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
                <div style={{ background: card, border: "1px solid " + cardBorder, borderRadius: 18, padding: "20px 20px 12px", boxShadow: "0 4px 24px rgba(0,0,0,0.2)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: text }}>CBOT Price Trend</div>
                    <div style={{ display: "flex", gap: 12, fontSize: 11 }}>
                      <span style={{ color: "#a29bfe" }}>● Close</span>
                      <span style={{ color: "#fdcb6e" }}>● MA7</span>
                      <span style={{ color: "#fd79a8" }}>● MA21</span>
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="closeGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#a29bfe" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#a29bfe" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                      <XAxis dataKey="date" tick={{ fill: textSub, fontSize: 10 }} />
                      <YAxis tick={{ fill: textSub, fontSize: 10 }} domain={["auto", "auto"]} />
                      <Tooltip content={<CustomTooltip />} />
                      <Area type="monotone" dataKey="close" stroke="#a29bfe" strokeWidth={2.5} fill="url(#closeGrad)" dot={false} name="Close" />
                      <Line type="monotone" dataKey="ma7" stroke="#fdcb6e" strokeWidth={1.5} dot={false} name="MA7" strokeDasharray="4 2" />
                      <Line type="monotone" dataKey="ma21" stroke="#fd79a8" strokeWidth={1.5} dot={false} name="MA21" strokeDasharray="4 2" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {[
                    { label: "Z-Score", value: zScore.toFixed(2), unit: Math.abs(zScore) > 2 ? "⚠ Extreme" : "Normal", color: Math.abs(zScore) > 2 ? "#ff6b9d" : "#00cec9" },
                    { label: "Support", value: fmt(srLevels.support), unit: "¢/bu floor", color: "#00d4aa" },
                    { label: "Resistance", value: fmt(srLevels.resistance), unit: "¢/bu ceiling", color: "#ff6b9d" },
                    { label: "Signal", value: overallSignal, unit: buyCount + " buy / " + sellCount + " sell", color: overallSignal === "BUY" ? "#00d4aa" : overallSignal === "SELL" ? "#ff6b9d" : "#a29bfe" },
                    { label: "BRZ Price", value: fmtK(latest.brz_price), unit: "EGP equiv.", color: "#fdcb6e" },
                  ].map(function(s, i) {
                    return (
                      <div key={i} style={{ background: card, border: "1px solid " + cardBorder, borderRadius: 14, padding: "12px 16px", flex: 1, boxShadow: "0 2px 12px rgba(0,0,0,0.15)" }}>
                        <div style={{ fontSize: 10, color: textMuted, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>{s.label}</div>
                        <div style={{ fontSize: 20, fontWeight: 900, color: s.color, marginTop: 2 }}>{s.value}</div>
                        <div style={{ fontSize: 11, color: textSub }}>{s.unit}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Charts */}
            {activeTab === "charts" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ background: card, border: "1px solid " + cardBorder, borderRadius: 18, padding: "20px 20px 12px", boxShadow: "0 4px 24px rgba(0,0,0,0.2)" }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: text, marginBottom: 16 }}>Price + Bollinger Bands</div>
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                      <XAxis dataKey="date" tick={{ fill: textSub, fontSize: 10 }} />
                      <YAxis tick={{ fill: textSub, fontSize: 10 }} domain={["auto", "auto"]} />
                      <Tooltip content={<CustomTooltip />} />
                      <Line type="monotone" dataKey="upper" stroke="#00cec9" strokeWidth={1} dot={false} name="BB Upper" strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="close" stroke="#a29bfe" strokeWidth={2.5} dot={false} name="Close" />
                      <Line type="monotone" dataKey="lower" stroke="#ff6b9d" strokeWidth={1} dot={false} name="BB Lower" strokeDasharray="3 3" />
                      <ReferenceLine y={srLevels.support} stroke="#00d4aa" strokeDasharray="5 5" label={{ value: "S", fill: "#00d4aa", fontSize: 10 }} />
                      <ReferenceLine y={srLevels.resistance} stroke="#ff6b9d" strokeDasharray="5 5" label={{ value: "R", fill: "#ff6b9d", fontSize: 10 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div style={{ background: card, border: "1px solid " + cardBorder, borderRadius: 18, padding: "20px 20px 12px", boxShadow: "0 4px 24px rgba(0,0,0,0.2)" }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: text, marginBottom: 16 }}>RSI (14)</div>
                    <ResponsiveContainer width="100%" height={160}>
                      <AreaChart data={chartData}>
                        <defs>
                          <linearGradient id="rsiGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#fdcb6e" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#fdcb6e" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                        <XAxis dataKey="date" tick={{ fill: textSub, fontSize: 9 }} />
                        <YAxis domain={[0, 100]} tick={{ fill: textSub, fontSize: 9 }} />
                        <Tooltip content={<CustomTooltip />} />
                        <ReferenceLine y={70} stroke="#ff6b9d" strokeDasharray="4 4" />
                        <ReferenceLine y={30} stroke="#00d4aa" strokeDasharray="4 4" />
                        <Area type="monotone" dataKey="rsi" stroke="#fdcb6e" strokeWidth={2} fill="url(#rsiGrad)" dot={false} name="RSI" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ background: card, border: "1px solid " + cardBorder, borderRadius: 18, padding: "20px 20px 12px", boxShadow: "0 4px 24px rgba(0,0,0,0.2)" }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: text, marginBottom: 16 }}>MACD Histogram</div>
                    <ResponsiveContainer width="100%" height={160}>
                      <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                        <XAxis dataKey="date" tick={{ fill: textSub, fontSize: 9 }} />
                        <YAxis tick={{ fill: textSub, fontSize: 9 }} />
                        <Tooltip content={<CustomTooltip />} />
                        <ReferenceLine y={0} stroke={cardBorder} strokeWidth={2} />
                        <Bar dataKey="histogram" name="MACD" fill="#a29bfe" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {/* AI Analysis */}
            {activeTab === "analysis" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
                  {[
                    { label: "Overall Signal", value: overallSignal, sub: buyCount + "B / " + sellCount + "S" },
                    { label: "RSI Signal", value: rsiSignal, sub: "RSI = " + (currentRSI ? currentRSI.toFixed(1) : "—") },
                    { label: "MACD Signal", value: macdSignal, sub: currentMACD && currentMACD.histogram ? (currentMACD.histogram > 0 ? "Momentum ▲" : "Momentum ▼") : "—" },
                    { label: "Trend Signal", value: trendSignal, sub: trend + " (5-day)" },
                  ].map(function(c, i) {
                    return (
                      <div key={i} style={{ background: card, border: "1px solid " + cardBorder, borderRadius: 16, padding: "18px 20px", textAlign: "center", boxShadow: "0 4px 20px rgba(0,0,0,0.2)" }}>
                        <div style={{ fontSize: 10, color: textMuted, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: 10 }}>{c.label}</div>
                        <SignalBadge signal={c.value} />
                        <div style={{ fontSize: 11, color: textSub, marginTop: 8 }}>{c.sub}</div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
                  {[
                    { label: "Z-Score", value: zScore.toFixed(2), sub: Math.abs(zScore) > 2 ? "⚠ Extreme" : "Normal", color: Math.abs(zScore) > 2 ? "#ff6b9d" : "#00cec9" },
                    { label: "Support", value: fmt(srLevels.support), sub: "¢/bu floor", color: "#00d4aa" },
                    { label: "Resistance", value: fmt(srLevels.resistance), sub: "¢/bu ceiling", color: "#ff6b9d" },
                    { label: "Bollinger", value: currentBoll && currentBoll.upper ? (latest.closing_cbot > currentBoll.upper ? "Above Upper" : latest.closing_cbot < currentBoll.lower ? "Below Lower" : "Inside Band") : "—", sub: currentBoll && currentBoll.upper ? "Upper: " + fmt(currentBoll.upper) : "", color: "#a29bfe" },
                  ].map(function(c, i) {
                    return (
                      <div key={i} style={{ background: card, border: "1px solid " + cardBorder, borderRadius: 16, padding: "16px 20px", boxShadow: "0 4px 20px rgba(0,0,0,0.2)" }}>
                        <div style={{ fontSize: 10, color: textMuted, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: 6 }}>{c.label}</div>
                        <div style={{ fontSize: 20, fontWeight: 900, color: c.color }}>{c.value}</div>
                        <div style={{ fontSize: 11, color: textSub }}>{c.sub}</div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ background: card, border: "1px solid " + cardBorder, borderRadius: 18, padding: "20px 24px", boxShadow: "0 4px 24px rgba(0,0,0,0.2)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                    <div style={{ fontSize: 14, fontWeight: 900, color: text }}>🧠 AI Market Analysis</div>
                    <button onClick={runAIAnalysis} style={{ padding: "7px 18px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#a29bfe,#6c5ce7)", color: "#fff", fontSize: 12, cursor: "pointer", fontWeight: 800, boxShadow: "0 4px 14px rgba(108,92,231,0.45)" }}>
                      {aiLoading ? "Analyzing..." : "↻ Refresh"}
                    </button>
                  </div>
                  {aiLoading ? (
                    <div style={{ color: textSub, fontSize: 13, padding: "20px 0", textAlign: "center" }}>
                      <div style={{ fontSize: 28, marginBottom: 8 }}>🔍</div>Analyzing market data...
                    </div>
                  ) : aiAnalysis ? (
                    <div style={{ color: text, fontSize: 13, lineHeight: 1.9, whiteSpace: "pre-wrap", fontFamily: "monospace" }}>{aiAnalysis}</div>
                  ) : (
                    <div style={{ color: textSub, fontSize: 13, textAlign: "center", padding: "20px 0" }}>
                      Click <strong style={{ color: "#a29bfe" }}>🧠 Run AI Analysis</strong> in the sidebar.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Returns */}
            {activeTab === "returns" && (
              <div style={{ background: card, border: "1px solid " + cardBorder, borderRadius: 18, padding: "20px 20px 12px", boxShadow: "0 4px 24px rgba(0,0,0,0.2)" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: text, marginBottom: 16 }}>Daily Futures Returns (%)</div>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                    <XAxis dataKey="date" tick={{ fill: textSub, fontSize: 11 }} />
                    <YAxis tick={{ fill: textSub, fontSize: 11 }} tickFormatter={function(v) { return v + "%"; }} />
                    <Tooltip content={<CustomTooltip />} />
                    <ReferenceLine y={0} stroke={cardBorder} strokeWidth={2} />
                    <Bar dataKey="ret" name="Return (%)" fill="#a29bfe" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Table */}
            {activeTab === "table" && (
              <div style={{ background: card, border: "1px solid " + cardBorder, borderRadius: 18, overflow: "hidden", boxShadow: "0 4px 24px rgba(0,0,0,0.2)" }}>
                <div style={{ padding: "16px 20px", borderBottom: "1px solid " + cardBorder, fontSize: 13, fontWeight: 800, color: text }}>
                  Raw Data — {data.length} records
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: dark ? "#0d1117" : "#f8fafc" }}>
                        {["Date","Close ¢/bu","Low","High","Dollar Rate","ARG Price","BRZ Price","Fut. Return"].map(function(h) {
                          return <th key={h} style={{ padding: "10px 14px", textAlign: "left", color: textSub, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>{h}</th>;
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {data.map(function(row, i) {
                        var rc = row.fut_ret > 0 ? "#00d4aa" : row.fut_ret < 0 ? "#ff6b9d" : textSub;
                        return (
                          <tr key={i} style={{ borderTop: "1px solid " + cardBorder, background: i === 0 ? (dark ? "rgba(162,155,254,0.08)" : "rgba(108,92,231,0.04)") : "transparent" }}>
                            <td style={{ padding: "9px 14px", color: i === 0 ? "#a29bfe" : textSub, fontWeight: i === 0 ? 700 : 400 }}>{row.date}</td>
                            <td style={{ padding: "9px 14px", color: text, fontWeight: 700 }}>{fmt(row.closing_cbot)}</td>
                            <td style={{ padding: "9px 14px", color: textSub }}>{fmt(row.cbot_low)}</td>
                            <td style={{ padding: "9px 14px", color: textSub }}>{fmt(row.cbot_high)}</td>
                            <td style={{ padding: "9px 14px", color: textSub }}>{fmt(row.dollar_rate)}</td>
                            <td style={{ padding: "9px 14px", color: "#00d4aa", fontWeight: 600 }}>{Math.round(row.arg_price).toLocaleString()}</td>
                            <td style={{ padding: "9px 14px", color: "#fdcb6e", fontWeight: 600 }}>{Math.round(row.brz_price).toLocaleString()}</td>
                            <td style={{ padding: "9px 14px", color: rc, fontWeight: 600 }}>{fmt(row.fut_ret * 100, 2)}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}