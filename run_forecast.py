"""
run_forecast.py - AdmMedSofts Daily Corn Forecast Pipeline
- Trains on monthly SnD data using RidgeCV (ARG/BRZ prices)
- Runs XGBoost for CBOT next-day forecast
- Fetches today's CBOT + dollar rate from Yahoo Finance
- Calculates MAPE vs yesterday's predictions
- Uploads record to Supabase
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

def make_lag_features(series, lags=20):
    df_f = pd.DataFrame({'y': series})
    for i in range(1, lags+1):
        df_f[f'lag_{i}'] = df_f['y'].shift(i)
    df_f['roll7']  = df_f['y'].shift(1).rolling(7).mean()
    df_f['roll14'] = df_f['y'].shift(1).rolling(14).mean()
    return df_f.dropna()

def xgb_forecast_next(series):
    try:
        from statsmodels.tsa.arima.model import ARIMA
        import warnings
        warnings.filterwarnings("ignore")
        s = series.dropna().tail(60)
        model = ARIMA(s, order=(2, 1, 2))
        result = model.fit()
        forecast = result.forecast(steps=1)
        return float(forecast.iloc[0])
    except Exception as e:
        log(f"  ARIMA failed: {e}, using last price")
        return float(series.iloc[-1])

def xgb_forecast_5days(series):
    """Forecast next 5 trading days using XGBoost."""
    try:
        from xgboost import XGBRegressor
        feat = make_lag_features(series)
        X, y = feat.drop('y', axis=1), feat['y']
        mdl = XGBRegressor(n_estimators=300, learning_rate=0.05,
                           max_depth=4, subsample=0.8,
                           colsample_bytree=0.8, random_state=42,
                           verbosity=0)
        mdl.fit(X, y)
        hist = list(series.values)
        preds = []
        for _ in range(5):
            tmp = pd.Series(hist)
            row = make_lag_features(tmp).iloc[[-1]].drop('y', axis=1)
            p = float(mdl.predict(row)[0])
            preds.append(p)
            hist.append(p)
        return preds
    except Exception as e:
        log(f"  XGBoost 5-day failed: {e}")
        last = float(series.iloc[-1])
        return [last] * 5

def upload_weekly_forecast(date, cbot_preds, arg_preds, brz_preds, commodity="corn"):
    """Upload 5-day forecast to weekly_forecast table."""
    from datetime import timedelta
    import pandas as pd
    log("Uploading weekly forecast...")
    # Delete old forecasts first
    requests.delete(
        f"{SUPABASE_URL}/rest/v1/weekly_forecast?commodity=eq.{commodity}",
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
    )
    # Generate next 5 business days
    next_days = []
    d = date
    while len(next_days) < 5:
        d = d + timedelta(days=1)
        if d.weekday() < 5:  # Monday-Friday only
            next_days.append(d)
    records = []
    for i, forecast_date in enumerate(next_days):
        records.append({
            "generated_date": date.strftime("%Y-%m-%d"),
            "forecast_date": forecast_date.strftime("%Y-%m-%d"),
            "commodity": commodity,
            "cbot_forecast": round(cbot_preds[i], 4),
            "arg_forecast": round(arg_preds[i], 2),
            "brz_forecast": round(brz_preds[i], 2),
        })
    resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/weekly_forecast",
        headers=HEADERS,
        data=json.dumps(records)
    )
    if resp.status_code in (200, 201):
        log("  Weekly forecast uploaded!")
    else:
        log(f"  Error: {resp.status_code} {resp.text}")

def fetch_market_data():
    log("Fetching CBOT corn futures from Yahoo Finance...")
    end   = datetime.today()
    start = end - timedelta(days=60)
    corn = yf.download("ZCU26.CBT", start=start, end=end, interval="1d", progress=False)
    if corn.empty:
        log("  ZCU26 failed, trying ZC=F...")
        corn = yf.download("ZC=F", start=start, end=end, interval="1d", progress=False)
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

    return corn.index[-1], today_row, dollar_rate, corn

def train_model():
    log(f"Training Ridge model from {SND_FILE}...")
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

def fetch_yesterday_close():
    """Fetch yesterday closing price to calculate return."""
    try:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/commodity_prices?commodity=eq.corn&order=date.desc&limit=2&select=date,closing_cbot",
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
        )
        rows = resp.json()
        if len(rows) >= 2:
            return float(rows[1]["closing_cbot"])
        return None
    except:
        return None

def fetch_yesterday_predictions():
    try:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/commodity_prices?commodity=eq.corn&order=date.desc&limit=2",
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
        )
        rows = resp.json()
        if len(rows) >= 1:
            return rows[0]
        return None
    except:
        return None

def calc_mape(actual, predicted):
    if predicted is None or actual is None or actual == 0:
        return None
    return round(abs((actual - predicted) / actual) * 100, 4)

def run_forecast(date, row, dollar_rate, ridge_arg, ridge_brz, stu, corn_series, yesterday_record, yesterday_close=None):
    log("Running forecast...")
    cbot = float(row["cbot_close"])
    X_today = pd.DataFrame([{"Closing CBOT": cbot, "Dollar Rate": dollar_rate, "STU": stu}])
    arg = float(ridge_arg.predict(X_today)[0])
    brz = float(ridge_brz.predict(X_today)[0])

    close_series = corn_series["cbot_close"]
    cbot_next = xgb_forecast_next(close_series)
    log(f"  CBOT next-day forecast: {cbot_next:.2f} c/bu")
    # Calculate OHLC forecast
    avg_range = float((corn_series["cbot_high"] - corn_series["cbot_low"]).tail(20).mean())
    avg_open_diff = float((corn_series["cbot_open"] - corn_series["cbot_close"].shift(1)).dropna().tail(20).mean())
    cbot_next_open = round(cbot + avg_open_diff, 2)
    cbot_next_high = round(cbot_next + avg_range * 0.6, 2)
    cbot_next_low = round(cbot_next - avg_range * 0.6, 2)
    log(f"  OHLC forecast: O:{cbot_next_open} H:{cbot_next_high} L:{cbot_next_low} C:{cbot_next:.2f}")

    mape_cbot = None
    mape_arg  = None
    mape_brz  = None

    if yesterday_record:
        if yesterday_record.get("cbot_predicted"):
            mape_cbot = calc_mape(cbot, yesterday_record["cbot_predicted"])
            log(f"  MAPE CBOT: {mape_cbot}%")
        if yesterday_record.get("arg_predicted"):
            mape_arg = calc_mape(arg, yesterday_record["arg_predicted"])
            log(f"  MAPE ARG:  {mape_arg}%")
        if yesterday_record.get("brz_predicted"):
            mape_brz = calc_mape(brz, yesterday_record["brz_predicted"])
            log(f"  MAPE BRZ:  {mape_brz}%")

    log(f"  TODAY ({date.date()}):")
    log(f"    CBOT:        {cbot:.2f} c/bu")
    log(f"    Dollar Rate: {dollar_rate:.2f} EGP/USD")
    log(f"    ARG Price:   {arg:,.2f} EGP")
    log(f"    BRZ Price:   {brz:,.2f} EGP")
    log(f"    Next CBOT:   {cbot_next:.2f} c/bu (forecast)")

    record = {
        "date":           date.strftime("%Y-%m-%d"),
        "commodity":      "corn",
        "cbot_open":      round(float(row["cbot_open"]), 4),
        "cbot_high":      round(float(row["cbot_high"]), 4),
        "cbot_low":       round(float(row["cbot_low"]),  4),
        "cbot_close":     round(cbot, 4),
        "closing_cbot":   round(cbot, 4),
        "dollar_rate":    round(dollar_rate, 4),
        "arg_price":      round(arg, 2),
        "brz_price":      round(brz, 2),
        "fut_ret": round((cbot - yesterday_close) / yesterday_close, 6) if yesterday_close else None,
        "cbot_predicted": round(cbot_next, 4),
        "predicted_open": round(cbot_next_open, 4),
        "predicted_high": round(cbot_next_high, 4),
        "predicted_low": round(cbot_next_low, 4),
        "arg_predicted":  round(arg, 2),
        "brz_predicted":  round(brz, 2),
    }

    if mape_cbot is not None: record["mape_cbot"] = mape_cbot
    if mape_arg  is not None: record["mape_arg"]  = mape_arg
    if mape_brz  is not None: record["mape_brz"]  = mape_brz

    return record

def upload(record):
    log("Uploading to Supabase...")
    resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/commodity_prices",
        headers=HEADERS,
        data=json.dumps([record])
    )
    if resp.status_code in (200, 201):
        log("  Upload successful!")
    else:
        log(f"  Error: {resp.status_code} {resp.text}")


def fetch_market_data_wheat():
    log("Fetching CBOT wheat futures from Yahoo Finance...")
    end = datetime.today()
    start = end - timedelta(days=60)
    wheat = yf.download("ZW=F", start=start, end=end, interval="1d", progress=False)
    if wheat.empty:
        raise ValueError("Could not fetch wheat data.")
    if isinstance(wheat.columns, pd.MultiIndex):
        wheat.columns = [col[0] for col in wheat.columns]
    wheat = wheat[["Open","High","Low","Close"]].copy()
    wheat.columns = ["cbot_open","cbot_high","cbot_low","cbot_close"]
    wheat = wheat.dropna()
    today_row = wheat.iloc[-1]
    log(f"  Latest wheat: {wheat.index[-1].date()} @ {today_row['cbot_close']:.2f} c/bu")
    return wheat.index[-1], today_row, wheat

def parse_snd_file():
    """Parse new S&D file into monthly dataframe."""
    try:
        df = pd.read_excel("Supply  Demand_.xlsx", sheet_name="S&D ", header=None)
        months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
        rows = []
        for i in range(len(df)):
            val = df.iloc[i, 1]
            if val in [2023, 2024, 2025, 2026]:
                year = int(val)
                block = df.iloc[i:i+25]
                for j, month in enumerate(months):
                    col = j + 2
                    row = {"Month": f"{month}-{str(year)[2:]}"}
                    for k in range(len(block)):
                        label = str(block.iloc[k, 1]).strip()
                        try:
                            raw = str(block.iloc[k, col]).strip().replace(" ","").replace("-","0")
                            val2 = float(raw)
                            if "Imports" in label: row["Imports"] = val2
                            if "Stock/Use" in label: row["STU"] = val2
                            if "Use- Total" in label: row["Demand"] = val2
                            if "Ending Stock" in label: row["Ending_Stock"] = val2
                        except: pass
                    rows.append(row)
        return pd.DataFrame(rows)
    except Exception as e:
        log(f"  Could not parse S&D file: {e}")
        return None

def train_model_wheat():
    log("Training Ridge model from Wheat.xlsx + S&D file...")
    # Load Wheat.xlsx for prices, CBOT, dollar rate
    wheat = pd.read_excel("Wheat.xlsx", sheet_name="SnD")
    wheat.columns = wheat.columns.astype(str).str.strip()
    for c in wheat.columns:
        wheat[c] = pd.to_numeric(wheat[c], errors="coerce")
    if "Local Fees" not in wheat.columns or wheat["Local Fees"].isna().all():
        wheat["Local Fees"] = 600

    # Try to merge with new S&D file
    snd = parse_snd_file()
    if snd is not None and len(snd) > 0:
        log(f"  Merging with new S&D data ({len(snd)} months)")
        # Merge on Month if wheat has Month column
        if "Month" in wheat.columns:
            snd["Month"] = snd["Month"].astype(str).str.strip()
            wheat["Month"] = wheat["Month"].astype(str).str.strip()
            merged = wheat.merge(snd[["Month","STU","Imports","Demand"]], on="Month", how="left", suffixes=("_old",""))
            # Use new STU/Imports/Demand where available
            for col in ["STU","Imports","Demand"]:
                if col+"_old" in merged.columns:
                    merged[col] = merged[col].fillna(merged[col+"_old"])
                    merged.drop(columns=[col+"_old"], inplace=True)
            hist = merged.dropna(subset=["Closing CBOT","Dollar Rate","Price 11.5%","Price 12.5%"]).copy()
        else:
            hist = wheat.dropna(subset=["Closing CBOT","Dollar Rate","Price 11.5%","Price 12.5%"]).copy()
        # Get latest STU from new S&D
        latest_stu = snd["STU"].dropna().iloc[-1] if "STU" in snd.columns else None
    else:
        hist = wheat.dropna(subset=["Closing CBOT","Dollar Rate","Price 11.5%","Price 12.5%"]).copy()
        latest_stu = None

    log(f"  Training on {len(hist)} monthly rows")
    # Compute Replacement
    hist["Replacement"] = (hist["Closing CBOT"] * hist["Dollar Rate"] / 27.216) + hist.get("Local Fees", 600)
    # Fill missing STU
    if "STU" not in hist.columns or hist["STU"].isna().all():
        hist["STU"] = hist["Ending Stock"] / hist["Demand"] if "Ending Stock" in hist.columns else 2.5
    hist["STU"] = pd.to_numeric(hist["STU"], errors="coerce").fillna(2.5)

    feature_cols = ["Closing CBOT","Dollar Rate","STU","Local Fees","Replacement"]
    if "Imports" in hist.columns and hist["Imports"].notna().sum() > 5:
        feature_cols.append("Imports")
    if "Demand" in hist.columns and hist["Demand"].notna().sum() > 5:
        feature_cols.append("Demand")
    feature_cols = [c for c in feature_cols if c in hist.columns]
    X = hist[feature_cols].fillna(hist[feature_cols].mean())

    def fit_ridge(X, y):
        return Pipeline([("scaler", StandardScaler()),("ridge", RidgeCV(alphas=[0.01,0.1,1.0,10.0,50.0]))]).fit(X, y)
    ridge_115 = fit_ridge(X, hist["Price 11.5%"])
    ridge_125 = fit_ridge(X, hist["Price 12.5%"])

    # Get latest STU
    if latest_stu is not None:
        stu = float(latest_stu)
    else:
        stu = float(hist["STU"].iloc[-1])
    # Get latest Imports and Demand from S&D
    latest_imports = float(snd["Imports"].dropna().iloc[-1]) if snd is not None and "Imports" in snd.columns else 700
    latest_demand = float(snd["Demand"].dropna().iloc[-1]) if snd is not None and "Demand" in snd.columns else 683

    log(f"  Latest STU: {stu:.4f}")
    log(f"  Features used: {feature_cols}")
    return ridge_115, ridge_125, stu, feature_cols, latest_imports, latest_demand

def fetch_usda_conditions():
    """Fetch latest USDA crop conditions and save to Supabase."""
    try:
        log("Fetching USDA crop conditions...")
        key = "35261C14-1718-33EA-8A82-9771679304D0"
        url = f"https://quickstats.nass.usda.gov/api/api_GET/?key={key}&commodity_desc=CORN&statisticcat_desc=CONDITION&year=2026&format=JSON&state_name=US+TOTAL"
        r = requests.get(url, timeout=15)
        data = r.json().get("data", [])
        if not data:
            log("  No USDA data found")
            return
        latest_week = max(d["week_ending"] for d in data)
        week_data = [d for d in data if d["week_ending"] == latest_week]
        conditions = {}
        for d in week_data:
            unit = d.get("unit_desc", "")
            val = d.get("Value", "0").replace(",","").strip()
            try:
                if "EXCELLENT" in unit: conditions["excellent_pct"] = float(val)
                elif "GOOD" in unit: conditions["good_pct"] = float(val)
                elif "FAIR" in unit: conditions["fair_pct"] = float(val)
                elif "POOR" in unit and "VERY" not in unit: conditions["poor_pct"] = float(val)
            except: pass
        record = {"week_ending": latest_week, "commodity": "corn", **conditions}
        requests.delete(f"{SUPABASE_URL}/rest/v1/usda_conditions?commodity=eq.corn", headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"})
        resp = requests.post(f"{SUPABASE_URL}/rest/v1/usda_conditions", headers=HEADERS, data=json.dumps([record]))
        if resp.status_code in (200, 201):
            log(f"  USDA conditions saved! Excellent: {conditions.get('excellent_pct')}% Good: {conditions.get('good_pct')}%")
        else:
            log(f"  USDA upload error: {resp.status_code} {resp.text}")
    except Exception as e:
        log(f"  USDA fetch failed: {e}")


def fetch_wasde_preanalysis():
    """Generate pre-WASDE analysis for corn."""
    try:
        log("Generating pre-WASDE analysis...")
        key = "35261C14-1718-33EA-8A82-9771679304D0"
        url_acres = f"https://quickstats.nass.usda.gov/api/api_GET/?key={key}&commodity_desc=CORN&statisticcat_desc=AREA+PLANTED&unit_desc=ACRES&year=2026&agg_level_desc=NATIONAL&format=JSON"
        r_acres = requests.get(url_acres, timeout=15)
        acres_data = r_acres.json().get("data", [])
        planted_acres = float(acres_data[0]["Value"].replace(",","")) if acres_data else 95338000
        url_cond = f"https://quickstats.nass.usda.gov/api/api_GET/?key={key}&commodity_desc=CORN&statisticcat_desc=CONDITION&year=2026&agg_level_desc=NATIONAL&format=JSON&state_name=US+TOTAL"
        r_cond = requests.get(url_cond, timeout=15)
        cond_data = r_cond.json().get("data", [])
        ge_pct = 0
        for d in cond_data:
            if "EXCELLENT" in d.get("unit_desc","") or "GOOD" in d.get("unit_desc",""):
                try: ge_pct += float(d["Value"])
                except: pass
        weeks = len(set(d["week_ending"] for d in cond_data if "EXCELLENT" in d.get("unit_desc","")))
        ge_pct = ge_pct / max(weeks, 1) if weeks > 1 else ge_pct
        trend_yield = 182.0
        avg_ge = 68.0
        estimated_yield = round(trend_yield + (ge_pct - avg_ge) * 0.5, 1)
        bullish_yield = round(estimated_yield - 3, 1)
        bearish_yield = round(estimated_yield + 3, 1)
        estimated_prod = round(planted_acres * 0.916 * estimated_yield / 1e9, 2)
        prev_year_prod = 15.14
        if estimated_prod < prev_year_prod - 0.3:
            price_impact = "BULLISH - Production below last year, expect price support"
        elif estimated_prod > prev_year_prod + 0.3:
            price_impact = "BEARISH - Production above last year, expect price pressure"
        else:
            price_impact = "NEUTRAL - Production near last year, limited directional bias"
        log(f"  Planted acres: {planted_acres/1e6:.1f}M")
        log(f"  G+E condition: {ge_pct:.1f}%")
        log(f"  Estimated yield: {estimated_yield} bu/acre")
        log(f"  Estimated production: {estimated_prod}B bu")
        log(f"  Price impact: {price_impact}")
        record = {"report_date": "2026-07-10", "commodity": "corn", "planted_acres": planted_acres, "ge_condition": round(ge_pct, 1), "estimated_yield": estimated_yield, "estimated_production": estimated_prod, "prev_year_production": prev_year_prod, "bullish_scenario_yield": bullish_yield, "bearish_scenario_yield": bearish_yield, "price_impact": price_impact}
        requests.delete(f"{SUPABASE_URL}/rest/v1/wasde_analysis?commodity=eq.corn", headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"})
        resp = requests.post(f"{SUPABASE_URL}/rest/v1/wasde_analysis", headers=HEADERS, data=json.dumps([record]))
        if resp.status_code in (200, 201):
            log("  WASDE pre-analysis saved!")
        else:
            log(f"  WASDE error: {resp.status_code} {resp.text}")
    except Exception as e:
        log(f"  WASDE analysis failed: {e}")


def fetch_wasde_preanalysis_wheat():
    """Generate pre-WASDE analysis for wheat."""
    try:
        log("Generating pre-WASDE wheat analysis...")
        key = "35261C14-1718-33EA-8A82-9771679304D0"
        # Get wheat planted acres
        url_acres = f"https://quickstats.nass.usda.gov/api/api_GET/?key={key}&commodity_desc=WHEAT&statisticcat_desc=AREA+PLANTED&unit_desc=ACRES&year=2026&agg_level_desc=NATIONAL&format=JSON"
        r_acres = requests.get(url_acres, timeout=15)
        acres_data = r_acres.json().get("data", [])
        planted_acres = float(acres_data[0]["Value"].replace(",","")) if acres_data else 43800000

        # Get wheat crop conditions
        url_cond = f"https://quickstats.nass.usda.gov/api/api_GET/?key={key}&commodity_desc=WHEAT&statisticcat_desc=CONDITION&year=2026&agg_level_desc=NATIONAL&format=JSON&state_name=US+TOTAL"
        r_cond = requests.get(url_cond, timeout=15)
        cond_data = r_cond.json().get("data", [])
        ge_pct = 0
        for d in cond_data:
            if "EXCELLENT" in d.get("unit_desc","") or "GOOD" in d.get("unit_desc",""):
                try: ge_pct += float(d["Value"])
                except: pass
        weeks = len(set(d["week_ending"] for d in cond_data if "EXCELLENT" in d.get("unit_desc","")))
        ge_pct = ge_pct / max(weeks, 1) if weeks > 1 else ge_pct

        # Wheat yield estimation
        trend_yield = 49.5  # bu/acre trend
        avg_ge = 52.0  # wheat historical average G+E
        estimated_yield = round(trend_yield + (ge_pct - avg_ge) * 0.3, 1)
        bullish_yield = round(estimated_yield - 2, 1)
        bearish_yield = round(estimated_yield + 2, 1)
        estimated_prod = round(planted_acres * 0.83 * estimated_yield / 1e6, 0)  # million bushels
        prev_year_prod = 2210  # million bushels 2025

        if estimated_prod < prev_year_prod * 0.97:
            price_impact = "BULLISH - Production below last year, expect price support"
        elif estimated_prod > prev_year_prod * 1.03:
            price_impact = "BEARISH - Production above last year, expect price pressure"
        else:
            price_impact = "NEUTRAL - Production near last year, limited directional bias"

        log(f"  [WHEAT] Planted acres: {planted_acres/1e6:.1f}M")
        log(f"  [WHEAT] G+E condition: {ge_pct:.1f}%")
        log(f"  [WHEAT] Estimated yield: {estimated_yield} bu/acre")
        log(f"  [WHEAT] Estimated production: {estimated_prod}M bu")
        log(f"  [WHEAT] Price impact: {price_impact}")

        record = {"report_date": "2026-07-10", "commodity": "wheat", "planted_acres": planted_acres, "ge_condition": round(ge_pct, 1), "estimated_yield": estimated_yield, "estimated_production": estimated_prod/1000, "prev_year_production": prev_year_prod/1000, "bullish_scenario_yield": bullish_yield, "bearish_scenario_yield": bearish_yield, "price_impact": price_impact}
        requests.delete(f"{SUPABASE_URL}/rest/v1/wasde_analysis?commodity=eq.wheat", headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"})
        resp = requests.post(f"{SUPABASE_URL}/rest/v1/wasde_analysis", headers=HEADERS, data=json.dumps([record]))
        if resp.status_code in (200, 201):
            log("  Wheat WASDE pre-analysis saved!")
        else:
            log(f"  Wheat WASDE error: {resp.status_code} {resp.text}")
    except Exception as e:
        log(f"  Wheat WASDE failed: {e}")

def generate_ai_analysis(commodity, record):
    """Generate AI market analysis using Claude API."""
    try:
        import os
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not api_key:
            log("  No ANTHROPIC_API_KEY found, skipping AI analysis")
            return None
        log(f"  Generating AI analysis for {commodity}...")
        cbot = record["closing_cbot"]
        dollar = record["dollar_rate"]
        arg = record["arg_price"]
        brz = record["brz_price"]
        is_wheat = commodity == "wheat"
        prompt = f"""You are a commodity market analyst for Egyptian grain trading.
