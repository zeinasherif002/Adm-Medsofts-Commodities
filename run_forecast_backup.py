"""
run_forecast.py - AdmMedSofts Daily Corn Forecast Pipeline
===========================================================
Trains on daily historical prices + SnD monthly data,
then forecasts today's ARG & BRZ local prices.

Usage:
    python run_forecast.py
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

SUPABASE_URL = "https://cupcsspfmkgbcovtgszm.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1cGNzc3BmbWtnYmNvdnRnc3ptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzI4ODMsImV4cCI6MjA5NDg0ODg4M30.Y8o09mcvdJuSSfgsVGnhoUyRpIUPVl8-gkigJXXee8E"
SND_FILE = "Corn.xlsx"

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates"
}

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

# ── Step 1: Fetch today's CBOT & dollar rate ─────────────────
def fetch_market_data(days=90):
    log("Fetching CBOT corn futures from Yahoo Finance...")
    end   = datetime.today()
    start = end - timedelta(days=days)
    corn  = yf.download("ZC=F", start=start, end=end, interval="1d", progress=False)
    if corn.empty:
        raise ValueError("Could not fetch CBOT data.")
    if isinstance(corn.columns, pd.MultiIndex):
        corn.columns = [col[0] for col in corn.columns]
    corn = corn[["Open","High","Low","Close"]].copy()
    corn.columns = ["cbot_open","cbot_high","cbot_low","cbot_close"]
    corn.index.name = "date"
    corn = corn.dropna()
    log(f"  Got {len(corn)} days. Latest: {corn.index[-1].date()} @ {corn['cbot_close'].iloc[-1]:.2f} c/bu")

    log("Fetching EGP/USD rate...")
    try:
        egp = yf.download("EGP=X", start=start, end=end, interval="1d", progress=False)
        if isinstance(egp.columns, pd.MultiIndex):
            egp.columns = [col[0] for col in egp.columns]
        egp = egp[["Close"]].rename(columns={"Close":"dollar_rate"})
        egp.index.name = "date"
        corn = corn.join(egp, how="left")
        corn["dollar_rate"] = corn["dollar_rate"].ffill().bfill()
        log(f"  Dollar rate today: {corn['dollar_rate'].iloc[-1]:.2f} EGP/USD")
    except:
        corn["dollar_rate"] = 52.0
        log("  Using default dollar rate: 52.0")
    return corn

# ── Step 2: Build combined training dataset ──────────────────
def build_training_data(snd_file):
    log("Loading SnD monthly data...")
    snd = pd.read_excel(snd_file, sheet_name="SnD")
    snd = snd.dropna(subset=["Closing CBOT","Dollar Rate","STU","Price ARG"])
    snd_train = pd.DataFrame({
        "cbot_close": snd["Closing CBOT"].values,
        "dollar_rate": snd["Dollar Rate"].values,
        "stu": snd["STU"].values,
        "arg_price": snd["Price ARG"].values,
        "brz_price": snd["Price BRZ"].values,
    })
    log(f"  SnD: {len(snd_train)} monthly rows")

    # Load daily historical files
    log("Loading daily historical price files...")
    daily_files = [
        "forecast_daily_november_2025_with_geo.xlsx",
        "Corn_November.xlsx",
        "forecast_daily_december_2025_point_only.xlsx",
        "Corn Jan & Feb 2026 forecast.xlsx",
        "Corn Daily Price (Feb-March).xlsx",
        "Corn Daily Prices March-April (Updated).xlsx",
        "Corn April Prices updates.xlsx",
        "Corn cbot april-may.xlsx",
        "Corn May Forecasted Prices .xlsx",
        "Corn Daily Prices MAY-JUNE.xlsx",
    ]

    daily_records = []
    for fname in daily_files:
        import os
        if not os.path.exists(fname):
            continue
        try:
            df = pd.read_excel(fname)
            df.columns = df.columns.str.strip()
            if "Date" not in df.columns:
                continue
            df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
            df = df.dropna(subset=["Date"])

            def c(*n): return next((x for x in n if x in df.columns), None)

            cbot_col = c("CBOT_Close","Closing CBOT","Close","Last")
            arg_col  = c("ARG Daily Price","ARG ")
            brz_col  = c("BRZ Daily Price","BRZ ")
            fx_col   = c("Dollar Rate")

            if not cbot_col or not arg_col:
                continue

            for _, row in df.iterrows():
                try:
                    cbot = float(row[cbot_col])
                    arg  = float(row[arg_col])
                    brz  = float(row[brz_col]) if brz_col else arg
                    fx   = float(row[fx_col]) if fx_col else 52.0
                    if any(np.isnan([cbot, arg, brz, fx])):
                        continue
                    daily_records.append({
                        "cbot_close": cbot,
                        "dollar_rate": fx,
                        "stu": float(snd["STU"].iloc[-1]),  # use latest STU
                        "arg_price": arg,
                        "brz_price": brz,
                    })
                except:
                    continue
        except Exception as e:
            log(f"  Warning: {fname}: {e}")

    if daily_records:
        daily_df = pd.DataFrame(daily_records)
        combined = pd.concat([snd_train, daily_df], ignore_index=True)
        log(f"  Daily: {len(daily_records)} rows")
    else:
        combined = snd_train

    log(f"  Total training data: {len(combined)} rows")
    latest_stu = float(snd["STU"].iloc[-1])
    log(f"  Latest STU: {latest_stu:.4f}")
    return combined, latest_stu

# ── Step 3: Train model ──────────────────────────────────────
def train_model(train_df):
    log("Training Ridge regression model...")
    X = train_df[["cbot_close","dollar_rate","stu"]].values
    y_arg = train_df["arg_price"].values
    y_brz = train_df["brz_price"].values

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    model_arg = Ridge(alpha=1.0)
    model_brz = Ridge(alpha=1.0)
    model_arg.fit(X_scaled, y_arg)
    model_brz.fit(X_scaled, y_brz)

    # Quick accuracy check on training data
    pred_arg = model_arg.predict(X_scaled)
    mae = np.mean(np.abs(pred_arg - y_arg))
    log(f"  Model MAE on training data: {mae:.2f} EGP")
    return model_arg, model_brz, scaler

# ── Step 4: Forecast ─────────────────────────────────────────
def run_forecast(corn_df, model_arg, model_brz, scaler, stu):
    log("Running daily price forecast...")
    records = []
    for date, row in corn_df.iterrows():
        cbot = float(row["cbot_close"])
        fx   = float(row["dollar_rate"]) if pd.notna(row.get("dollar_rate")) else 52.0
        X_in = scaler.transform([[cbot, fx, stu]])
        arg  = float(model_arg.predict(X_in)[0])
        brz  = float(model_brz.predict(X_in)[0])
        records.append({
            "date":         date.strftime("%Y-%m-%d"),
            "commodity":    "corn",
            "cbot_open":    round(float(row["cbot_open"]), 4),
            "cbot_high":    round(float(row["cbot_high"]), 4),
            "cbot_low":     round(float(row["cbot_low"]),  4),
            "cbot_close":   round(cbot, 4),
            "closing_cbot": round(cbot, 4),
            "dollar_rate":  round(fx, 4),
            "arg_price":    round(arg, 2),
            "brz_price":    round(brz, 2),
        })
    log(f"  Forecast complete for {len(records)} days.")

    # Print today's prediction
    today = records[-1]
    log(f"  TODAY ({today['date']}):")
    log(f"    CBOT Close:  {today['cbot_close']} c/bu")
    log(f"    Dollar Rate: {today['dollar_rate']} EGP/USD")
    log(f"    ARG Price:   {today['arg_price']:,.2f} EGP")
    log(f"    BRZ Price:   {today['brz_price']:,.2f} EGP")
    return records

# ── Step 5: Upload ────────────────────────────────────────────
def upload(records):
    log(f"Uploading {len(records)} records to Supabase...")
    resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/commodity_prices",
        headers=HEADERS,
        data=json.dumps(records)
    )
    if resp.status_code in (200, 201):
        log("  Upload successful!")
    else:
        log(f"  Upload failed: {resp.status_code} {resp.text}")

# ── Main ──────────────────────────────────────────────────────
def main():
    print("=" * 55)
    print("  AdmMedSofts - Daily Corn Forecast Pipeline")
    print(f"  {datetime.today().strftime('%A, %d %B %Y %H:%M')}")
    print("=" * 55)
    corn_df              = fetch_market_data(days=90)
    train_df, stu        = build_training_data(SND_FILE)
    model_arg, model_brz, scaler = train_model(train_df)
    records              = run_forecast(corn_df, model_arg, model_brz, scaler, stu)
    upload(records)
    print("\nPipeline complete! Dashboard is now up to date.")

if __name__ == "__main__":
    main()