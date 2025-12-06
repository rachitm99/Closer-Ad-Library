# Closer Ad Library — Next.js Demo

This is a minimal Next.js app which checks whether a given Instagram Reel is an ad by checking the `injected` key in the RocketAPI response. The repo contains a sample `media_info.json` that matches the RocketAPI output (see attachments).

This project uses Next.js App Router (Next 15) — UI is under the `app/` directory and API route is a Route Handler (`app/api/check-ad/route.js`).

## Features
- UI Dashboard with a text box to paste an Instagram Reel URL.
- Server-side API route (`/api/check-ad`) to call RocketAPI (or use local mock file).
- Extracts shortcode from a URL (supports `/reel/<shortcode>`, `/p/<shortcode>`, `/tv/<shortcode>`).
- If `response.body.items[0].injected` exists, the route returns `isAd: true` plus `adId`.

## Local development

1. Install dependencies

```powershell
npm install
```

2. Copy `.env.example` -> `.env.local` and edit as needed

```powershell
copy .env.example .env.local
# open .env.local and set USE_MOCK=false and ROCKET_API_TOKEN=... if you want to call RocketAPI for real
```

3. Run dev server

```powershell
npm run dev
```

Open http://localhost:3000/ and try the following URL to test the Reel against the RocketAPI: `https://www.instagram.com/reel/DQ6la7UgK-z/`

## Quick test using curl/PowerShell

When the dev server is running you can test the API directly.

PowerShell (Windows):

```powershell
Invoke-RestMethod -Uri http://localhost:3000/api/check-ad -Method POST -ContentType 'application/json' -Body (@{ url = 'https://www.instagram.com/reel/DQ6la7UgK-z/' } | ConvertTo-Json)
```

Or using curl:

```bash
# Without a token (server will use ROCKET_API_TOKEN env var)
curl -X POST http://localhost:3000/api/check-ad -H "Content-Type: application/json" -d '{"url":"https://www.instagram.com/reel/DQ6la7UgK-z/"}'

# Or with a request-level token (for quick testing only — will be used for this call only)
curl -X POST http://localhost:3000/api/check-ad -H "Content-Type: application/json" -d '{"url":"https://www.instagram.com/reel/DQ6la7UgK-z/", "token":"YOUR_ROCKET_API_TOKEN"}'
```


## Implementation notes
- The API route uses `fs` to read `media_info.json` in mock mode.
- The production mode requires `ROCKET_API_TOKEN` to be set; it uses a POST to `https://v1.rocketapi.io/instagram/media/get_info_by_shortcode`.
- To force a real RocketAPI call, set `USE_MOCK=false` in `.env.local` and provide `ROCKET_API_TOKEN`.
 - The API route by default calls RocketAPI (live). If you want to use a local mock file for testing, set `USE_MOCK=true` in `.env.local`.
 - The production mode requires `ROCKET_API_TOKEN` to be set; it uses a POST to `https://v1.rocketapi.io/instagram/media/get_info_by_shortcode`.
 - For quick testing you can also supply a token in the request body (curl or programmatically), instead of setting the server env var. The UI intentionally does not accept secret tokens.
 - Note: The UI intentionally does not accept secret tokens — use env vars or curl for tests.
- To fetch ad details (ad URL) we use the Facebook Ads Library Scraper API (RapidAPI). You can set `RAPIDAPI_KEY` in your `.env.local` or pass a `rapidApiKey` in the request JSON when testing. Example RapidAPI call is:

```powershell
Invoke-RestMethod -Uri http://localhost:3000/api/check-ad -Method POST -ContentType 'application/json' -Body (@{ url = 'https://www.instagram.com/reel/DQ6la7UgK-z/'; token = 'TvQWTYSyTqck7ay0cnimvw'; rapidApiKey = 'e09df1b384msh...'; useMock = $false } | ConvertTo-Json)
```

And using curl (with RapidAPI key in the body):

```bash
curl -X POST http://localhost:3000/api/check-ad \
	-H "Content-Type: application/json" \
	-d '{"url":"https://www.instagram.com/reel/DQ6la7UgK-z/","token":"YOUR_ROCKET_API_TOKEN","rapidApiKey":"YOUR_RAPIDAPI_KEY" }'
```

## Viewing logs (server + client)

- Start the dev server (`npm run dev`) and watch your terminal for server logs. The app now prints clear emoji-based logs for each step. Sample server logs include:

	- 🔁 Request received and URL/shortcode info
	- 🧭 Shortcode extraction and details
	- 🔎 Whether mock mode is active or 🌐 if RocketAPI is being used
	- 📂 The path to the mock file when used, and confirmation of items count
	- 📤 RocketAPI calls including the endpoint and shortcode being requested
	- 🔔 When an ad is found and the `ad_id` logged, or 🪪 if not an ad
	- ✅ Successful responses, or ⚠️ and 🔥 for warnings & errors

- Client logs print in your browser console; they show the URL/shortcode the user submitted and the server response.

## Files
- `pages/index.js` — dashboard UI
- `pages/api/check-ad.js` — API route to check for ads
 - **Note:** This project uses the App Router. Legacy `pages/` files remain for compatibility but prefer `app/` routes and `app/api` route handlers.
- `media_info.json` — sample API output supplied in the repo
- `utils/extractShortcode.js` — helper for extracting shortcode from URL

Note: The ad URL is extracted from the ad info returned by RapidAPI — typically in `snapshot.link_url`. If no RapidAPI key is present, the route will skip fetching ad details unless `USE_MOCK=true`, in which case it will use `ad_info.json`.

UI & Status steps
------------------

The UI now shows a step-by-step status row at the top with four steps:

- Extract Shortcode — extracting the shortcode from your pasted URL
- Call RocketAPI — sending the shortcode to RocketAPI and fetching media data
- Detect Ad — whether the returned media contains an ad (the `injected` key)
- Fetch Ad Details — if an ad is detected, attempt to retrieve ad details (ad URL) via RapidAPI

Each step is shown with an emoji-badge; in-progress steps show a spinner, successful steps show a checkmark, and failed steps show a red X and a short message.

This helps you track the flow of what the server is checking in realtime.

## Next steps / Improvements
- Add validation feedback for URL; support more Instagram URL patterns.
- Add errors for invalid tokens or upstream errors and retry/backoff logic.
- Add logging / analytics for usage.

Enjoy! 🎉
