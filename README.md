# Ledger: expense dashboard

A standalone version of the Claude expense dashboard. It reads the **Monthly Expense
Tracking** Google Sheet straight from your browser and shows payday cycles or calendar
months, category comparisons, subscriptions and bills, a budget for the rest of the month, and an
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
  - bills and subscriptions with editable amounts (a paid bill's amount is changed in its sheet row; a due amount is your estimate, shared with Forecast), a category treemap, change against the previous period, a 22-week activity heatmap, payment rails (ABL, Sadapay and Cash), InDrive rides and the largest transactions
- **Flows** is a money-flow diagram from account to category to item, with money in and transfers between accounts.
- **Explorer** is an object browser for transactions and items. It has facets (category, payment mode, amount, scope), sortable columns, and an inspector that shows each object's properties, linked item, history and a link to its row in the sheet.
- **Forecast** is a budget for the rest of the current payday cycle (today until the 20th of next month, the latest payday) that answers: can this month's **Pay myself** stay untouched?
  - **Predict food or shopping.** To predict food, you must set a shopping cap. To predict shopping, you must set a food cap, either as a total or as a daily limit until payday (the other figure fills in). Neither has a default; a button fills in your usual amount if you want it.
  - **Food limit and the days left:** a food cap covers the days left until payday, today included. Food already logged today counts toward today's limit, and food from earlier days is already out of Remaining.
  - **Food per day:** what you spent on food each day, this cycle or over the last 60 days, against your daily limit (the cap per day, or the predicted daily food budget) and your usual. Days over the limit are marked. Averages count only days you logged something.
  - **Food graph**: what you spent on food in each past month. A dashed line marks your food cap, or the food budget it predicts.
  - **Bills and subscriptions** (Claude, internet, Amazon, foodpanda, YouTube, and any you add): amounts are editable and start from what you last paid. Tick the ones still to pay.
  - **Monthly essentials** (laundry, grooming and toiletries, and any you add): each starts at your average for this many days over past months, and each can be edited.
  - **InDrive**: your low, average or high per-day rate from past months times the days left. Low and high are the averages of your cheaper and dearer months.
  - **Advance payments** to Touheed or Mama: they come out of Pay myself, not this budget, and at the next payday you owe that much less, so it goes back to Pay myself. If you already logged an advance in the sheet, it is added back to the budget.

  - **Money in, out and saved:** one bar per pay cycle since January 2026, as tall as the pay received. Each bar is split into what went to Pay myself, what was spent and what was left over. Any spending or saving beyond the pay is hatched as "from earlier money". Months the Tracking tab does not cover are shown dashed. Under each bar is the savings rate. On top: total received, spent in tracked months, saved (the latest Pay myself, since it carries over month to month) and the share of all pay that is still saved. Click a month to edit what you received and to see a flow of where that pay went, by category.
    - Pay comes from the **Income** tab of the sheet (Year | Month | Received | Saved | Note), one row per cycle, by the month the cycle starts in. When a new cycle has no pay entered, the Forecast tab asks for it at the top and saves it there. The Saved column is only for months without a Tracking record (January and February 2026). Otherwise saved is how much Pay myself grew that cycle.
  - **Savings outlook** (at the bottom): your recorded Pay myself for every past cycle (each one already includes the months before), then where it is heading over the next 6 or 12 payday cycles, with the most likely path and the range 8 in 10 futures fall in. A line compares the recorded monthly growth with the projected one.
    - **Inputs:** your base salary (130,000 by default), next payday's salary (blank means the same as base), and planned expenses for any coming month.
    - **Spending level:** whether you expect to spend 10% less than this month, the same, or 10% more.
    - **Each month's spending** comes from this month's plan (the budget above it): bills, essentials, InDrive, and your food or shopping cap (your usual where no cap is set), scaled to a month. Mama and Touheed are paid on top, less any advance in the first month.
    - **The range:** 3,000 simulated futures resample how much your past months' everyday spending ran over or under average, and add surprise one-off buys of Rs 10,000+ as often and as big as they have happened. You can turn surprise buys off. Any shortfall this month comes out of the starting balance first.
    - A month-by-month table lists salary, payments, spending, planned expenses and the likely balance.

  What you enter is kept in your browser.
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
| `forecast.js` | Forecast workspace: this cycle's budget (bills, essentials, InDrive, advances, a food or shopping cap) and what is left for the other |
| `editor.js` | The Log entry form and the balances editor |
| `config.js` | OAuth client ID and sheet ID |
| `manifest.webmanifest`, `sw.js`, `icons/` | Installable web app: manifest, offline shell, icons |
| `.github/workflows/pages.yml` | Deploys to GitHub Pages |

Settings that live in `logic.js`: payday on the 20th (`PAYDAY_DOM`), a 10% buffer
(`BUFFER`), and the subscription list (`SUBS`).
