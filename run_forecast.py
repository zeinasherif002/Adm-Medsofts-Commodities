"""
run_forecast.py — AdmMedSofts Daily Corn Price Forecast
========================================================
Run this every morning to:
  1. Fetch latest CBOT corn prices & EGP rate automatically (Yahoo Finance)
  2. Run the forecast model (Ridge Regression trained on SnD data)
  3. Upload results to Supabase
  4. Dashboard updates automatically for all traders

Usage:
    python run_forecast.py

Requirements:
    pip install pandas openpyxl scikit-learn yfinance requests
"""

import pandas as pd
import numpy as np
import requests
import json
import yfinance as yf
from datetime import datetime, timedelta
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
import warnings
warnings.filterwarnings("ignore")

# ─── Supabase config ────────────────────────────────────────
SUPABASE_URL = "https://cupcsspfmkgbcovtgszm.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1cGNzc3BmbWtnYmNvdnRnc3ptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzI4ODMsImV4cCI6MjA5NDg0ODg4M30.Y8o09mcvdJuSSfgsVGnhoUyRpIUPVl8-gkigJXXee8E"
SND_FILE     = "Corn.xlsx"           # ← your SnD file
LOCAL_FEES   = 380.0                 # ← update if changed
# ────────────────────────────────────────────────────────────

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates"
}

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

# ─── Step 1: Fetch latest market data ───────────────────────
def fetch_market_data(days=60):
    log("Fetching CBOT corn futures from Yahoo Finance...")
    end   = datetime.today()
    start = end - timedelta(days=days)

    corn = yf.download("ZC=F", start=start, end=end, interval="1d", progress=False)
    if corn.empty:
        raise ValueError("Could not fetch CBOT corn data. Check internet connection.")

    # Flatten multi-level columns if present
    if isinstance(corn.columns, pd.MultiIndex):
        corn.columns = [col[0] for col in corn.columns]

    corn = corn[["Open", "High", "Low", "Close"]].copy()
    corn.columns = ["cbot_open", "cbot_high", "cbot_low", "cbot_close"]
    corn.index.name = "date"
    corn = corn.dropna()

    log(f"  Got {len(corn)} days of CBOT data. Latest: {corn.index[-1].date()} @ {corn['cbot_close'].iloc[-1]:.2f} ¢/bu")

    # Fetch EGP/USD rate
    log("Fetching EGP/USD exchange rate...")
    try:
        egp = yf.download("EGP=X", start=start, end=end, interval="1d", progress=False)
        if isinstance(egp.columns, pd.MultiIndex):
            egp.columns = [col[0] for col in egp.columns]
        egp = egp[["Close"]].rename(columns={"Close": "dollar_rate"})
        egp.index.name = "date"
        corn = corn.join(egp, how="left")
        corn["dollar_rate"] = corn["dollar_rate"].ffill().bfill()
    except Exception:
        log("  EGP rate unavailable, using last known value from SnD file.")
        corn["dollar_rate"] = None

    return corn

# ─── Step 2: Train forecast model on SnD data ───────────────
def train_model(snd_file):
    log(f"Loading SnD data from {snd_file}...")
    df = pd.read_excel(snd_file, sheet_name="SnD")
    df = df.dropna(subset=["Closing CBOT", "Dollar Rate", "STU", "Price ARG"])

    features = ["Closing CBOT", "Dollar Rate", "STU"]
    targets  = ["Price ARG", "Price BRZ"]

    X = df[features].values
    y_arg = df["Price ARG"].values
    y_brz = df["Price BRZ"].values

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    model_arg = Ridge(alpha=1.0)
    model_brz = Ridge(alpha=1.0)
    model_arg.fit(X_scaled, y_arg)
    model_brz.fit(X_scaled, y_brz)

    # Get latest STU from SnD
    latest_stu = float(df["STU"].iloc[-1])

    log(f"  Model trained on {len(df)} months of SnD data.")
    log(f"  Latest STU: {latest_stu:.4f}")

    return model_arg, model_brz, scaler, latest_stu

# ─── Step 3: Run daily forecast ─────────────────────────────
def run_forecast(corn_df, model_arg, model_brz, scaler, stu, dollar_rate_override=None):
    log("Running daily price forecast...")
    records = []

    for date, row in corn_df.iterrows():
        cbot  = float(row["cbot_close"])
        fx    = float(row["dollar_rate"]) if pd.notna(row.get("dollar_rate")) else dollar_rate_override or 52.0

        X_input = scaler.transform([[cbot, fx, stu]])
        arg_price = float(model_arg.predict(X_input)[0])
        brz_price = float(model_brz.predict(X_input)[0])

        records.append({
            "date":         date.strftime("%Y-%m-%d"),
            "commodity":    "corn",
            "cbot_open":    round(float(row["cbot_open"]), 4),
            "cbot_high":    round(float(row["cbot_high"]), 4),
            "cbot_low":     round(float(row["cbot_low"]),  4),
            "cbot_close":   round(cbot, 4),
            "closing_cbot": round(cbot, 4),
            "dollar_rate":  round(fx, 4),
            "arg_price":    round(arg_price, 2),
            "brz_price":    round(brz_price, 2),
        })

    log(f"  Forecast complete for {len(records)} days.")
    return records

# ─── Step 4: Upload to Supabase ─────────────────────────────
def upload(records):
    log(f"Uploading {len(records)} records to Supabase...")
    url  = f"{SUPABASE_URL}/rest/v1/commodity_prices"
    resp = requests.post(url, headers=HEADERS, data=json.dumps(records))
    if resp.status_code in (200, 201):
        log(f"  ✅ Upload successful!")
    else:
        log(f"  ❌ Upload failed: {resp.status_code} — {resp.text}")

# ─── Main ────────────────────────────────────────────────────
def main():
    print("=" * 55)
    print("  AdmMedSofts — Daily Corn Forecast Pipeline")
    print(f"  {datetime.today().strftime('%A, %d %B %Y')}")
    print("=" * 55)

    try:
        corn_df               = fetch_market_data(days=60)
        model_arg, model_brz, scaler, stu = train_model(SND_FILE)
        records               = run_forecast(corn_df, model_arg, model_brz, scaler, stu)
        upload(records)
        print("\n✅ Pipeline complete! Dashboard is now up to date.")
    except Exception as e:
        print(f"\n❌ Pipeline failed: {e}")
        raise

if __name__ == "__main__":
    main()
