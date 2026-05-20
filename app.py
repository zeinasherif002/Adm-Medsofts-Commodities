import streamlit as st
import pandas as pd
import plotly.graph_objects as go
import plotly.express as px
from datetime import datetime, date
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import os
import json

# ─────────────────────────────────────────
# Page config
# ─────────────────────────────────────────
st.set_page_config(
    page_title="AdmMedSofts — Commodity Prices",
    page_icon="📊",
    layout="wide",
)

# ─────────────────────────────────────────
# Custom CSS
# ─────────────────────────────────────────
st.markdown("""
<style>
    .metric-card {
        background: #f8f9fa;
        border-radius: 12px;
        padding: 20px 24px;
        border: 1px solid #e9ecef;
        margin-bottom: 8px;
    }
    .metric-label { font-size: 13px; color: #6c757d; font-weight: 500; margin-bottom: 4px; }
    .metric-value { font-size: 28px; font-weight: 700; color: #212529; }
    .metric-delta-up   { font-size: 13px; color: #28a745; }
    .metric-delta-down { font-size: 13px; color: #dc3545; }
    .metric-delta-flat { font-size: 13px; color: #6c757d; }
    .alert-box {
        background: #fff3cd; border-left: 4px solid #ffc107;
        border-radius: 6px; padding: 12px 16px; margin: 6px 0;
    }
    .alert-box-danger {
        background: #f8d7da; border-left: 4px solid #dc3545;
        border-radius: 6px; padding: 12px 16px; margin: 6px 0;
    }
    .section-title { font-size: 18px; font-weight: 600; margin: 16px 0 8px; color: #212529; }
    [data-testid="stSidebar"] { background: #1a1a2e; }
    [data-testid="stSidebar"] * { color: #e0e0e0 !important; }
    [data-testid="stSidebar"] .stSelectbox label,
    [data-testid="stSidebar"] .stNumberInput label,
    [data-testid="stSidebar"] .stTextInput label { color: #adb5bd !important; }
</style>
""", unsafe_allow_html=True)

# ─────────────────────────────────────────
# Sidebar — configuration
# ─────────────────────────────────────────
with st.sidebar:
    st.image("https://via.placeholder.com/200x50/1a1a2e/ffffff?text=AdmMedSofts", use_column_width=True)
    st.markdown("---")
    st.markdown("### 📁 Data")
    uploaded_file = st.file_uploader(
        "Upload forecast file (Excel/CSV)",
        type=["xlsx", "xls", "csv"],
        help="Upload your model's output file"
    )
    st.markdown("---")
    st.markdown("### 🔔 Alert thresholds")
    price_threshold = st.number_input("Price change alert (%)", min_value=0.1, max_value=20.0, value=2.0, step=0.1)
    forecast_error_threshold = st.number_input("Forecast vs actual alert (%)", min_value=0.1, max_value=20.0, value=3.0, step=0.1)
    st.markdown("---")
    st.markdown("### 📧 Email settings")
    smtp_server   = st.text_input("SMTP server",   value="smtp.gmail.com")
    smtp_port     = st.number_input("SMTP port",   value=587, step=1)
    sender_email  = st.text_input("Sender email",  placeholder="your@gmail.com")
    sender_pass   = st.text_input("App password",  type="password", placeholder="Gmail app password")
    recipients_raw = st.text_area("Recipients (one per line)", placeholder="trader1@company.com\ntrader2@company.com")
    st.markdown("---")
    st.markdown("### 🌾 Commodities shown")
    show_corn      = st.checkbox("Corn",      value=True)
    show_wheat     = st.checkbox("Wheat",     value=True)
    show_soybeans  = st.checkbox("Soybeans",  value=True)

# ─────────────────────────────────────────
# Load data
# ─────────────────────────────────────────
@st.cache_data
def load_data(file):
    if file.name.endswith(".csv"):
        df = pd.read_csv(file)
    else:
        df = pd.read_excel(file)
    df["Date"] = pd.to_datetime(df["Date"])
    df = df.sort_values("Date").reset_index(drop=True)
    return df

