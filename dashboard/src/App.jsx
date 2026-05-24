import { useState, useEffect } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Area, AreaChart } from "recharts";

const SUPABASE_URL = "https://cupcsspfmkgbcovtgszm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1cGNzc3BmbWtnYmNvdnRnc3ptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzI4ODMsImV4cCI6MjA5NDg0ODg4M30.Y8o09mcvdJuSSfgsVGnhoUyRpIUPVl8-gkigJXXee8E";
const HEADERS = { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY };
const ANTHROPIC_KEY = "";

const COMMODITIES = [
  { id: "corn", label: "Corn", icon: "🌽" },
  { id: "wheat", label: "Wheat", icon: "🌾" },
  { id: "soybeans", label: "Soybeans", icon: "🫘" },
];

function fmt(n, d) { if (d === undefined) d = 2; return Number(n).toFixed(d); }
function fmtK(n) { return n >= 1000 ? (n / 1000).toFixed(1) + "k" : fmt(n); }

// ── Technical Indicators ──────────────────────────────────────────
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
    var avgGain = gains / period;
    var avgLoss = losses / period;
    if (avgLoss === 0) { rsi[i] = 100; continue; }
    var rs = avgGain / avgLoss;
    rsi[i] = 100 - (100 / (1 + rs));
  }
  return rsi;
}

function calcBollinger(prices, period, multiplier) {
  if (!period) period = 20;
  if (!multiplier) multiplier = 2;
  return prices.map(function(_, i) {
    if (i < period - 1) return { upper: null, middle: null, lower: null };
    var slice = prices.slice(i - period + 1, i + 1);
    var mean = slice.reduce(function(a, b) { return a + b; }, 0) / period;
    var variance = slice.reduce(function(a, b) { return a + Math.pow(b - mean, 2); }, 0) / period;
    var std = Math.sqrt(variance);
    return { upper: mean + multiplier * std, middle: mean, lower: mean - multiplier * std };
  });
}

function calcMACD(prices) {
  var ema12 = calcEMA(prices, 12);
  var ema26 = calcEMA(prices, 26);
  var macdLine = prices.map(function(_, i) {
    if (ema12[i] === null || ema26[i] === null) return null;
    return ema12[i] - ema26[i];
  });
  var signalLine = calcEMA(macdLine.filter(function(v) { return v !== null; }), 9);
  var result = new Array(prices.length).fill(null);
  var nonNullIdx = 0;
  macdLine.forEach(function(v, i) {
    if (v !== null) { result[i] = { macd: v, signal: signalLine[nonNullIdx] || null, histogram: signalLine[nonNullIdx] !== null ? v - signalLine[nonNullIdx] : null }; nonNullIdx++; }
    else result[i] = { macd: null, signal: null, histogram: null };
  });
  return result;
}

function calcEMA(prices, period) {
  var k = 2 / (period + 1);
  var ema = new Array(prices.length).fill(null);
  var firstValid = -1;
  for (var i = 0; i < prices.length; i++) {
    if (prices[i] !== null && prices[i] !== undefined) { firstValid = i; break; }
  }
  if (firstValid === -1) return ema;
  ema[firstValid] = prices[firstValid];
  for (var i = firstValid + 1; i < prices.length; i++) {
    if (prices[i] === null || prices[i] === undefined) { ema[i] = ema[i-1]; continue; }
    ema[i] = prices[i] * k + ema[i-1] * (1 - k);
  }
  return ema;
}

function calcSupportResistance(prices) {
  var sorted = prices.slice().sort(function(a, b) { return a - b; });
  var support = sorted[Math.floor(sorted.length * 0.1)];
  var resistance = sorted[Math.floor(sorted.length * 0.9)];
  return { support: support, resistance: resistance };
}

function calcZScore(prices) {
  var mean = prices.reduce(function(a, b) { return a + b; }, 0) / prices.length;
  var std = Math.sqrt(prices.reduce(function(a, b) { return a + Math.pow(b - mean, 2); }, 0) / prices.length);
  return std === 0 ? 0 : (prices[prices.length - 1] - mean) / std;
}

function getTrend(prices) {
  if (prices.length < 5) return "neutral";
  var recent = prices.slice(-5);
  var first = recent[0], last = recent[recent.length - 1];
  var pct = (last - first) / first * 100;
  if (pct > 1) return "bullish";
  if (pct < -1) return "bearish";
  return "neutral";
}

