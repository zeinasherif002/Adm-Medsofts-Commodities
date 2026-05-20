"""
send_daily.py — Run this script from a cron job or Windows Task Scheduler
to send the daily morning email without opening the Streamlit dashboard.

Usage:
    python send_daily.py --file path/to/forecast.xlsx

Configure the EMAIL_ variables below, or set them as environment variables.
"""

import argparse
import os
import smtplib
import pandas as pd
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

# ─── Configure these ────────────────────────────────────────
SMTP_SERVER    = os.getenv("SMTP_SERVER",   "smtp.gmail.com")
SMTP_PORT      = int(os.getenv("SMTP_PORT", "587"))
SENDER_EMAIL   = os.getenv("SENDER_EMAIL",  "your@gmail.com")
SENDER_PASS    = os.getenv("SENDER_PASS",   "your_app_password")
RECIPIENTS     = os.getenv("RECIPIENTS",    "trader1@company.com,trader2@company.com").split(",")
PRICE_THRESHOLD = float(os.getenv("PRICE_THRESHOLD", "2.0"))   # % change to trigger alert
FORECAST_ERR    = float(os.getenv("FORECAST_ERR",    "3.0"))   # % forecast deviation alert
# ────────────────────────────────────────────────────────────

def load_data(path):
    if path.endswith(".csv"):
        df = pd.read_csv(path)
    else:
        df = pd.read_excel(path)
    df["Date"] = pd.to_datetime(df["Date"])
    return df.sort_values("Date").reset_index(drop=True)

def detect_alerts(df, price_threshold, forecast_err):
    alerts = []
    latest = df.iloc[-1]
    prev   = df.iloc[-2] if len(df) >= 2 else df.iloc[-1]

    # Price change alert
    cbot_pct = ((latest["CBOT_Close"] - prev["CBOT_Close"]) / prev["CBOT_Close"]) * 100
    if abs(cbot_pct) >= price_threshold:
        direction = "rose" if cbot_pct > 0 else "fell"
        alerts.append(f"⚠️ CBOT Corn {direction} by {abs(cbot_pct):.2f}% (threshold: {price_threshold}%)")

    # Forecast vs actual (if Closing CBOT and CBOT_Close differ meaningfully)
    if "Closing CBOT" in df.columns:
        diff_pct = abs(latest["CBOT_Close"] - latest["Closing CBOT"]) / latest["Closing CBOT"] * 100
        if diff_pct >= forecast_err:
            alerts.append(f"⚠️ Forecast vs actual gap: {diff_pct:.2f}% (threshold: {forecast_err}%)")

    return alerts, latest, prev

def build_html(latest, prev, alerts, today_str):
    cbot_change = latest["CBOT_Close"] - prev["CBOT_Close"]
    cbot_pct    = (cbot_change / prev["CBOT_Close"]) * 100 if prev["CBOT_Close"] else 0
    alert_html  = "".join(f'<li style="color:#dc3545;font-weight:600">{a}</li>' for a in alerts)
    alert_section = f"<ul>{alert_html}</ul>" if alerts else "<p style='color:#28a745'>✅ All prices within normal range.</p>"

    return f"""
    <html><body style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px">
    <div style="background:#1a1a2e;padding:16px 24px;border-radius:8px 8px 0 0">
      <h2 style="color:#fff;margin:0">AdmMedSofts — Daily Corn Price Report</h2>
      <p style="color:#adb5bd;margin:4px 0 0">{today_str}</p>
    </div>
    <div style="border:1px solid #e9ecef;border-top:none;padding:20px;border-radius:0 0 8px 8px">
      <h3>🌾 Corn (CBOT)</h3>
      <table style="width:100%;border-collapse:collapse">
        <tr style="background:#f8f9fa"><td style="padding:8px 12px;font-weight:600">Close</td>
          <td style="padding:8px 12px">{latest['CBOT_Close']:.2f} ¢/bu</td></tr>
        <tr><td style="padding:8px 12px;font-weight:600">Change</td>
          <td style="padding:8px 12px;color:{'#28a745' if cbot_change>=0 else '#dc3545'}">
            {'+' if cbot_change>=0 else ''}{cbot_change:.2f} ({cbot_pct:+.2f}%)</td></tr>
        <tr style="background:#f8f9fa"><td style="padding:8px 12px;font-weight:600">Range</td>
          <td style="padding:8px 12px">{latest['CBOT_Low']:.2f} – {latest['CBOT_High']:.2f}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:600">Dollar rate</td>
          <td style="padding:8px 12px">{latest['Dollar Rate']:.2f} EGP/USD</td></tr>
        <tr style="background:#f8f9fa"><td style="padding:8px 12px;font-weight:600">ARG local price</td>
          <td style="padding:8px 12px">{latest['ARG Daily Price']:,.0f}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:600">BRZ local price</td>
          <td style="padding:8px 12px">{latest['BRZ Daily Price']:,.0f}</td></tr>
      </table>
      <h3>🔔 Alerts</h3>
      {alert_section}
      <hr style="margin:20px 0;border:none;border-top:1px solid #e9ecef">
      <p style="color:#6c757d;font-size:12px">AdmMedSofts · Commodity Intelligence · {today_str}</p>
    </div></body></html>
    """

def send(subject, html, recipients):
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = SENDER_EMAIL
    msg["To"]      = ", ".join(recipients)
    msg.attach(MIMEText(html, "html"))
    with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as s:
        s.starttls()
        s.login(SENDER_EMAIL, SENDER_PASS)
        s.sendmail(SENDER_EMAIL, recipients, msg.as_string())

def main():
    parser = argparse.ArgumentParser(description="Send daily commodity price email")
    parser.add_argument("--file", required=True, help="Path to forecast Excel/CSV file")
    args = parser.parse_args()

    today_str = datetime.today().strftime("%A, %d %b %Y")
    print(f"[{today_str}] Loading data from {args.file} ...")

    df = load_data(args.file)
    alerts, latest, prev = detect_alerts(df, PRICE_THRESHOLD, FORECAST_ERR)

    subject = f"[AdmMedSofts] Daily corn price — {today_str}"
    if alerts:
        subject = f"[AdmMedSofts] ⚠️ PRICE ALERT — {today_str}"

    html = build_html(latest, prev, alerts, today_str)

    print(f"Sending to: {RECIPIENTS}")
    send(subject, html, RECIPIENTS)
    print("✅ Email sent successfully.")

if __name__ == "__main__":
    main()
