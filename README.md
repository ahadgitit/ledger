# Ledger: expense dashboard

A standalone version of the Claude expense dashboard. It reads the **Monthly Expense
Tracking** Google Sheet straight from your browser and shows payday cycles or calendar
months, category comparisons, subscriptions and bills, the daily spend limit, and an
overspend warning.

It is a static site (HTML, CSS, JS, with no build step and no server). It is hosted on GitHub
Pages at **https://ahadgitit.github.io/ledger/**.

## How access works

- You sign in with Google in the page. It asks to see and edit your spreadsheets
  (`spreadsheets`), so it can add entries and update balances as well as read.
- The browser calls the Google Sheets API directly. No other server sees your data.
- The sign-in token is kept in `sessionStorage`, so it goes away when you close the tab.
  Google tokens last one hour. After that, press **Sign in with Google** again.
- The last copy of the sheet is cached in `localStorage` so the page opens instantly.
  **Sign out** revokes the token and deletes that copy.
- Anyone can open the URL, but without a Google account that can read the sheet they
  only see the sign-in screen.

## Adding entries and updating balances

- **Add entry** (the **+** button on a phone) opens a form with the sheet's own fields: amount,
  what it was, description, category, payment mode and date. Picking a name you have used
  before fills in its usual category, payment mode and recent descriptions.
  - The row goes into columns A to F, right after the last entry of the latest month. It is
    read back to check it landed, and **Undo** clears it again.
  - Amounts are written as numbers, money in as a negative number, and dates as
    `dd/mm/yyyy` text, the same as rows typed by hand.
  - The entry also updates its account in column G: spending lowers it, money in raises
    it, and savings rows are left alone. This keeps the sheet's offset at 0. You can untick
    this on the form.
- The **Accounts** card shows ABL, Sadapay and Cash and compares what your accounts hold
  with what your entries say. The difference is the sheet's offset (`(Total - savings) - Remaining`).
  It shows **In sync** when they match and flags the gap when they don't.
- **Balances** edits the ABL, Sadapay and Cash figures for any month. These are the cells
  under those labels in the month's column G block. Only those cells change, so Total and
  Remaining keep their formulas. **Undo** puts back exactly what was there, formulas included.

## Android app

Every push builds a signed Android app on GitHub Actions and publishes it next to the site:
**https://ahadgitit.github.io/ledger/ledger.apk**. You can also find it in the command palette ("Get the Android app") and on the sign-in screen.

- It is a Trusted Web Activity: it opens the hosted workspace in Chrome's engine. Google sign-in, storage and updates therefore behave as on the website, and changes to the site show up in the app without reinstalling.
- Inside the app, sign-in goes to Google's page and comes back, because Google does not allow its sign-in popup in app views. **One-time setup:** add `https://ahadgitit.github.io/ledger/` under **Authorized redirect URIs** of the OAuth client in Google Cloud.
- To install it, open the APK on the phone and allow "Install unknown apps" for your browser when Android asks. The app is not on the Play Store.
- The app shows a small address bar at the top until Android can verify the site. Verification needs `https://ahadgitit.github.io/.well-known/assetlinks.json`, which lives at the root of the domain, so it requires a separate `ahadgitit.github.io` repository with that file. The key's SHA-256 fingerprint is
  `8F:E7:B1:59:51:D9:9D:02:66:01:AF:D6:CE:94:E4:53:72:0E:9F:E9:28:93:22:36:28:06:2D:AD:44:66:AF:26`.
- The signing key is `android/ledger.keystore` and is committed for convenience. To use a private key, set the `LEDGER_KEYSTORE_*` environment variables in the workflow from repository secrets.
- The site is also an installable web app: in Chrome, use "Add to Home screen".

## One-time setup

### 1. Turn on GitHub Pages

In the repo, go to **Settings → Pages → Build and deployment → Source** and choose
**GitHub Actions**. After that, every push to `main` (or the
`claude/dashboard-standalone-service-j5hhan` branch) runs `.github/workflows/pages.yml`
and deploys the site. You can also run it by hand from the **Actions** tab.

### 2. Create a Google OAuth client ID (about 5 minutes)

