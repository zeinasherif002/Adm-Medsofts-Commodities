import argparse
import pandas as pd
import requests
import json

SUPABASE_URL = "https://cupcsspfmkgbcovtgszm.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1cGNzc3BmbWtnYmNvdnRnc3ptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzI4ODMsImV4cCI6MjA5NDg0ODg4M30.Y8o09mcvdJuSSfgsVGnhoUyRpIUPVl8-gkigJXXee8E"
HEADERS = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates"}

parser = argparse.ArgumentParser()
parser.add_argument("--file", required=True)
args = parser.parse_args()

df = pd.read_excel(args.file)
df["Date"] = pd.to_datetime(df["Date"])

records = []
for _, row in df.iterrows():
    records.append({
        "date": row["Date"].strftime("%Y-%m-%d"),
        "commodity": "corn",
        "closing_cbot": round(float(row["Closing CBOT"]), 4),
        "dollar_rate": round(float(row["Dollar Rate"]), 4),
        "arg_price": round(float(row["ARG Daily Price"]), 2),
        "brz_price": round(float(row["BRZ Daily Price"]), 2),
    })

resp = requests.post(f"{SUPABASE_URL}/rest/v1/commodity_prices", headers=HEADERS, data=json.dumps(records))
print(f"Status: {resp.status_code}")
print(f"Uploaded {len(records)} rows!" if resp.status_code in (200, 201) else resp.text)