def load_demo():
    """Fallback demo data shaped like the real file."""
    import numpy as np
    np.random.seed(42)
    dates = pd.date_range("2026-04-15", periods=25, freq="B")
    base = 472.0
    prices = base + np.cumsum(np.random.normal(0, 3, len(dates)))
    df = pd.DataFrame({
        "Date": dates,
        "CBOT_Low":    prices - np.random.uniform(2, 6, len(dates)),
        "CBOT_High":   prices + np.random.uniform(2, 6, len(dates)),
        "CBOT_Open":   prices - np.random.uniform(0, 2, len(dates)),
        "CBOT_Close":  prices,
        "Closing CBOT": prices,
        "Dollar Rate": np.random.uniform(50, 54, len(dates)),
        "CBOT_Live":   prices,
        "CBOT_Base":   prices,
        "FUT_RET":     np.random.normal(0, 0.01, len(dates)),
        "FUT_RET_SMOOTH": np.random.normal(0, 0.005, len(dates)),
        "CBOT (Live Futures)": prices,
        "Modifier (Live Futures)": np.random.uniform(0.98, 1.02, len(dates)),
        "ARG Daily Price (Live Futures)": prices * 295,
        "BRZ Daily Price (Live Futures)": prices * 295,
        "CBOT (Base Futures)": prices,
        "Modifier (Base Futures)": np.random.uniform(0.98, 1.02, len(dates)),
        "ARG Daily Price (Base Futures)": prices * 294,
        "BRZ Daily Price (Base Futures)": prices * 294,
        "ARG Daily Price": prices * 295,
        "BRZ Daily Price": prices * 295,
    })
    return df

if uploaded_file:
    df = load_data(uploaded_file)
    using_demo = False
else:
    df = load_demo()
    using_demo = True

# ─────────────────────────────────────────
# Derived values
# ─────────────────────────────────────────
latest      = df.iloc[-1]
prev        = df.iloc[-2] if len(df) >= 2 else df.iloc[-1]
today_str   = latest["Date"].strftime("%A, %d %b %Y")

cbot_change   = latest["CBOT_Close"] - prev["CBOT_Close"]
cbot_pct      = (cbot_change / prev["CBOT_Close"]) * 100 if prev["CBOT_Close"] else 0
arg_change    = latest["ARG Daily Price"] - prev["ARG Daily Price"]
arg_pct       = (arg_change / prev["ARG Daily Price"]) * 100 if prev["ARG Daily Price"] else 0
dollar_change = latest["Dollar Rate"] - prev["Dollar Rate"]

# ─────────────────────────────────────────
# Alert detection
# ─────────────────────────────────────────
alerts = []
if abs(cbot_pct) >= price_threshold:
    direction = "📈 rose" if cbot_pct > 0 else "📉 fell"
    alerts.append({
        "level": "warning" if abs(cbot_pct) < price_threshold * 2 else "danger",
        "msg": f"CBOT Corn {direction} by {abs(cbot_pct):.2f}% (threshold: {price_threshold}%)",
        "type": "price_spike"
    })

