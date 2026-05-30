# GE16 Simulation Dashboard

Race-adjusted Malaysia parliamentary simulation — 222 seats, SPR voter data.

## Architecture

```
ge16-sim/
├── src/
│   ├── data/
│   │   ├── seats.js        ← seat base data (server-only)
│   │   └── race.js         ← SPR race demographics (server-only)
│   └── utils/
│       └── model.js        ← projection logic (server-only)
├── netlify/
│   └── functions/
│       └── data.js         ← secure API endpoint
├── scripts/
│   └── build.js            ← generates public/index.html
├── public/                 ← built output (git-ignored raw data)
├── .env.example
├── netlify.toml
└── package.json
```

**Security model:** All seat data, race data, and model logic live on the server inside `netlify/functions/data.js`. The browser only receives computed projections via a POST API call — never raw data arrays. An optional `API_SECRET_KEY` adds request authentication.

---

## Local setup

```bash
# 1. Clone and install
git clone https://github.com/YOUR_USERNAME/ge16-simulation.git
cd ge16-simulation
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env and set API_SECRET_KEY to any random string

# 3. Build the frontend
node scripts/build.js

# 4. Run locally (requires Netlify CLI)
npx netlify dev
# → open http://localhost:8888
```

---

## Deploy to Netlify

### Option A — Netlify CLI (fastest)

```bash
npm install -g netlify-cli
netlify login
netlify init          # link to new/existing site
netlify env:set API_SECRET_KEY "$(openssl rand -hex 32)"
netlify env:set ALLOWED_ORIGIN "https://YOUR-SITE.netlify.app"
netlify deploy --build --prod
```

### Option B — GitHub + Netlify UI

1. Push this repo to GitHub:
   ```bash
   git init
   git add .
   git commit -m "initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/ge16-simulation.git
   git push -u origin main
   ```

2. Go to [app.netlify.com](https://app.netlify.com) → **Add new site** → **Import from Git**

3. Select your repo and configure:
   | Setting | Value |
   |---|---|
   | Build command | `node scripts/build.js` |
   | Publish directory | `public` |
   | Functions directory | `netlify/functions` |

4. Set environment variables under **Site settings → Environment variables**:
   | Key | Value |
   |---|---|
   | `API_SECRET_KEY` | any random 32+ char string |
   | `ALLOWED_ORIGIN` | `https://YOUR-SITE.netlify.app` |

5. Click **Deploy site** — done.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `API_SECRET_KEY` | Recommended | Requests must include `X-API-Key` header matching this value |
| `ALLOWED_ORIGIN` | Optional | CORS restriction — limits API calls to your domain only |

If `API_SECRET_KEY` is empty, authentication is disabled (OK for dev, not recommended for prod).

---

## API reference

All requests are `POST /.netlify/functions/data` with JSON body.

### Common parameters (all actions)

```json
{
  "scen": "base",   // "base" | "best" | "worst"
  "yT": 72,         // youth turnout 40–95
  "sT": 78,         // senior turnout 50–95
  "mS": 48,         // Melayu % voting PH  0–100
  "cS": 78,         // Cina % voting PH    0–100
  "iS": 68,         // India % voting PH   0–100
  "lS": 45          // Lain-lain % voting PH 0–100
}
```

### Actions

**`summary`** — coalition totals + verdict
```json
{ "action": "summary" }
```

**`seats`** — paginated seat list with projections
```json
{
  "action": "seats",
  "filters": { "state": "Selangor", "race": "mixed", "search": "Shah" },
  "page": 1,
  "pageSize": 25
}
```

**`race-drill`** — top seats by community concentration
```json
{ "action": "race-drill", "community": "m" }
// community: "m" | "c" | "i" | "l"
```

---

## Updating data

- **Seat projections**: edit `src/data/seats.js` — column order: `[code, name, state, ge15, voters, youth%, best, base, worst, bersama_factor, pn_factor]`
- **Race demographics**: edit `src/data/race.js` — `{ "P001": [melayu%, cina%, india%, lain%] }`
- **Model logic**: edit `src/utils/model.js` — `getWinner()` function controls flip thresholds

After any change, rebuild and redeploy:
```bash
node scripts/build.js
netlify deploy --prod
```

---

## Notes

- This dashboard is for **analytical purposes only** — not a prediction tool
- Race data source: SPR Official Stat Parlimen Race & Age (Peninsular); Sabah/Sarawak estimated from census & SPR records
- Model: PKR internal tier classification + GE15 results
- Built: May 2026
