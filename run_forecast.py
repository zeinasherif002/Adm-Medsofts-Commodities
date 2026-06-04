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

def main():
    print("=" * 55)
    print("  AdmMedSofts - Daily Corn Forecast Pipeline")
    print(f"  {datetime.today().strftime('%A, %d %B %Y %H:%M')}")
    print("=" * 55)
    date, row, dollar_rate, corn_series = fetch_market_data()
    ridge_arg, ridge_brz, stu = train_model()
    yesterday_record = fetch_yesterday_predictions()
    yesterday_close = fetch_yesterday_close()
    record = run_forecast(date, row, dollar_rate, ridge_arg, ridge_brz, stu, corn_series, yesterday_record, yesterday_close)
    upload(record)

    # 5-day weekly forecast
    log("Generating 5-day weekly forecast...")
    close_series = corn_series["cbot_close"]
    cbot_5 = xgb_forecast_5days(close_series)
    arg_5 = []
    brz_5 = []
    for cbot_pred in cbot_5:
        X_pred = pd.DataFrame([{"Closing CBOT": cbot_pred, "Dollar Rate": dollar_rate, "STU": stu}])
        arg_5.append(float(ridge_arg.predict(X_pred)[0]))
        brz_5.append(float(ridge_brz.predict(X_pred)[0]))
    upload_weekly_forecast(date, cbot_5, arg_5, brz_5)
    print("\nPipeline complete! Dashboard is now up to date.")

if __name__ == "__main__":
    main()
