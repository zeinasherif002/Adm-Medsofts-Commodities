# AdmMedSofts — Commodity Price Dashboard

Streamlit dashboard for corn, wheat, and soybean price forecasting with automated email alerts.

## Quick start

### 1. Install dependencies
```bash
pip install -r requirements.txt
```

### 2. Run the dashboard
```bash
streamlit run app.py
```
The app opens at `http://localhost:8501`

---

## How to use

### Loading data
- Upload your forecast Excel/CSV file using the sidebar uploader
- The app expects columns from your model output:
  `Date, CBOT_Low, CBOT_High, CBOT_Open, CBOT_Close, Closing CBOT, Dollar Rate,
   CBOT_Live, CBOT_Base, FUT_RET, FUT_RET_SMOOTH, ARG Daily Price, BRZ Daily Price`
- If no file is uploaded, the app runs on demo data so you can explore the layout

### Alert thresholds (sidebar)
| Setting | Meaning |
|---|---|
| Price change alert % | Fire alert if CBOT close moves by this % or more day-over-day |
| Forecast vs actual % | Fire alert if model forecast deviates from actual price by this % |

### Email setup (sidebar)
Fill in once — these are NOT saved between sessions (for security).

| Field | Value |
|---|---|
| SMTP server | `smtp.gmail.com` (Gmail) or your company SMTP |
| SMTP port | `587` (TLS) |
| Sender email | The Gmail address to send from |
| App password | Generate at myaccount.google.com → Security → App passwords |
| Recipients | One email per line |

> **Gmail app password**: Go to Google Account → Security → 2-Step Verification → App passwords.
> Generate a password for "Mail". Use this 16-character code, NOT your Gmail login password.

### Email buttons
| Button | Sends |
|---|---|
| Send daily summary | Morning digest with today's prices + any active alerts |
| Send price alert now | Immediate alert email (good for manual triggers) |
| Preview email (HTML) | Shows the email as it will look in the inbox |
| Test SMTP connection | Verifies credentials without sending an email |

---

## Adding wheat & soybeans
When your model produces files for wheat and soybeans too, add them as separate
file uploaders in the sidebar (one per commodity). The KPI cards and charts are
already structured to support multiple commodities — just duplicate the section
and point it at the new dataframe.

---

## Scheduling daily emails
To run the daily summary automatically every morning without opening the dashboard:

**Option A — cron job (Linux/Mac)**
```bash
# Add to crontab (crontab -e):
# Sends at 7:00 AM every weekday
0 7 * * 1-5 python /path/to/dashboard/send_daily.py
```

**Option B — Windows Task Scheduler**
Create a task that runs `python send_daily.py` at 7:00 AM daily.

---

## File structure
```
dashboard/
├── app.py              ← main Streamlit app
├── requirements.txt    ← Python dependencies
└── README.md           ← this file
```
