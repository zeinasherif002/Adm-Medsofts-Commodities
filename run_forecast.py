"""
run_forecast.py - AdmMedSofts Daily Corn Forecast Pipeline
Trains on clean recent daily data + STU from SnD, predicts today's prices.
"""

import pandas as pd
import numpy as np
import requests
import json
import yfinance as yf
import os
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

def fetch_market_data(days=90):
    log("Fetching CBOT corn futures from Yahoo Finance...")
    end = datetime.today()
    start = end - timedelta(days=days)
    corn = yf.download("ZC=F", start=start, end=end, interval="1d", progress=False)
    if corn.empty:
        raise ValueError("Could not fetch CBOT data.")
    if isinstance(corn.columns, pd.MultiIndex):
        corn.columns = [col[0] for col in corn.columns]
    corn = corn[["Open","High","Low","Close"]].copy()
    corn.columns = ["cbot_open","cbot_high","cbot_low","cbot_close"]
    corn.index.name = "date"
    corn = corn.dropna()
    log(f"  Got {len(corn)} days. Latest: {corn.index[-1].date()} @ {corn['cbot_close'].iloc[-1]:.2f} c/bu")
    try:
        egp = yf.download("EGP=X", start=start, end=end, interval="1d", progress=False)
        if isinstance(egp.columns, pd.MultiIndex):
            egp.columns = [col[0] for col in egp.columns]
        egp = egp[["Close"]].rename(columns={"Close":"dollar_rate"})
        egp.index.name = "date"
        corn = corn.join(egp, how="left")
        corn["dollar_rate"] = corn["dollar_rate"].ffill().bfill()
        log(f"  Dollar rate: {corn['dollar_rate'].iloc[-1]:.2f} EGP/USD")
    except:
        corn["dollar_rate"] = 52.0
    return corn

def build_training_data():
    log("Loading training data...")
    snd = pd.read_excel(SND_FILE, sheet_name="SnD")
    snd = snd.dropna(subset=["STU"])
    stu = float(snd["STU"].iloc[-1])
    log(f"  Latest STU from SnD: {stu:.4f}")
    daily_files = [
        ("Corn Daily Prices March-April (Updated).xlsx", "CBOT_Close", "ARG Daily Price"),
        ("Corn April Prices updates.xlsx",               "CBOT_Close", "ARG Daily Price"),
        ("Corn Daily Prices MAY-JUNE.xlsx",              "Closing CBOT","ARG Daily Price"),
    ]
    records = []
    for fname, cbot_col, arg_col in daily_files:
        if not os.path.exists(fname):
            continue
        try:
            df = pd.read_excel(fname)
            df.columns = df.columns.str.strip()
            fx_col = next((c for c in ["Dollar Rate"] if c in df.columns), None)
            if cbot_col not in df.columns or arg_col not in df.columns:
                continue
            for _, row in df.iterrows():
                try:
                    cbot = float(row[cbot_col])
                    fx   = float(row[fx_col]) if fx_col else 52.0
                    arg  = float(row[arg_col])
                    brz_col = next((c for c in ["BRZ Daily Price","BRZ "] if c in df.columns), None)
                    brz = float(row[brz_col]) if brz_col else arg
                    if arg > 50000 or arg < 5000: continue
                    if np.isnan(cbot) or np.isnan(arg) or np.isnan(fx): continue
                    records.append({"cbot": cbot, "fx": fx, "stu": stu, "arg": arg, "brz": brz})
                except:
                    continue
            log(f"  OK: {fname}")
        except Exception as e:
            log(f"  Skip {fname}: {e}")
    df_train = pd.DataFrame(records)
    log(f"  Total training rows: {len(df_train)}")
    log(f"  ARG range: {df_train['arg'].min():.0f} - {df_train['arg'].max():.0f}")
    return df_train, stu

def train_model(df_train):
    log("Training model...")
    X = df_train[["cbot","fx","stu"]].values
    y_arg = df_train["arg"].values
    y_brz = df_train["brz"].values
    scaler = StandardScaler()
    Xs = scaler.fit_transform(X)
    m_arg = Ridge(alpha=1.0)
    m_brz = Ridge(alpha=1.0)
    m_arg.fit(Xs, y_arg)
    m_brz.fit(Xs, y_brz)
    mae = np.mean(np.abs(m_arg.predict(Xs) - y_arg))
    log(f"  MAE: {mae:.2f} EGP")
    return m_arg, m_brz, scaler

def run_forecast(corn_df, m_arg, m_brz, scaler, stu):
    log("Running forecast...")
    records = []
    for date, row in corn_df.iterrows():
        cbot = float(row["cbot_close"])
        fx   = float(row["dollar_rate"]) if pd.notna(row.get("dollar_rate")) else 52.0
        X_in = scaler.transform([[cbot, fx, stu]])
        arg  = float(m_arg.predict(X_in)[0])
        brz  = float(m_brz.predict(X_in)[0])
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
    today = records[-1]
    log(f"  TODAY ({today['date']}):")
    log(f"    CBOT:        {today['cbot_close']} c/bu")
    log(f"    Dollar Rate: {today['dollar_rate']} EGP/USD")
    log(f"    ARG Price:   {today['arg_price']:,.2f} EGP")
    log(f"    BRZ Price:   {today['brz_price']:,.2f} EGP")
    return records

def upload(records):
    log(f"Uploading {len(records)} records...")
    resp = requests.post(f"{SUPABASE_URL}/rest/v1/commodity_prices", headers=HEADERS, data=json.dumps(records))
    if resp.status_code in (200, 201):
        log("  Upload successful!")
    else:
        log(f"  Error: {resp.status_code} {resp.text}")

def main():
    print("=" * 55)
    print("  AdmMedSofts - Daily Corn Forecast Pipeline")
    print(f"  {datetime.today().strftime('%A, %d %B %Y %H:%M')}")
    print("=" * 55)
    corn_df = fetch_market_data(days=90)
    df_train, stu = build_training_data()
    m_arg, m_brz, scaler = train_model(df_train)
    records = run_forecast(corn_df, m_arg, m_brz, scaler, stu)
    upload(records)
    print("\nPipeline complete! Dashboard is now up to date.")

if __name__ == "__main__":
    main()