# ─────────────────────────────────────────
# Email helpers
# ─────────────────────────────────────────
def build_email_html(subject_type="daily", alert_list=None):
    alert_html = ""
    if alert_list:
        for a in alert_list:
            color = "#ffc107" if a["level"] == "warning" else "#dc3545"
            alert_html += f'<li style="color:{color};font-weight:600">{a["msg"]}</li>'
        alert_html = f"<ul>{alert_html}</ul>"
    else:
        alert_html = "<p style='color:#28a745'>✅ All prices within normal range.</p>"

    return f"""
    <html><body style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px">
    <div style="background:#1a1a2e;padding:16px 24px;border-radius:8px 8px 0 0">
      <h2 style="color:#ffffff;margin:0">AdmMedSofts — Commodity Price Report</h2>
      <p style="color:#adb5bd;margin:4px 0 0">{today_str}</p>
    </div>
    <div style="border:1px solid #e9ecef;border-top:none;padding:20px;border-radius:0 0 8px 8px">
      <h3 style="color:#212529">🌾 Corn (CBOT)</h3>
      <table style="width:100%;border-collapse:collapse">
        <tr style="background:#f8f9fa">
          <td style="padding:8px 12px;font-weight:600">Close price</td>
          <td style="padding:8px 12px">{latest['CBOT_Close']:.2f} ¢/bu</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;font-weight:600">Day change</td>
          <td style="padding:8px 12px;color:{'#28a745' if cbot_change>=0 else '#dc3545'}">
            {'+' if cbot_change>=0 else ''}{cbot_change:.2f} ({cbot_pct:+.2f}%)</td>
        </tr>
        <tr style="background:#f8f9fa">
          <td style="padding:8px 12px;font-weight:600">Range</td>
          <td style="padding:8px 12px">{latest['CBOT_Low']:.2f} – {latest['CBOT_High']:.2f}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;font-weight:600">Dollar rate</td>
          <td style="padding:8px 12px">{latest['Dollar Rate']:.2f} EGP/USD</td>
        </tr>
        <tr style="background:#f8f9fa">
          <td style="padding:8px 12px;font-weight:600">ARG local price</td>
          <td style="padding:8px 12px">{latest['ARG Daily Price']:,.0f}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;font-weight:600">BRZ local price</td>
          <td style="padding:8px 12px">{latest['BRZ Daily Price']:,.0f}</td>
        </tr>
      </table>
      <h3 style="color:#212529;margin-top:20px">🔔 Alerts</h3>
      {alert_html}
      <hr style="margin:20px 0;border:none;border-top:1px solid #e9ecef">
      <p style="color:#6c757d;font-size:12px">
        This report was generated automatically by AdmMedSofts Commodity Dashboard.<br>
        Data source: Forecast model output — {today_str}
      </p>
    </div>
    </body></html>
    """

def send_email(subject, html_body, recipients):
    if not sender_email or not sender_pass or not recipients:
        return False, "Missing email configuration."
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = sender_email
        msg["To"]      = ", ".join(recipients)
        msg.attach(MIMEText(html_body, "html"))
        with smtplib.SMTP(smtp_server, int(smtp_port)) as server:
            server.starttls()
            server.login(sender_email, sender_pass)
            server.sendmail(sender_email, recipients, msg.as_string())
        return True, "Email sent successfully."
    except Exception as e:
        return False, str(e)

def get_recipients():
    return [r.strip() for r in recipients_raw.strip().split("\n") if r.strip()]

# ─────────────────────────────────────────
# Header
# ─────────────────────────────────────────
col_title, col_date = st.columns([3, 1])
with col_title:
    st.markdown("## 📊 Commodity Price Dashboard")
    if using_demo:
        st.info("ℹ️ Showing demo data. Upload your forecast file in the sidebar to use real data.", icon="ℹ️")
with col_date:
    st.markdown(f"<div style='text-align:right;color:#6c757d;padding-top:12px'>{today_str}</div>", unsafe_allow_html=True)

# ─────────────────────────────────────────
# Active alerts banner
# ─────────────────────────────────────────
if alerts:
    for a in alerts:
        css = "alert-box-danger" if a["level"] == "danger" else "alert-box"
        st.markdown(f'<div class="{css}">⚠️ {a["msg"]}</div>', unsafe_allow_html=True)

st.markdown("---")

# ─────────────────────────────────────────
# KPI cards — row 1
# ─────────────────────────────────────────
st.markdown('<div class="section-title">Today\'s key prices</div>', unsafe_allow_html=True)

c1, c2, c3, c4 = st.columns(4)

def delta_html(val, pct=None, unit=""):
    arrow = "▲" if val >= 0 else "▼"
    cls   = "metric-delta-up" if val >= 0 else "metric-delta-down"
    pct_str = f" ({pct:+.2f}%)" if pct is not None else ""
    return f'<span class="{cls}">{arrow} {abs(val):.2f}{unit}{pct_str}</span>'

with c1:
    st.markdown(f"""
    <div class="metric-card">
      <div class="metric-label">CBOT Corn Close</div>
      <div class="metric-value">{latest['CBOT_Close']:.2f} <span style="font-size:14px;color:#6c757d">¢/bu</span></div>
      {delta_html(cbot_change, cbot_pct)}
    </div>""", unsafe_allow_html=True)

