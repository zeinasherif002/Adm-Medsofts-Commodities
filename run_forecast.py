"""
run_forecast.py - AdmMedSofts Daily Corn Forecast Pipeline
Matches exact model from Corn_Daily_Forcast_final_version.ipynb
- Trains on monthly SnD data using RidgeCV (same as notebook)
- Fetches today's CBOT + dollar rate from Yahoo Finance
- Uploads only today's record to Supabase
"""

import pandas as pd
import numpy as np
import requests
import json
import yfinance as yf
import os
from datetime import datetime, timedelta
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import RidgeCV
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

def fetch_market_data():
    log("Fetching today's CBOT corn futures from Yahoo Finance...")
    end   = datetime.today()
    start = end - timedelta(days=5)
    corn  = yf.download("ZC=F", start=start, end=end, interval="1d", progress=False)
    if corn.empty:
        raise ValueError("Could not fetch CBOT data.")
    if isinstance(corn.columns, pd.MultiIndex):
        corn.columns = [col[0] for col in corn.columns]
    corn = corn[["Open","High","Low","Close"]].copy()
    corn.columns = ["cbot_open","cbot_high","cbot_low","cbot_close"]
    corn = corn.dropna()
    today_row = corn.iloc[-1]
    log(f"  Latest: {corn.index[-1].date()} @ {today_row['cbot_close']:.2f} c/bu")

    log("Fetching EGP/USD rate...")
    try:
        egp = yf.download("EGP=X", start=start, end=end, interval="1d", progress=False)
        if isinstance(egp.columns, pd.MultiIndex):
            egp.columns = [col[0] for col in egp.columns]
        dollar_rate = float(egp["Close"].dropna().iloc[-1])
        log(f"  Dollar rate: {dollar_rate:.2f} EGP/USD")
    except:
        dollar_rate = 53.0
        log(f"  Using default dollar rate: {dollar_rate}")

    return corn.index[-1], today_row, dollar_rate

def train_model():
    log(f"Training model from {SND_FILE} (matching notebook exactly)...")
    snd = pd.read_excel(SND_FILE, sheet_name="SnD")
    for c in ["Closing CBOT","Dollar Rate","STU","Price ARG","Price BRZ"]:
        if c in snd.columns:
            snd[c] = pd.to_numeric(snd[c], errors="coerce").ffill().bfill()
    hist = snd.dropna(subset=["Closing CBOT","Dollar Rate","STU","Price ARG","Price BRZ"]).copy()
    log(f"  Training on {len(hist)} monthly rows")

    X = hist[["Closing CBOT","Dollar Rate","STU"]]

    def fit_ridge(X, y):
        return Pipeline([
            ("scaler", StandardScaler()),
            ("ridge", RidgeCV(alphas=[0.1, 1.0, 10.0, 50.0]))
        ]).fit(X, y)

    ridge_arg = fit_ridge(X, hist["Price ARG"])
    ridge_brz = fit_ridge(X, hist["Price BRZ"])
    stu = float(hist["STU"].iloc[-1])
    log(f"  Latest STU: {stu:.4f}")
    return ridge_arg, ridge_brz, stu

def run_forecast(date, row, dollar_rate, ridge_arg, ridge_brz, stu):
    log("Running forecast for today...")
    cbot = float(row["cbot_close"])
    X_today = pd.DataFrame([{
        "Closing CBOT": cbot,
        "Dollar Rate":  dollar_rate,
        "STU":          stu
    }])
    arg = float(ridge_arg.predict(X_today)[0])
    brz = float(ridge_brz.predict(X_today)[0])

    log(f"  TODAY ({date.date()}):")
    log(f"    CBOT:        {cbot:.2f} c/bu")
    log(f"    Dollar Rate: {dollar_rate:.2f} EGP/USD")
    log(f"    ARG Price:   {arg:,.2f} EGP")
    log(f"    BRZ Price:   {brz:,.2f} EGP")

    return {
        "date":         date.strftime("%Y-%m-%d"),
        "commodity":    "corn",
        "cbot_open":    round(float(row["cbot_open"]), 4),
        "cbot_high":    round(float(row["cbot_high"]), 4),
        "cbot_low":     round(float(row["cbot_low"]),  4),
        "cbot_close":   round(cbot, 4),
        "closing_cbot": round(cbot, 4),
        "dollar_rate":  round(dollar_rate, 4),
        "arg_price":    round(arg, 2),
        "brz_price":    round(brz, 2),
    }

def upload(record):
    log("Uploading today's record to Supabase...")
    resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/commodity_prices",
        headers=HEADERS,
        data=json.dumps([record])
    )
    if resp.status_code in (200, 201):
        log("  Upload successful!")
    else:
        log(f"  Error: {resp.status_code} {resp.text}")

def main():
    print("=" * 55)
    print("  AdmMedSofts - Daily Corn Forecast Pipeline")
    print(f"  {datetime.today().strftime('%A, %d %B %Y %H:%M')}")
    print("=" * 55)
    date, row, dollar_rate = fetch_market_data()
    ridge_arg, ridge_brz, stu = train_model()
    record = run_forecast(date, row, dollar_rate, ridge_arg, ridge_brz, stu)
    upload(record)
    print("\nPipeline complete! Dashboard is now up to date.")

if __name__ == "__main__":
    main()