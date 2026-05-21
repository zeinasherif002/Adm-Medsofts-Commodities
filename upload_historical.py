import pandas as pd
import numpy as np
import requests
import json
import os
from datetime import datetime

SUPABASE_URL = "https://cupcsspfmkgbcovtgszm.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1cGNzc3BmbWtnYmNvdnRnc3ptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzI4ODMsImV4cCI6MjA5NDg0ODg4M30.Y8o09mcvdJuSSfgsVGnhoUyRpIUPVl8-gkigJXXee8E"
HEADERS = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates"}

def sf(val):
    try:
        v = float(val)
        return None if (np.isnan(v) or np.isinf(v)) else round(v, 4)
    except:
        return None

def parse_file(path):
    name = os.path.basename(path)
    records = []
    try:
        df = pd.read_csv(path) if path.endswith(".csv") else pd.read_excel(path)
        df.columns = df.columns.str.strip()
        if "Date" not in df.columns:
            df.columns = df.iloc[0]
            df = df[1:].reset_index(drop=True)
            if "Date" not in df.columns:
                print(f"  Skip {name}")
                return []
        df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
        df = df.dropna(subset=["Date"])
        df = df[df["Date"].dt.year >= 2025]
        def c(*n): return next((x for x in n if x in df.columns), None)
        for _, row in df.iterrows():
            cl = sf(row.get(c("CBOT_Close","Closing CBOT","Close","Last","price_forecast","Adj. Close")))
            if cl is None: continue
            records.append({
                "date": row["Date"].strftime("%Y-%m-%d"), "commodity": "corn",
                "cbot_close": cl, "closing_cbot": sf(row.get(c("Closing CBOT"))) or cl,
                "cbot_open": sf(row.get(c("CBOT_Open","Open","Adj. Open"))),
                "cbot_high": sf(row.get(c("CBOT_High","High","Adj. High"))),
                "cbot_low":  sf(row.get(c("CBOT_Low","Low","Adj. Low"))),
                "dollar_rate": sf(row.get(c("Dollar Rate"))),
                "arg_price": sf(row.get(c("ARG Daily Price","ARG "))),
                "brz_price": sf(row.get(c("BRZ Daily Price","BRZ "))),
            })
        print(f"  OK {name}: {len(records)} rows")
    except Exception as e:
        print(f"  ERROR {name}: {e}")
    return records

def main():
    files = [
        "forecast_daily_november_2025_with_geo.xlsx",
        "Corn_November.xlsx",
        "forecast_daily_december_2025_point_only.xlsx",
        "Corn Jan & Feb 2026 forecast.xlsx",
        "Corn Prices for Feb 2026.xlsx",
        "Corn Daily Price (Feb-March).xlsx",
        "Corn Price Feb- March .xlsx",
        "Corn Daily Prices till 10-march updated.xlsx",
        "Corn Daily _2026-03-15 - 2026-04-10 (5).xlsx",
        "Corn Daily Prices March-April (Updated).xlsx",
        "Corn Daily Prices from 1-4 to 20-4.xlsx",
        "Corn April Prices updates.xlsx",
        "Corn cbot april-may.xlsx",
        "Corn May Forecasted Prices .xlsx",
        "Corn Daily Prices MAY-JUNE.xlsx",
        "Corn futures forecast.xlsx",
        "corn futures may-june.xlsx",
    ]
    all_records = {}
    for fname in files:
        if os.path.exists(fname):
            for r in parse_file(fname):
                all_records[r["date"]] = r
        else:
            print(f"  Not found: {fname}")
    recs = sorted(all_records.values(), key=lambda x: x["date"])
    print(f"\nTotal: {len(recs)} dates")
    if recs: print(f"Range: {recs[0]['date']} to {recs[-1]['date']}")
    for i in range(0, len(recs), 50):
        batch = recs[i:i+50]
        r = requests.post(f"{SUPABASE_URL}/rest/v1/commodity_prices", headers=HEADERS, data=json.dumps(batch))
        print(f"  Rows {i+1}-{min(i+50,len(recs))}: {r.status_code}")
    print("\nDone! Refresh your dashboard.")

if __name__ == "__main__":
    main()