with c2:
    st.markdown(f"""
    <div class="metric-card">
      <div class="metric-label">Day Range (Low – High)</div>
      <div class="metric-value" style="font-size:20px">{latest['CBOT_Low']:.2f} – {latest['CBOT_High']:.2f}</div>
      <span class="metric-delta-flat">¢ per bushel</span>
    </div>""", unsafe_allow_html=True)

with c3:
    st.markdown(f"""
    <div class="metric-card">
      <div class="metric-label">Dollar Rate</div>
      <div class="metric-value">{latest['Dollar Rate']:.2f} <span style="font-size:14px;color:#6c757d">EGP/USD</span></div>
      {delta_html(dollar_change)}
    </div>""", unsafe_allow_html=True)

with c4:
    fut_ret_pct = latest['FUT_RET'] * 100
    st.markdown(f"""
    <div class="metric-card">
      <div class="metric-label">Futures return (daily)</div>
      <div class="metric-value">{fut_ret_pct:+.2f}<span style="font-size:14px;color:#6c757d"> %</span></div>
      {delta_html(latest['FUT_RET_SMOOTH']*100, unit=' % smoothed')}
    </div>""", unsafe_allow_html=True)

# Row 2 — local prices
c5, c6, c7 = st.columns(3)
with c5:
    st.markdown(f"""
    <div class="metric-card">
      <div class="metric-label">🇦🇷 ARG Local Price</div>
      <div class="metric-value" style="font-size:22px">{latest['ARG Daily Price']:,.0f}</div>
      {delta_html(arg_change, arg_pct)}
    </div>""", unsafe_allow_html=True)

with c6:
    st.markdown(f"""
    <div class="metric-card">
      <div class="metric-label">🇧🇷 BRZ Local Price</div>
      <div class="metric-value" style="font-size:22px">{latest['BRZ Daily Price']:,.0f}</div>
      <span class="metric-delta-flat">EGP equivalent</span>
    </div>""", unsafe_allow_html=True)

with c7:
    modifier = latest.get('Modifier (Live Futures)', 1.0)
    st.markdown(f"""
    <div class="metric-card">
      <div class="metric-label">Live futures modifier</div>
      <div class="metric-value">{modifier:.4f}</div>
      <span class="metric-delta-flat">Price adjustment factor</span>
    </div>""", unsafe_allow_html=True)

st.markdown("---")

# ─────────────────────────────────────────
# Charts
# ─────────────────────────────────────────
st.markdown('<div class="section-title">Price history & forecast</div>', unsafe_allow_html=True)

tab1, tab2, tab3 = st.tabs(["📈 CBOT price trend", "🌍 Local prices (ARG & BRZ)", "📉 Futures returns"])

with tab1:
    fig = go.Figure()
    # Candlestick
    fig.add_trace(go.Candlestick(
        x=df["Date"],
        open=df["CBOT_Open"], high=df["CBOT_High"],
        low=df["CBOT_Low"],   close=df["CBOT_Close"],
        name="CBOT Corn",
        increasing_line_color="#28a745",
        decreasing_line_color="#dc3545",
    ))
    # Close line overlay
    fig.add_trace(go.Scatter(
        x=df["Date"], y=df["CBOT_Close"],
        mode="lines", name="Close",
        line=dict(color="#007bff", width=1.5, dash="dot"),
    ))
    fig.update_layout(
        height=400, margin=dict(l=0, r=0, t=10, b=0),
        xaxis_rangeslider_visible=False,
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
        plot_bgcolor="rgba(0,0,0,0)", paper_bgcolor="rgba(0,0,0,0)",
        yaxis_title="¢ / bushel",
    )
    st.plotly_chart(fig, use_container_width=True)

