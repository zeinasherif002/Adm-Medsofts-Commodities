import { useState, useEffect, useCallback } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

const SUPABASE_URL = "https://cupcsspfmkgbcovtgszm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1cGNzc3BmbWtnYmNvdnRnc3ptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzI4ODMsImV4cCI6MjA5NDg0ODg4M30.Y8o09mcvdJuSSfgsVGnhoUyRpIUPVl8-gkigJXXee8E";

const HEADERS = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

async function fetchPrices(commodity = "corn", limit = 300) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/commodity_prices?commodity=eq.${commodity}&order=date.desc&limit=${limit}`,
    { headers: HEADERS }
  );
  return res.json();
}

const fmt = (n, d = 2) => Number(n).toFixed(d);
const fmtK = (n) => n >= 1000 ? (n / 1000).toFixed(1) + "k" : fmt(n);

const COMMODITIES = [
  { id: "corn", label: "Corn", icon: "🌽" },
  { id: "wheat", label: "Wheat", icon: "🌾" },
  { id: "soybeans", label: "Soybeans", icon: "🫘" },
];

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0f1923", border: "1px solid #1e3a5f", borderRadius: 8, padding: "10px 14px", fontSize: 12 }}>
      <p style={{ color: "#64b5f6", marginBottom: 6, fontWeight: 600 }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color, margin: "2px 0" }}>{p.name}: <strong>{p.value}</strong></p>
      ))}
    </div>
  );
};

export default function App() {
  const [commodity, setCommodity] = useState("corn");
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");
  const [lastUpdated, setLastUpdated] = useState(null);

  // ✅ FIXED: useCallback defined BEFORE useEffect
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchPrices(commodity, 30);
      setData(rows);
      setLastUpdated(new Date());
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, [commodity]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const interval = setInterval(load, 5 * 60 * 1000); return () => clearInterval(interval); }, [load]);

  const latest = data[data.length - 1];
  const prev = data[data.length - 2];
  const cbotDelta = latest && prev ? latest.closing_cbot - prev.closing_cbot : 0;
  const cbotPct = prev?.closing_cbot ? (cbotDelta / prev.closing_cbot) * 100 : 0;
  const argDelta = latest && prev ? latest.arg_price - prev.arg_price : 0;

  const chartData = data.map(d => ({
    date: d.date?.slice(5),
    close: +fmt(d.closing_cbot),
    low: +fmt(d.cbot_low),
    high: +fmt(d.cbot_high),
    arg: Math.round(d.arg_price),
    brz: Math.round(d.brz_price),
    ret: +fmt(d.fut_ret * 100, 2),
  }));

  const isUp = cbotDelta >= 0;
  const alertActive = Math.abs(cbotPct) >= 2;

  return (
    <div style={{ minHeight: "100vh", background: "#080f18", color: "#e8edf2", fontFamily: "'DM Sans', 'Segoe UI', sans-serif" }}>

      {/* Sidebar */}
      <div style={{ position: "fixed", left: 0, top: 0, bottom: 0, width: 220, background: "#0b1520", borderRight: "1px solid #1a2d45", display: "flex", flexDirection: "column", zIndex: 100 }}>
        <div style={{ padding: "24px 20px 16px" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.15em", color: "#4a7fa5", textTransform: "uppercase", marginBottom: 4 }}>AdmMedSofts</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#e8edf2", lineHeight: 1.2 }}>Commodity<br />Intelligence</div>
        </div>

        <div style={{ padding: "8px 12px", marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: "#4a7fa5", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8, paddingLeft: 8 }}>Markets</div>
          {COMMODITIES.map(c => (
            <button key={c.id} onClick={() => setCommodity(c.id)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, border: "none", cursor: "pointer", marginBottom: 2, background: commodity === c.id ? "#1a3a5c" : "transparent", color: commodity === c.id ? "#64b5f6" : "#7a9bb5", fontWeight: commodity === c.id ? 600 : 400, fontSize: 13, transition: "all 0.15s" }}>
              <span style={{ fontSize: 16 }}>{c.icon}</span>{c.label}
              {c.id !== "corn" && <span style={{ marginLeft: "auto", fontSize: 10, background: "#1a2d45", color: "#4a7fa5", padding: "2px 6px", borderRadius: 4 }}>Soon</span>}
            </button>
          ))}
        </div>

        <div style={{ padding: "8px 12px", marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: "#4a7fa5", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8, paddingLeft: 8 }}>Views</div>
          {[["overview", "Overview"], ["charts", "Price Charts"], ["returns", "Futures Returns"], ["table", "Raw Data"]].map(([id, label]) => (
            <button key={id} onClick={() => setActiveTab(id)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, border: "none", cursor: "pointer", marginBottom: 2, background: activeTab === id ? "#1a3a5c" : "transparent", color: activeTab === id ? "#64b5f6" : "#7a9bb5", fontWeight: activeTab === id ? 600 : 400, fontSize: 13 }}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ marginTop: "auto", padding: "16px 20px", borderTop: "1px solid #1a2d45" }}>
          <button onClick={load} style={{ width: "100%", padding: "8px", borderRadius: 8, border: "1px solid #1a3a5c", background: "transparent", color: "#64b5f6", fontSize: 12, cursor: "pointer" }}>
            ↻ Refresh data
          </button>
          {lastUpdated && <div style={{ fontSize: 10, color: "#4a7fa5", marginTop: 6, textAlign: "center" }}>
            Updated {lastUpdated.toLocaleTimeString()}
          </div>}
        </div>
      </div>

      {/* Main content */}
      <div style={{ marginLeft: 220, padding: "28px 32px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: "#e8edf2" }}>
              {COMMODITIES.find(c => c.id === commodity)?.icon} {COMMODITIES.find(c => c.id === commodity)?.label} Market
            </h1>
            <div style={{ fontSize: 13, color: "#4a7fa5", marginTop: 4 }}>
              CBOT Futures · EGP Local Prices · {latest?.date || "—"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {alertActive && (
              <div style={{ background: "#1a0a0a", border: "1px solid #c62828", borderRadius: 8, padding: "8px 14px", fontSize: 12, color: "#ef9a9a", display: "flex", alignItems: "center", gap: 6 }}>
                ⚠ Price alert: {fmt(Math.abs(cbotPct))}% move
              </div>
            )}
            <div style={{ background: "#0b1520", border: "1px solid #1a2d45", borderRadius: 8, padding: "8px 14px", fontSize: 12, color: "#4a7fa5" }}>
              {data.length} data points loaded
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300, color: "#4a7fa5", fontSize: 14 }}>
            Loading market data...
          </div>
        ) : !latest ? (
          <div style={{ textAlign: "center", padding: 60, color: "#4a7fa5" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
            <div style={{ fontSize: 16, marginBottom: 8 }}>No data yet for {commodity}</div>
            <div style={{ fontSize: 13 }}>Upload your Excel file using the uploader script to get started.</div>
          </div>
        ) : (
          <>
            {(activeTab === "overview" || activeTab === "charts") && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
                {[
                  { label: "CBOT Close", value: fmt(latest.closing_cbot), unit: "¢/bu", delta: cbotDelta, pct: cbotPct, accent: "#64b5f6" },
                  { label: "Day Range", value: `${fmt(latest.cbot_low)} – ${fmt(latest.cbot_high)}`, unit: "¢/bu", accent: "#80cbc4" },
                  { label: "ARG Local Price", value: fmtK(latest.arg_price), unit: "EGP", delta: argDelta, accent: "#a5d6a7" },
                  { label: "Dollar Rate", value: fmt(latest.dollar_rate), unit: "EGP/USD", accent: "#ce93d8" },
                ].map((card, i) => (
                  <div key={i} style={{ background: "#0b1520", border: "1px solid #1a2d45", borderRadius: 12, padding: "18px 20px", borderTop: `3px solid ${card.accent}` }}>
                    <div style={{ fontSize: 11, color: "#4a7fa5", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>{card.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: "#e8edf2", lineHeight: 1 }}>{card.value}</div>
                    <div style={{ fontSize: 11, color: "#4a7fa5", marginTop: 4 }}>{card.unit}</div>
                    {card.delta !== undefined && (
                      <div style={{ marginTop: 8, fontSize: 12, color: card.delta >= 0 ? "#81c784" : "#e57373", fontWeight: 600 }}>
                        {card.delta >= 0 ? "▲" : "▼"} {fmt(Math.abs(card.delta))}
                        {card.pct !== undefined && ` (${fmt(Math.abs(card.pct))}%)`}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {activeTab === "overview" && (
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
                <div style={{ background: "#0b1520", border: "1px solid #1a2d45", borderRadius: 12, padding: "20px 20px 12px" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#7a9bb5", marginBottom: 16 }}>CBOT Close Price Trend</div>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1a2d45" />
                      <XAxis dataKey="date" tick={{ fill: "#4a7fa5", fontSize: 11 }} />
                      <YAxis tick={{ fill: "#4a7fa5", fontSize: 11 }} domain={["auto", "auto"]} />
                      <Tooltip content={<CustomTooltip />} />
                      <Line type="monotone" dataKey="close" stroke="#64b5f6" strokeWidth={2} dot={{ r: 3, fill: "#64b5f6" }} name="Close (¢/bu)" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {[
                    { label: "BRZ Local Price", value: fmtK(latest.brz_price), unit: "EGP equiv.", color: "#ffb74d" },
                    { label: "Live Modifier", value: fmt(latest.modifier_live, 4), unit: "adjustment factor", color: "#ce93d8" },
                    { label: "Futures Return", value: `${fmt(latest.fut_ret * 100, 2)}%`, unit: "daily", color: latest.fut_ret >= 0 ? "#81c784" : "#e57373" },
                    { label: "Smoothed Return", value: `${fmt(latest.fut_ret_smooth * 100, 2)}%`, unit: "7-day avg", color: "#80cbc4" },
                  ].map((s, i) => (
                    <div key={i} style={{ background: "#0b1520", border: "1px solid #1a2d45", borderRadius: 10, padding: "14px 16px", flex: 1 }}>
                      <div style={{ fontSize: 11, color: "#4a7fa5", textTransform: "uppercase", letterSpacing: "0.08em" }}>{s.label}</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: s.color, marginTop: 4 }}>{s.value}</div>
                      <div style={{ fontSize: 11, color: "#4a7fa5" }}>{s.unit}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === "charts" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ background: "#0b1520", border: "1px solid #1a2d45", borderRadius: 12, padding: "20px 20px 12px" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#7a9bb5", marginBottom: 16 }}>CBOT Close — Full History</div>
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1a2d45" />
                      <XAxis dataKey="date" tick={{ fill: "#4a7fa5", fontSize: 11 }} />
                      <YAxis tick={{ fill: "#4a7fa5", fontSize: 11 }} domain={["auto", "auto"]} />
                      <Tooltip content={<CustomTooltip />} />
                      <Line type="monotone" dataKey="high" stroke="#26a69a" strokeWidth={1} dot={false} name="High" strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="close" stroke="#64b5f6" strokeWidth={2.5} dot={{ r: 3 }} name="Close (¢/bu)" />
                      <Line type="monotone" dataKey="low" stroke="#ef5350" strokeWidth={1} dot={false} name="Low" strokeDasharray="3 3" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ background: "#0b1520", border: "1px solid #1a2d45", borderRadius: 12, padding: "20px 20px 12px" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#7a9bb5", marginBottom: 16 }}>ARG vs BRZ Local Prices (EGP)</div>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1a2d45" />
                      <XAxis dataKey="date" tick={{ fill: "#4a7fa5", fontSize: 11 }} />
                      <YAxis tick={{ fill: "#4a7fa5", fontSize: 11 }} tickFormatter={v => (v / 1000).toFixed(0) + "k"} />
                      <Tooltip content={<CustomTooltip />} />
                      <Line type="monotone" dataKey="arg" stroke="#64b5f6" strokeWidth={2} dot={{ r: 3 }} name="ARG Price" />
                      <Line type="monotone" dataKey="brz" stroke="#ffb74d" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="5 3" name="BRZ Price" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {activeTab === "returns" && (
              <div style={{ background: "#0b1520", border: "1px solid #1a2d45", borderRadius: 12, padding: "20px 20px 12px" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#7a9bb5", marginBottom: 16 }}>Daily Futures Returns (%)</div>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a2d45" />
                    <XAxis dataKey="date" tick={{ fill: "#4a7fa5", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#4a7fa5", fontSize: 11 }} tickFormatter={v => v + "%"} />
                    <Tooltip content={<CustomTooltip />} />
                    <ReferenceLine y={0} stroke="#1a2d45" strokeWidth={2} />
                    <Bar dataKey="ret" name="Return (%)" fill="#64b5f6" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {activeTab === "table" && (
              <div style={{ background: "#0b1520", border: "1px solid #1a2d45", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "16px 20px", borderBottom: "1px solid #1a2d45", fontSize: 13, fontWeight: 600, color: "#7a9bb5" }}>
                  Raw Data — {data.length} records
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "#0d1e30" }}>
                        {["Date", "Close ¢/bu", "Low", "High", "Dollar Rate", "ARG Price", "BRZ Price", "Fut. Return"].map(h => (
                          <th key={h} style={{ padding: "10px 14px", textAlign: "left", color: "#4a7fa5", fontWeight: 500, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...data].reverse().map((row, i) => {
                        const retColor = row.fut_ret > 0 ? "#81c784" : row.fut_ret < 0 ? "#e57373" : "#4a7fa5";
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
          </>
        )}
      </div>
    </div>
  );
}