Analyze this data and give a concise professional report:

COMMODITY: {commodity.upper()}
DATE: {record["date"]}
CBOT: {cbot} c/bu | O:{record.get("cbot_open","-")} H:{record.get("cbot_high","-")} L:{record.get("cbot_low","-")}
DOLLAR: {dollar} EGP/USD
{"11.5%: " + str(round(arg)) + " EGP | 12.5%: " + str(round(brz)) + " EGP" if is_wheat else "ARG: " + str(round(arg)) + " EGP | BRZ: " + str(round(brz)) + " EGP"}
NEXT FORECAST: {record.get("cbot_predicted","-")} c/bu

Give: 1) Price action 2) Technical outlook 3) Egypt local market impact 4) Recommendation with key levels. Max 300 words."""

        resp = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            json={"model": "claude-haiku-4-5", "max_tokens": 800, "messages": [{"role": "user", "content": prompt}]},
            timeout=30
        )
        if resp.status_code == 200:
            analysis = resp.json()["content"][0]["text"]
            log(f"  AI analysis generated ({len(analysis)} chars)")
            requests.delete(f"{SUPABASE_URL}/rest/v1/ai_analysis?date=eq.{record['date']}&commodity=eq.{commodity}", headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"})
            requests.post(f"{SUPABASE_URL}/rest/v1/ai_analysis", headers=HEADERS, data=json.dumps([{"date": record["date"], "commodity": commodity, "analysis": analysis}]))
            log("  AI analysis saved!")
            return analysis
        else:
            log(f"  AI API error: {resp.status_code}")
            return None
    except Exception as e:
        log(f"  AI analysis failed: {e}")
        return None


def main():
    print("=" * 55)
    print("  AdmMedSofts - Daily Forecast Pipeline")
    print(f"  {datetime.today().strftime('%A, %d %B %Y %H:%M')}")
    print("=" * 55)

    # CORN
    date, row, dollar_rate, corn_series = fetch_market_data()
    ridge_arg, ridge_brz, stu = train_model()
    yesterday_record = fetch_yesterday_predictions()
    yesterday_close = fetch_yesterday_close()
    record = run_forecast(date, row, dollar_rate, ridge_arg, ridge_brz, stu, corn_series, yesterday_record, yesterday_close)
    upload(record)
    log("Generating 5-day corn weekly forecast...")
    cbot_5 = xgb_forecast_5days(corn_series["cbot_close"])
    arg_5 = [float(ridge_arg.predict(pd.DataFrame([{"Closing CBOT": p, "Dollar Rate": dollar_rate, "STU": stu}]))[0]) for p in cbot_5]
    brz_5 = [float(ridge_brz.predict(pd.DataFrame([{"Closing CBOT": p, "Dollar Rate": dollar_rate, "STU": stu}]))[0]) for p in cbot_5]
    upload_weekly_forecast(date, cbot_5, arg_5, brz_5, commodity="corn")

    # WHEAT
    try:
        print()
        log("Starting wheat forecast...")
        w_date, w_row, wheat_series = fetch_market_data_wheat()
        ridge_115, ridge_125, w_stu, w_features, w_imports, w_demand = train_model_wheat()
        w_cbot = float(w_row["cbot_close"])
        # Direct replacement formula + rolling basis
        BU_PER_TON = 1000.0 / 27.2155
        FREIGHT = 25.0
        w_local_fees = 459
        formula_price = ((w_cbot / 100) * BU_PER_TON + FREIGHT) * dollar_rate + w_local_fees
        try:
            wheat_df = pd.read_excel("Wheat.xlsx", sheet_name="SnD")
            wheat_df["formula"] = ((wheat_df["Closing CBOT"] / 100) * BU_PER_TON + FREIGHT) * wheat_df["Dollar Rate"] + wheat_df["Local Fees"].fillna(459)
            hist_115 = wheat_df.dropna(subset=["Price 11.5%","formula"])
            hist_115 = hist_115[hist_115["Price 11.5%"] > 0]
            hist_125 = wheat_df.dropna(subset=["Price 12.5%","formula"])
            hist_125 = hist_125[hist_125["Price 12.5%"] > 0]
            basis_115 = float((hist_115["Price 11.5%"] - hist_115["formula"]).tail(6).mean())
            basis_125 = float((hist_125["Price 12.5%"] - hist_125["formula"]).tail(6).mean())
            log(f"  Rolling basis 11.5%: {basis_115:,.0f} EGP | 12.5%: {basis_125:,.0f} EGP")
        except Exception as e:
            log(f"  Basis calculation failed: {e}, using defaults")
            basis_115 = 782
            basis_125 = 915
        w_arg = formula_price + basis_115
        w_brz = formula_price + basis_125
        if w_brz < w_arg + 250:
            w_brz = w_arg + 250
        log(f"  11.5% Price: {w_arg:,.0f} EGP | 12.5% Price: {w_brz:,.0f} EGP")
        w_next = xgb_forecast_next(wheat_series["cbot_close"])
        # Calculate MAPE for wheat
        w_yesterday = None
        try:
            wresp = requests.get(f"{SUPABASE_URL}/rest/v1/commodity_prices?commodity=eq.wheat&order=date.desc&limit=2", headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"})
            wrows = wresp.json()
            if len(wrows) >= 2: w_yesterday = wrows[1]
        except: pass
        w_mape_cbot = calc_mape(w_cbot, w_yesterday.get("cbot_predicted")) if w_yesterday and w_yesterday.get("cbot_predicted") else None
        w_mape_arg = calc_mape(w_arg, w_yesterday.get("arg_predicted")) if w_yesterday and w_yesterday.get("arg_predicted") else None
        w_mape_brz = calc_mape(w_brz, w_yesterday.get("brz_predicted")) if w_yesterday and w_yesterday.get("brz_predicted") else None
        if w_mape_cbot: log(f"  MAPE CBOT: {w_mape_cbot}%")
        if w_mape_arg: log(f"  MAPE ARG: {w_mape_arg}%")
        # Get yesterday wheat close for fut_ret
        w_yesterday_close = None
        try:
            wr = requests.get(f"{SUPABASE_URL}/rest/v1/commodity_prices?commodity=eq.wheat&order=date.desc&limit=2", headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"})
            wrows = wr.json()
            if len(wrows) >= 2: w_yesterday_close = float(wrows[1]["closing_cbot"])
        except: pass
        # Get yesterday wheat close for fut_ret
        w_yesterday_close = None
        try:
            wr = requests.get(f"{SUPABASE_URL}/rest/v1/commodity_prices?commodity=eq.wheat&order=date.desc&limit=2", headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"})
            wrows = wr.json()
            if len(wrows) >= 2: w_yesterday_close = float(wrows[1]["closing_cbot"])
        except: pass
        w_record = {
            "date": w_date.strftime("%Y-%m-%d"),
            "commodity": "wheat",
            "fut_ret": round((w_cbot - w_yesterday_close) / w_yesterday_close, 6) if w_yesterday_close else None,
            "fut_ret": round((w_cbot - w_yesterday_close) / w_yesterday_close, 6) if w_yesterday_close else None,
            "cbot_open": round(float(w_row["cbot_open"]), 4),
            "cbot_high": round(float(w_row["cbot_high"]), 4),
            "cbot_low": round(float(w_row["cbot_low"]), 4),
            "cbot_close": round(w_cbot, 4),
            "closing_cbot": round(w_cbot, 4),
            "dollar_rate": round(dollar_rate, 4),
            "arg_price": round(w_arg, 2),
            "brz_price": round(w_brz, 2),
            "cbot_predicted": round(w_next, 4),
            "arg_predicted": round(w_arg, 2),
            "brz_predicted": round(w_brz, 2),
        }
        if w_mape_cbot: w_record["mape_cbot"] = w_mape_cbot
        if w_mape_arg: w_record["mape_arg"] = w_mape_arg
        if w_mape_brz: w_record["mape_brz"] = w_mape_brz
        requests.delete(
            f"{SUPABASE_URL}/rest/v1/commodity_prices?date=eq.{w_date.strftime('%Y-%m-%d')}&commodity=eq.wheat",
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
        )
        resp = requests.post(f"{SUPABASE_URL}/rest/v1/commodity_prices", headers=HEADERS, data=json.dumps([w_record]))
        if resp.status_code in (200, 201):
            log("  Wheat upload successful!")
        else:
            log(f"  Wheat error: {resp.status_code} {resp.text}")
        w_cbot_5 = xgb_forecast_5days(wheat_series["cbot_close"])
        w_arg_5 = []
        w_brz_5 = []
        for p in w_cbot_5:
            w_rep = (p * dollar_rate / 27.216) + 600
            X_wp = pd.DataFrame([[{"Closing CBOT": p, "Dollar Rate": dollar_rate, "STU": w_stu, "Local Fees": 600, "Replacement": w_rep, "Imports": w_imports, "Demand": w_demand}.get(f, 0) for f in w_features]], columns=w_features)
            a5 = float(ridge_115.predict(X_wp)[0])
            b5 = float(ridge_125.predict(X_wp)[0])
            if b5 < a5 + 250:
                b5 = a5 + 250
            w_arg_5.append(a5)
            w_brz_5.append(b5)
        upload_weekly_forecast(w_date, w_cbot_5, w_arg_5, w_brz_5, commodity="wheat")
    except Exception as e:
        log(f"  Wheat forecast failed: {e}")

    fetch_usda_conditions()
    fetch_wasde_preanalysis()
    fetch_wasde_preanalysis_wheat()
    import os
    if os.environ.get("ANTHROPIC_API_KEY"):
        generate_ai_analysis("corn", record)
        generate_ai_analysis("wheat", w_record)
    print("\nPipeline complete! Dashboard is now up to date.")

if __name__ == "__main__":
    main()

# This line intentionally left to mark end of restored file