// ── Tooltip ───────────────────────────────────────────────────────
function CustomTooltip(props) {
  var active = props.active, payload = props.payload, label = props.label;
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: "#0f1923", border: "1px solid #1e3a5f", borderRadius: 8, padding: "10px 14px", fontSize: 12 }}>
      <p style={{ color: "#64b5f6", marginBottom: 6, fontWeight: 600 }}>{label}</p>
      {payload.map(function(p, i) {
        if (p.value === null || p.value === undefined) return null;
        return <p key={i} style={{ color: p.color, margin: "2px 0" }}>{p.name}: <strong>{typeof p.value === "number" ? p.value.toFixed(2) : p.value}</strong></p>;
      })}
    </div>
  );
}

// ── Signal Badge ──────────────────────────────────────────────────
function SignalBadge(props) {
  var signal = props.signal;
  var colors = { BUY: "#1b5e20", SELL: "#b71c1c", HOLD: "#1a2d45" };
  var textColors = { BUY: "#81c784", SELL: "#ef9a9a", HOLD: "#64b5f6" };
  return (
    <span style={{ background: colors[signal] || colors.HOLD, color: textColors[signal] || textColors.HOLD, padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em" }}>
      {signal}
    </span>
  );
}

// ── Main App ──────────────────────────────────────────────────────
export default function App() {
  var [commodity, setCommodity] = useState("corn");
  var [data, setData] = useState([]);
  var [loading, setLoading] = useState(true);
  var [activeTab, setActiveTab] = useState("overview");
  var [lastUpdated, setLastUpdated] = useState(null);
  var [aiAnalysis, setAiAnalysis] = useState("");
  var [aiLoading, setAiLoading] = useState(false);

  function loadData(c) {
    setLoading(true);
    fetch(SUPABASE_URL + "/rest/v1/commodity_prices?commodity=eq." + c + "&order=date.desc&limit=60", { headers: HEADERS })
      .then(function(res) { return res.json(); })
      .then(function(rows) { setData(rows); setLastUpdated(new Date()); setLoading(false); })
      .catch(function(e) { console.error(e); setLoading(false); });
  }

  useEffect(function() {
    loadData(commodity);
    var interval = setInterval(function() { loadData(commodity); }, 5 * 60 * 1000);
    return function() { clearInterval(interval); };
  }, [commodity]);

  // ── Derived Data ──────────────────────────────────────────────
  var latest = data[0];
  var prev = data[1];
  var cbotDelta = latest && prev ? latest.closing_cbot - prev.closing_cbot : 0;
  var cbotPct = prev && prev.closing_cbot ? (cbotDelta / prev.closing_cbot) * 100 : 0;
  var argDelta = latest && prev ? latest.arg_price - prev.arg_price : 0;
  var alertActive = Math.abs(cbotPct) >= 2;

  var prices = data.slice().reverse().map(function(d) { return d.closing_cbot; });
  var dates = data.slice().reverse().map(function(d) { return d.date ? d.date.slice(5) : ""; });

  var ma7 = calcMA(prices, 7);
  var ma21 = calcMA(prices, 21);
  var rsiArr = calcRSI(prices, 14);
  var bollArr = calcBollinger(prices, 20, 2);
  var macdArr = calcMACD(prices);
  var srLevels = calcSupportResistance(prices);
  var zScore = calcZScore(prices);
  var trend = getTrend(prices);

  var currentRSI = rsiArr[rsiArr.length - 1];
  var currentMACD = macdArr[macdArr.length - 1];
  var currentBoll = bollArr[bollArr.length - 1];

  // Signal logic
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
      macd: macdArr[i].macd !== null ? parseFloat(macdArr[i].macd.toFixed(4)) : null,
      signal: macdArr[i].signal !== null ? parseFloat(macdArr[i].signal.toFixed(4)) : null,
      histogram: macdArr[i].histogram !== null ? parseFloat(macdArr[i].histogram.toFixed(4)) : null,
      arg: data[data.length - 1 - i] ? Math.round(data[data.length - 1 - i].arg_price) : null,
      brz: data[data.length - 1 - i] ? Math.round(data[data.length - 1 - i].brz_price) : null,
      ret: data[data.length - 1 - i] ? parseFloat((data[data.length - 1 - i].fut_ret * 100).toFixed(2)) : null,
    };
  });

  // ── AI Analysis ───────────────────────────────────────────────
  function runAIAnalysis() {
    setAiLoading(true);
    setAiAnalysis("");
    setActiveTab("analysis");

    var last5 = data.slice(0, 5).map(function(d) {
      return d.date + ": close=" + d.closing_cbot + ", high=" + d.cbot_high + ", low=" + d.cbot_low + ", ret=" + (d.fut_ret * 100).toFixed(2) + "%";
    }).join("\n");

    var prompt = "You are a commodity trading analyst. Analyze this CBOT " + commodity + " futures data and explain in 3-4 sentences: (1) what happened to the price recently, (2) what the technical indicators suggest (RSI=" + (currentRSI ? currentRSI.toFixed(1) : "N/A") + ", MACD histogram=" + (currentMACD && currentMACD.histogram ? currentMACD.histogram.toFixed(4) : "N/A") + ", Z-score=" + zScore.toFixed(2) + ", trend=" + trend + ", support=" + srLevels.support.toFixed(2) + ", resistance=" + srLevels.resistance.toFixed(2) + "), (3) a brief outlook. Be concise and professional.\n\nRecent data:\n" + last5;

    fetch("https://super-violet-316c.zeina-sherif-0ad.workers.dev", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompt })
    })
      .then(function(res) { return res.json(); })
      .then(function(d) {
        var text = d.result || "Analysis unavailable.";
        setAiAnalysis(text);
        setAiLoading(false);
      })
      .catch(function(e) {
        setAiAnalysis("Could not load AI analysis. Please try again.");
        setAiLoading(false);
      });
  }

  var currentCommodity = COMMODITIES.find(function(c) { return c.id === commodity; });

  // ── Render ────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "#080f18", color: "#e8edf2", fontFamily: "'Segoe UI', sans-serif" }}>

      {/* Sidebar */}
      <div style={{ position: "fixed", left: 0, top: 0, bottom: 0, width: 220, background: "#0b1520", borderRight: "1px solid #1a2d45", display: "flex", flexDirection: "column", zIndex: 100 }}>
        <div style={{ padding: "24px 20px 16px" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.15em", color: "#4a7fa5", textTransform: "uppercase", marginBottom: 4 }}>AdmMedSofts</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#e8edf2", lineHeight: 1.2 }}>Commodity<br />Intelligence</div>
        </div>

        <div style={{ padding: "8px 12px", marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: "#4a7fa5", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8, paddingLeft: 8 }}>Markets</div>
          {COMMODITIES.map(function(c) {
            return (
              <button key={c.id} onClick={function() { setCommodity(c.id); }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, border: "none", cursor: "pointer", marginBottom: 2, background: commodity === c.id ? "#1a3a5c" : "transparent", color: commodity === c.id ? "#64b5f6" : "#7a9bb5", fontWeight: commodity === c.id ? 600 : 400, fontSize: 13 }}>
                <span style={{ fontSize: 16 }}>{c.icon}</span>{c.label}
                {c.id !== "corn" && <span style={{ marginLeft: "auto", fontSize: 10, background: "#1a2d45", color: "#4a7fa5", padding: "2px 6px", borderRadius: 4 }}>Soon</span>}
              </button>
            );
          })}
        </div>

        <div style={{ padding: "8px 12px", marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: "#4a7fa5", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8, paddingLeft: 8 }}>Views</div>
          {[["overview", "Overview"], ["charts", "Price Charts"], ["analysis", "🧠 AI Analysis"], ["returns", "Futures Returns"], ["table", "Raw Data"]].map(function(item) {
            var id = item[0]; var label = item[1];
            return (
              <button key={id} onClick={function() { setActiveTab(id); }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, border: "none", cursor: "pointer", marginBottom: 2, background: activeTab === id ? "#1a3a5c" : "transparent", color: activeTab === id ? "#64b5f6" : "#7a9bb5", fontWeight: activeTab === id ? 600 : 400, fontSize: 13 }}>
                {label}
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: "auto", padding: "16px 20px", borderTop: "1px solid #1a2d45" }}>
          <button onClick={function() { loadData(commodity); }} style={{ width: "100%", padding: "8px", borderRadius: 8, border: "1px solid #1a3a5c", background: "transparent", color: "#64b5f6", fontSize: 12, cursor: "pointer", marginBottom: 8 }}>
            ↻ Refresh data
          </button>
          <button onClick={runAIAnalysis} style={{ width: "100%", padding: "8px", borderRadius: 8, border: "none", background: "#1a3a5c", color: "#64b5f6", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
            🧠 Run AI Analysis
          </button>
          {lastUpdated && <div style={{ fontSize: 10, color: "#4a7fa5", marginTop: 6, textAlign: "center" }}>Updated {lastUpdated.toLocaleTimeString()}</div>}
        </div>
      </div>

      {/* Main */}
      <div style={{ marginLeft: 220, padding: "28px 32px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: "#e8edf2" }}>
              {currentCommodity ? currentCommodity.icon : ""} {currentCommodity ? currentCommodity.label : ""} Market
            </h1>
            <div style={{ fontSize: 13, color: "#4a7fa5", marginTop: 4 }}>CBOT Futures · EGP Local Prices · {latest ? latest.date : "—"}</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {alertActive && (
              <div style={{ background: "#1a0a0a", border: "1px solid #c62828", borderRadius: 8, padding: "8px 14px", fontSize: 12, color: "#ef9a9a" }}>
                ⚠ Price alert: {fmt(Math.abs(cbotPct))}% move
              </div>
            )}
            <div style={{ background: "#0b1520", border: "1px solid #1a2d45", borderRadius: 8, padding: "8px 14px", fontSize: 12, color: "#4a7fa5" }}>
              {data.length} data points
            </div>
            <div style={{ background: trend === "bullish" ? "#1b3a1b" : trend === "bearish" ? "#3a1b1b" : "#1a2d45", border: "1px solid " + (trend === "bullish" ? "#2e7d32" : trend === "bearish" ? "#c62828" : "#1a3a5c"), borderRadius: 8, padding: "8px 14px", fontSize: 12, color: trend === "bullish" ? "#81c784" : trend === "bearish" ? "#ef9a9a" : "#64b5f6", fontWeight: 600 }}>
              {trend === "bullish" ? "▲ Bullish" : trend === "bearish" ? "▼ Bearish" : "→ Neutral"}
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300, color: "#4a7fa5", fontSize: 14 }}>Loading market data...</div>
        ) : !latest ? (
          <div style={{ textAlign: "center", padding: 60, color: "#4a7fa5" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
            <div>No data yet for {commodity}</div>
          </div>
        ) : (
          <div>

            {/* KPI Cards */}
            {(activeTab === "overview" || activeTab === "charts" || activeTab === "analysis") && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
                {[
                  { label: "CBOT Close", value: fmt(latest.closing_cbot), unit: "¢/bu", delta: cbotDelta, pct: cbotPct, accent: "#64b5f6" },
                  { label: "Day Range", value: fmt(latest.cbot_low) + " – " + fmt(latest.cbot_high), unit: "¢/bu", accent: "#80cbc4" },
                  { label: "ARG Local Price", value: fmtK(latest.arg_price), unit: "EGP", delta: argDelta, accent: "#a5d6a7" },
                  { label: "Dollar Rate", value: fmt(latest.dollar_rate), unit: "EGP/USD", accent: "#ce93d8" },
                ].map(function(card, i) {
                  return (
                    <div key={i} style={{ background: "#0b1520", border: "1px solid #1a2d45", borderRadius: 12, padding: "18px 20px", borderTop: "3px solid " + card.accent }}>
                      <div style={{ fontSize: 11, color: "#4a7fa5", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>{card.label}</div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: "#e8edf2", lineHeight: 1 }}>{card.value}</div>
                      <div style={{ fontSize: 11, color: "#4a7fa5", marginTop: 4 }}>{card.unit}</div>
                      {card.delta !== undefined && (
                        <div style={{ marginTop: 8, fontSize: 12, color: card.delta >= 0 ? "#81c784" : "#e57373", fontWeight: 600 }}>
                          {card.delta >= 0 ? "▲" : "▼"} {fmt(Math.abs(card.delta))}{card.pct !== undefined && " (" + fmt(Math.abs(card.pct)) + "%)"}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Overview */}
            {activeTab === "overview" && (
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
                <div style={{ background: "#0b1520", border: "1px solid #1a2d45", borderRadius: 12, padding: "20px 20px 12px" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#7a9bb5", marginBottom: 16 }}>CBOT Close + MA7 + MA21</div>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1a2d45" />
                      <XAxis dataKey="date" tick={{ fill: "#4a7fa5", fontSize: 11 }} />
                      <YAxis tick={{ fill: "#4a7fa5", fontSize: 11 }} domain={["auto", "auto"]} />
                      <Tooltip content={<CustomTooltip />} />
                      <Line type="monotone" dataKey="close" stroke="#64b5f6" strokeWidth={2} dot={{ r: 2 }} name="Close" />
                      <Line type="monotone" dataKey="ma7" stroke="#ffb74d" strokeWidth={1.5} dot={false} name="MA7" strokeDasharray="4 2" />
                      <Line type="monotone" dataKey="ma21" stroke="#ce93d8" strokeWidth={1.5} dot={false} name="MA21" strokeDasharray="4 2" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {[
                    { label: "RSI (14)", value: currentRSI ? currentRSI.toFixed(1) : "—", unit: currentRSI ? (currentRSI < 30 ? "Oversold 🟢" : currentRSI > 70 ? "Overbought 🔴" : "Neutral") : "", color: currentRSI ? (currentRSI < 30 ? "#81c784" : currentRSI > 70 ? "#ef9a9a" : "#64b5f6") : "#64b5f6" },
                    { label: "Z-Score", value: zScore.toFixed(2), unit: Math.abs(zScore) > 2 ? "Extreme move!" : "Normal range", color: Math.abs(zScore) > 2 ? "#ef9a9a" : "#80cbc4" },
                    { label: "Support", value: fmt(srLevels.support), unit: "¢/bu floor", color: "#81c784" },
                    { label: "Resistance", value: fmt(srLevels.resistance), unit: "¢/bu ceiling", color: "#ef9a9a" },
                    { label: "Overall Signal", value: overallSignal, unit: buyCount + " buy / " + sellCount + " sell signals", color: overallSignal === "BUY" ? "#81c784" : overallSignal === "SELL" ? "#ef9a9a" : "#64b5f6" },
                  ].map(function(s, i) {
                    return (
                      <div key={i} style={{ background: "#0b1520", border: "1px solid #1a2d45", borderRadius: 10, padding: "12px 16px", flex: 1 }}>
                        <div style={{ fontSize: 11, color: "#4a7fa5", textTransform: "uppercase", letterSpacing: "0.08em" }}>{s.label}</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: s.color, marginTop: 2 }}>{s.value}</div>
                        <div style={{ fontSize: 11, color: "#4a7fa5" }}>{s.unit}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Charts */}
            {activeTab === "charts" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ background: "#0b1520", border: "1px solid #1a2d45", borderRadius: 12, padding: "20px 20px 12px" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#7a9bb5", marginBottom: 16 }}>Price + Bollinger Bands</div>
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1a2d45" />
                      <XAxis dataKey="date" tick={{ fill: "#4a7fa5", fontSize: 11 }} />
                      <YAxis tick={{ fill: "#4a7fa5", fontSize: 11 }} domain={["auto", "auto"]} />
                      <Tooltip content={<CustomTooltip />} />
                      <Line type="monotone" dataKey="upper" stroke="#26a69a" strokeWidth={1} dot={false} name="BB Upper" strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="close" stroke="#64b5f6" strokeWidth={2.5} dot={{ r: 2 }} name="Close" />
                      <Line type="monotone" dataKey="lower" stroke="#ef5350" strokeWidth={1} dot={false} name="BB Lower" strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="ma21" stroke="#ce93d8" strokeWidth={1} dot={false} name="MA21 (mid)" strokeDasharray="5 3" />
                      <ReferenceLine y={srLevels.support} stroke="#81c784" strokeDasharray="5 5" label={{ value: "Support", fill: "#81c784", fontSize: 10 }} />
                      <ReferenceLine y={srLevels.resistance} stroke="#ef9a9a" strokeDasharray="5 5" label={{ value: "Resistance", fill: "#ef9a9a", fontSize: 10 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div style={{ background: "#0b1520", border: "1px solid #1a2d45", borderRadius: 12, padding: "20px 20px 12px" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#7a9bb5", marginBottom: 16 }}>RSI (14)</div>
                    <ResponsiveContainer width="100%" height={160}>
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1a2d45" />
                        <XAxis dataKey="date" tick={{ fill: "#4a7fa5", fontSize: 10 }} />
                        <YAxis domain={[0, 100]} tick={{ fill: "#4a7fa5", fontSize: 10 }} />
                        <Tooltip content={<CustomTooltip />} />
                        <ReferenceLine y={70} stroke="#ef5350" strokeDasharray="4 4" />
                        <ReferenceLine y={30} stroke="#81c784" strokeDasharray="4 4" />
                        <Line type="monotone" dataKey="rsi" stroke="#ffb74d" strokeWidth={2} dot={false} name="RSI" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ background: "#0b1520", border: "1px solid #1a2d45", borderRadius: 12, padding: "20px 20px 12px" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#7a9bb5", marginBottom: 16 }}>MACD</div>
                    <ResponsiveContainer width="100%" height={160}>
                      <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1a2d45" />
                        <XAxis dataKey="date" tick={{ fill: "#4a7fa5", fontSize: 10 }} />
                        <YAxis tick={{ fill: "#4a7fa5", fontSize: 10 }} />
                        <Tooltip content={<CustomTooltip />} />
                        <ReferenceLine y={0} stroke="#1a2d45" strokeWidth={2} />
                        <Bar dataKey="histogram" name="Histogram" fill="#64b5f6" radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {/* AI Analysis */}
            {activeTab === "analysis" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* Signal cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
                  {[
                    { label: "Overall Signal", value: overallSignal, sub: buyCount + "B / " + sellCount + "S", color: overallSignal === "BUY" ? "#81c784" : overallSignal === "SELL" ? "#ef9a9a" : "#64b5f6" },
                    { label: "RSI Signal", value: rsiSignal, sub: "RSI = " + (currentRSI ? currentRSI.toFixed(1) : "—"), color: rsiSignal === "BUY" ? "#81c784" : rsiSignal === "SELL" ? "#ef9a9a" : "#64b5f6" },
                    { label: "MACD Signal", value: macdSignal, sub: currentMACD && currentMACD.histogram ? (currentMACD.histogram > 0 ? "Momentum ▲" : "Momentum ▼") : "—", color: macdSignal === "BUY" ? "#81c784" : macdSignal === "SELL" ? "#ef9a9a" : "#64b5f6" },
                    { label: "Trend Signal", value: trendSignal, sub: trend + " (5-day)", color: trendSignal === "BUY" ? "#81c784" : trendSignal === "SELL" ? "#ef9a9a" : "#64b5f6" },
                  ].map(function(card, i) {
                    return (
                      <div key={i} style={{ background: "#0b1520", border: "1px solid #1a2d45", borderRadius: 12, padding: "18px 20px", textAlign: "center" }}>
                        <div style={{ fontSize: 11, color: "#4a7fa5", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>{card.label}</div>
                        <SignalBadge signal={card.value} />
                        <div style={{ fontSize: 11, color: "#4a7fa5", marginTop: 8 }}>{card.sub}</div>
                      </div>
                    );
                  })}
                </div>

                {/* Stats row */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
                  {[
                    { label: "Z-Score", value: zScore.toFixed(2), sub: Math.abs(zScore) > 2 ? "⚠ Extreme" : "Normal", color: Math.abs(zScore) > 2 ? "#ef9a9a" : "#80cbc4" },
                    { label: "Support", value: fmt(srLevels.support), sub: "¢/bu floor", color: "#81c784" },
                    { label: "Resistance", value: fmt(srLevels.resistance), sub: "¢/bu ceiling", color: "#ef9a9a" },
                    { label: "Bollinger", value: currentBoll.upper ? (latest.closing_cbot > currentBoll.upper ? "Above Upper" : latest.closing_cbot < currentBoll.lower ? "Below Lower" : "Inside Band") : "—", sub: currentBoll.upper ? "Upper: " + fmt(currentBoll.upper) : "", color: "#ce93d8" },
                  ].map(function(card, i) {
                    return (
                      <div key={i} style={{ background: "#0b1520", border: "1px solid #1a2d45", borderRadius: 12, padding: "16px 20px" }}>
                        <div style={{ fontSize: 11, color: "#4a7fa5", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{card.label}</div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: card.color }}>{card.value}</div>
                        <div style={{ fontSize: 11, color: "#4a7fa5" }}>{card.sub}</div>
                      </div>
                    );
                  })}
                </div>

                {/* AI box */}
                <div style={{ background: "#0b1520", border: "1px solid #1a3a5c", borderRadius: 12, padding: "20px 24px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#64b5f6" }}>🧠 AI Market Analysis</div>
                    <button onClick={runAIAnalysis} style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid #1a3a5c", background: "#0d2035", color: "#64b5f6", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                      {aiLoading ? "Analyzing..." : "↻ Refresh Analysis"}
                    </button>
                  </div>
                  {aiLoading ? (
                    <div style={{ color: "#4a7fa5", fontSize: 13, padding: "20px 0", textAlign: "center" }}>
                      <div style={{ marginBottom: 8, fontSize: 20 }}>🔍</div>
                      Analyzing price movements, indicators, and market context...
                    </div>
                  ) : aiAnalysis ? (
                    <div style={{ color: "#c8d8e8", fontSize: 14, lineHeight: 1.8, whiteSpace: "pre-wrap" }}>{aiAnalysis}</div>
                  ) : (
                    <div style={{ color: "#4a7fa5", fontSize: 13, textAlign: "center", padding: "20px 0" }}>
                      Click <strong style={{ color: "#64b5f6" }}>🧠 Run AI Analysis</strong> in the sidebar to get an AI-powered explanation of price movements.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Returns */}
            {activeTab === "returns" && (
              <div style={{ background: "#0b1520", border: "1px solid #1a2d45", borderRadius: 12, padding: "20px 20px 12px" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#7a9bb5", marginBottom: 16 }}>Daily Futures Returns (%)</div>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a2d45" />
                    <XAxis dataKey="date" tick={{ fill: "#4a7fa5", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#4a7fa5", fontSize: 11 }} tickFormatter={function(v) { return v + "%"; }} />
                    <Tooltip content={<CustomTooltip />} />
                    <ReferenceLine y={0} stroke="#1a2d45" strokeWidth={2} />
                    <Bar dataKey="ret" name="Return (%)" fill="#64b5f6" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Table */}
            {activeTab === "table" && (
              <div style={{ background: "#0b1520", border: "1px solid #1a2d45", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "16px 20px", borderBottom: "1px solid #1a2d45", fontSize: 13, fontWeight: 600, color: "#7a9bb5" }}>
                  Raw Data — {data.length} records
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "#0d1e30" }}>
                        {["Date", "Close ¢/bu", "Low", "High", "Dollar Rate", "ARG Price", "BRZ Price", "Fut. Return"].map(function(h) {
                          return <th key={h} style={{ padding: "10px 14px", textAlign: "left", color: "#4a7fa5", fontWeight: 500, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>{h}</th>;
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {data.map(function(row, i) {
                        var retColor = row.fut_ret > 0 ? "#81c784" : row.fut_ret < 0 ? "#e57373" : "#4a7fa5";
                        return (
                          <tr key={i} style={{ borderTop: "1px solid #111e2d", background: i === 0 ? "#0d2035" : "transparent" }}>
                            <td style={{ padding: "9px 14px", color: i === 0 ? "#64b5f6" : "#7a9bb5", fontWeight: i === 0 ? 600 : 400 }}>{row.date}</td>
                            <td style={{ padding: "9px 14px", color: "#e8edf2", fontWeight: 600 }}>{fmt(row.closing_cbot)}</td>
                            <td style={{ padding: "9px 14px", color: "#7a9bb5" }}>{fmt(row.cbot_low)}</td>
                            <td style={{ padding: "9px 14px", color: "#7a9bb5" }}>{fmt(row.cbot_high)}</td>
                            <td style={{ padding: "9px 14px", color: "#7a9bb5" }}>{fmt(row.dollar_rate)}</td>
                            <td style={{ padding: "9px 14px", color: "#a5d6a7" }}>{Math.round(row.arg_price).toLocaleString()}</td>
                            <td style={{ padding: "9px 14px", color: "#ffb74d" }}>{Math.round(row.brz_price).toLocaleString()}</td>
                            <td style={{ padding: "9px 14px", color: retColor, fontWeight: 600 }}>{fmt(row.fut_ret * 100, 2)}%</td>
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
