# Ledger: expense dashboard

A standalone version of the Claude expense dashboard. It reads the **Monthly Expense
Tracking** Google Sheet straight from your browser and shows payday cycles or calendar
months, category comparisons, subscriptions and bills, the daily spend limit, and an
overspend warning.

It is a static site (HTML, CSS, JS, with no build step and no server). It is hosted on GitHub
Pages at **https://ahadgitit.github.io/ledger/**.

## How access works

- You sign in with Google in the page. It asks only for read-only access to your sheets
  (`spreadsheets.readonly`).
- The browser calls the Google Sheets API directly. No other server sees your data.
- The sign-in token is kept in `sessionStorage`, so it goes away when you close the tab.
  Google tokens last one hour. After that, press **Sign in with Google** again.
- The last copy of the sheet is cached in `localStorage` so the page opens instantly.
  **Sign out** revokes the token and deletes that copy.
- Anyone can open the URL, but without a Google account that can read the sheet they
  only see the sign-in screen.

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
   - Scopes: add `.../auth/spreadsheets.readonly`
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

## Files

| File | What it does |
| --- | --- |
| `index.html` | The page shell |
| `styles.css` | Styles, with light and dark themes |
| `logic.js` | Parsing and calculations: cycles, months, categories, subscriptions, spend limit. Unchanged from the Claude artifact |
| `app.js` | Google sign-in, Sheets API reads, caching, rendering |
| `config.js` | OAuth client ID and sheet ID |
| `.github/workflows/pages.yml` | Deploys to GitHub Pages |

Settings that live in `logic.js`: payday on the 20th (`PAYDAY_DOM`), a 10% buffer
(`BUFFER`), and the subscription list (`SUBS`).