with tab2:
    fig2 = go.Figure()
    fig2.add_trace(go.Scatter(
        x=df["Date"], y=df["ARG Daily Price"],
        mode="lines+markers", name="🇦🇷 ARG",
        line=dict(color="#007bff", width=2),
        marker=dict(size=5),
    ))
    fig2.add_trace(go.Scatter(
        x=df["Date"], y=df["BRZ Daily Price"],
        mode="lines+markers", name="🇧🇷 BRZ",
        line=dict(color="#fd7e14", width=2),
        marker=dict(size=5),
    ))
    fig2.update_layout(
        height=400, margin=dict(l=0, r=0, t=10, b=0),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
        plot_bgcolor="rgba(0,0,0,0)", paper_bgcolor="rgba(0,0,0,0)",
        yaxis_title="EGP equivalent",
    )
    st.plotly_chart(fig2, use_container_width=True)

with tab3:
    colors = ["#28a745" if v >= 0 else "#dc3545" for v in df["FUT_RET"]]
    fig3 = go.Figure()
    fig3.add_trace(go.Bar(
        x=df["Date"], y=df["FUT_RET"] * 100,
        name="Daily return (%)",
        marker_color=colors,
    ))
    fig3.add_trace(go.Scatter(
        x=df["Date"], y=df["FUT_RET_SMOOTH"] * 100,
        name="Smoothed return",
        mode="lines", line=dict(color="#6f42c1", width=2),
    ))
    fig3.add_hline(y=0, line_dash="dot", line_color="gray", line_width=1)
    fig3.update_layout(
        height=400, margin=dict(l=0, r=0, t=10, b=0),
        plot_bgcolor="rgba(0,0,0,0)", paper_bgcolor="rgba(0,0,0,0)",
        yaxis_title="Return (%)",
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
    )
    st.plotly_chart(fig3, use_container_width=True)

st.markdown("---")

# ─────────────────────────────────────────
# Raw data table
# ─────────────────────────────────────────
with st.expander("📋 View raw data table"):
    display_df = df.copy()
    display_df["Date"] = display_df["Date"].dt.strftime("%Y-%m-%d")
    st.dataframe(display_df, use_container_width=True)

st.markdown("---")

# ─────────────────────────────────────────
# Alert & email panel
# ─────────────────────────────────────────
st.markdown('<div class="section-title">🔔 Email alerts</div>', unsafe_allow_html=True)

col_a, col_b, col_c, col_d = st.columns(4)

with col_a:
    if st.button("📧 Send daily summary", use_container_width=True, type="primary"):
        recipients = get_recipients()
        html = build_email_html("daily", alerts)
        ok, msg = send_email(
            f"[AdmMedSofts] Corn daily price summary — {today_str}",
            html, recipients
        )
        if ok:
            st.success(f"✅ {msg}")
        else:
            st.error(f"❌ {msg}")

with col_b:
    if st.button("🚨 Send price alert now", use_container_width=True):
        recipients = get_recipients()
        html = build_email_html("alert", alerts)
        ok, msg = send_email(
            f"[AdmMedSofts] ⚠️ Price alert — {today_str}",
            html, recipients
        )
        if ok:
            st.success(f"✅ {msg}")
        else:
            st.error(f"❌ {msg}")

with col_c:
    if st.button("🧪 Preview email (HTML)", use_container_width=True):
        st.session_state["show_preview"] = True

with col_d:
    if st.button("📬 Test SMTP connection", use_container_width=True):
        if not sender_email or not sender_pass:
            st.warning("Enter email credentials in the sidebar first.")
        else:
            try:
                with smtplib.SMTP(smtp_server, int(smtp_port)) as s:
                    s.starttls()
                    s.login(sender_email, sender_pass)
                st.success("✅ SMTP connection OK")
            except Exception as e:
                st.error(f"❌ {e}")

if st.session_state.get("show_preview"):
    html_preview = build_email_html("daily", alerts)
    st.components.v1.html(html_preview, height=600, scrolling=True)
    if st.button("Close preview"):
        st.session_state["show_preview"] = False

# ─────────────────────────────────────────
# Footer
# ─────────────────────────────────────────
st.markdown("""
<div style="text-align:center;color:#adb5bd;font-size:12px;margin-top:32px;padding-top:16px;border-top:1px solid #e9ecef">
  AdmMedSofts · Commodity Intelligence Dashboard · Data Analysis & AI Department
</div>
""", unsafe_allow_html=True)
