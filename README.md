# Sofia's Placement Tracker

A shared tracker for Sofia's placement applications. Sofia changes each role's status (Not started → Writing it → Applied → Online test → Interview → Offer / Rejected) and adds notes. Anyone with the link sees the same list, a live count of applications, and a "Recent activity" feed showing who changed what and when.

Free to run: Vercel (hosting) + Upstash Redis (storage, free tier).

```
sofia-tracker/
├── public/index.html   ← the page (role list is inside, near the top of the <script>)
├── api/state.js        ← small API that saves status/notes to Redis
├── server.js           ← only used if you host on Render
└── package.json
```

## Deploy on Vercel (recommended, about 10 minutes)

1. Put this folder in a new GitHub repo (github.com → New repository → "uploading an existing file" → drag the folder contents in → Commit).
2. Go to vercel.com → sign in with GitHub → **Add New → Project** → import the repo → Framework preset: **Other** → **Deploy**.
3. In the project, open **Storage** → **Create Database** → pick **Upstash for Redis** or **Redis** (free plan) → connect it to this project with **Production** ticked. Either works: the API finds the settings automatically.
4. (Recommended) **Settings → Environment Variables** → add `EDIT_PIN` = any 4–6 digit code. Viewing stays open; changing anything asks for the PIN once per browser. Give the PIN to Sofia.
5. **Deployments** → the latest one → **⋯ → Redeploy** (so the new env vars load).
6. Open the `.vercel.app` link and send it to Sofia.

## Deploy on Render instead

Render's free tier has no saved disk, so it still needs the free Upstash database:

1. Create a free database at upstash.com → Redis → copy the **REST URL** and **REST TOKEN**.
2. render.com → **New → Web Service** → connect the GitHub repo.
   - Build command: *(leave empty)*  ·  Start command: `npm start`  ·  Instance type: **Free**
3. Environment: add `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, and optionally `EDIT_PIN`.
4. Deploy. Note: free Render services sleep after 15 min idle, so the first load can take ~30–50 seconds.

## Notes

- If storage isn't connected, the page still works but shows a yellow banner and saves only in that one browser.
- To change the built-in role list, edit the `roles` / `summer` arrays in `public/index.html`. Sofia can also add roles from the page ("Add a role").
- The page refreshes itself every 30 seconds, so you'll see her updates without reloading.