1. Open <https://console.cloud.google.com/> and create a project, for example `ledger`.
2. Go to **APIs & Services → Library**, search for **Google Sheets API** and click **Enable**.
3. Go to **APIs & Services → OAuth consent screen** (on newer consoles it is called
   **Google Auth Platform → Branding / Audience**):
   - User type: **External**
   - App name: `Ledger`, plus your email for support and developer contact
   - Scopes: add `.../auth/spreadsheets`
   - **Test users**: add your own Gmail address. While the app stays in *Testing*, only
     test users can sign in, and that is what you want.
4. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - **Authorized JavaScript origins**: `https://ahadgitit.github.io`
     (add `http://localhost:8000` too if you want to run it locally)
   - You do not need any redirect URIs.
5. Copy the **Client ID**. It ends in `.apps.googleusercontent.com`.

### 3. Give the site the client ID

You can do this in either of two ways:

- **For every device (recommended):** paste it into `clientId` in `config.js`, then commit
  and push. A client ID is not a secret, so it is safe to keep in a public repo.
- **For one browser only:** open the site and paste it into the setup form.

`sheetId` in `config.js` already points at the Monthly Expense Tracking sheet. Change it if
you move to a different sheet. The sheet must keep its `Tracking` tab with columns A to G
(Expense, Amount, Description, Date, Payment mode, Category, balance notes). It can also have
a `Dashboard Data` tab with a `Cycle | Income | Spent | Saved` table for the Payout figure.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000 (the origin must be listed in the OAuth client)
```

## Workspaces

- **Overview** is the command centre:
  - a KPI strip
  - **Spend trajectory**: cumulative spend with switchable layers for the previous cycle, an even pace to payday and the largest expenses, plus a crosshair that lists each day's transactions
  - **Signals**: automatic alerts for overspending, account offset, bills due, pace and category changes
  - **Accounts**: reconciliation with the sheet's offset
  - the daily limit, bills, a category treemap, change against the previous period, a 22-week activity heatmap, payment rails, InDrive rides and the largest transactions
- **Flows** is a money-flow diagram from account to category to item, with money in and transfers between accounts.
- **Explorer** is an object browser for transactions and items. It has facets (category, payment mode, amount, scope), sortable columns, and an inspector that shows each object's properties, linked item, history and a link to its row in the sheet.
- **Forecast** answers one question for the current month: will this month's **Pay myself** stay untouched until the 20th of next month (the latest payday)?
  - the money you have to spend: column G's Remaining (already after Pay myself) minus bills still due before payday
  - the chance your usual spending fits in that, with a verdict (Likely untouched / Tight / At risk)
  - how much to spend on **food** and how much buffer is left for **everything else**, in total and per day
  - your daily limit against your usual daily spend, and how much would likely come out of Pay myself if you spend as usual

  How it works: everyday spending (food, getting around, personal) is a moving-block bootstrap of your own 7-day stretches, with recent weeks weighted more (60-day half-life) and stretches with nothing logged skipped. One-off buys of Rs 3,000 or more are a separate compound-Poisson process. 4,000 seeded simulations of the days until payday give the chance and the range. Touheed, Mama, renovation and transfers are not included.
- **Ctrl/Cmd + K** opens a command palette to jump to views, actions, items and transactions.

## Files

| File | What it does |
| --- | --- |
| `index.html` | The app shell: top bar, context bar, status bar and dialogs |
| `styles.css` | Dark Foundry/Blueprint-style theme. Category colours use a fixed slot order checked for colour-blind separation on the panel surface |
| `logic.js` | Parsing and calculations: cycles, months, categories, subscriptions, spend limit, rides |
| `viz.js` | Chart building blocks: scales, squarified treemap, flow layout, sparklines, sequential ramp |
| `app.js` | Google sign-in, Sheets API calls, caching and change notifications |
| `views.js` | Overview, Flows, Explorer, inspector and command palette |
| `forecast.js` | This month’s Pay myself forecast (bootstrap + compound Poisson Monte Carlo) and the Forecast workspace |
| `editor.js` | The Log entry form and the balances editor |
| `config.js` | OAuth client ID and sheet ID |
| `manifest.webmanifest`, `sw.js`, `icons/` | Installable web app: manifest, offline shell, icons |
| `android/` | Android app project (Trusted Web Activity), built by the workflow |
| `.github/workflows/pages.yml` | Deploys to GitHub Pages |

Settings that live in `logic.js`: payday on the 20th (`PAYDAY_DOM`), a 10% buffer
(`BUFFER`), and the subscription list (`SUBS`).
