# Closer Ad Library — Next.js Demo

This is a minimal Next.js app which checks whether a given Instagram Reel is an ad by checking the `injected` key in the RocketAPI response. The repo contains a sample `media_info.json` that matches the RocketAPI output (see attachments).

This project uses Next.js App Router (Next 15) — UI is under the `app/` directory and API route is a Route Handler (`app/api/check-ad/route.ts`).

## Features
- UI Dashboard with a text box to paste an Instagram Reel URL.
- Server-side API route (`/api/check-ad`) to call RocketAPI (or use local mock file).
- Extracts shortcode from a URL (supports `/reel/<shortcode>`, `/p/<shortcode>`, `/tv/<shortcode>`).
- If `response.body.items[0].injected` exists, the route returns `isAd: true` plus `adId`.

## Local development

1. Install dependencies

```powershell
npm install
Note: This project now uses Tailwind CSS for styling. The `app/globals.css` file contains Tailwind directives and the project includes `tailwindcss`, `postcss`, and `autoprefixer` in devDependencies. Run `npm install` to get these packages. If you'd like to regenerate a production build using the Tailwind setup, run `npm run build` as usual.

Note: The project has been adjusted to use Tailwind utilities exclusively (no custom component CSS in `app/globals.css`). Custom theme extensions (colors, box-shadow, font family) are declared in `tailwind.config.js` and are used via utility classes in components.

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

### Backend (FastAPI) dev server

If you want to run the backend that exposes `/query_video/` locally as in this demo:

1. Make sure Python dependencies are installed (example command):

```powershell
python -m pip install fastapi uvicorn weaviate-client numpy pillow opencv-python torch
python -m pip install git+https://github.com/openai/CLIP.git
```

2. Set `ALLOWED_ORIGINS` env var if you are running the frontend on a host other than `http://localhost:3000` (optional):

```powershell
$env:ALLOWED_ORIGINS = 'http://localhost:3000'
```

3. Start the backend server using uvicorn:

```powershell
uvicorn main:app --reload --port 8000
```

The backend includes CORS middleware and will allow requests from the origins provided in `ALLOWED_ORIGINS` (defaults to `http://localhost:3000`).

#### Quick test for CORS

Use a browser or curl to ensure the backend responds with CORS headers:

PowerShell (simulate preflight):

```powershell
curl -X OPTIONS "http://localhost:8000/query_video/" -H "Origin: http://localhost:3000" -H "Access-Control-Request-Method: POST" -i
```

If CORS is configured correctly, the response should include an `Access-Control-Allow-Origin` header matching the origin you provided. If it does not, verify that the backend is running and `ALLOWED_ORIGINS` is set correctly.

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
 - `app/page.tsx` — dashboard UI (client uses `components/ReelChecker.tsx`)
 - `app/api/check-ad/route.ts` — API route to check for ads
- `media_info.json` — sample API output supplied in the repo
 - `utils/extractShortcode.ts` — helper for extracting shortcode from URL

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

## Video Query Page

 - A new page is available at `/video-query` (or from the home nav link) which allows you to upload a video file and provide a company page ID to query against a separate backend. The UI will POST a `multipart/form-data` request to `http://localhost:8000/query_video` and render a table of similarity results if the backend responds with `results: []`. The results table includes the following fields: `video_id`, `ad_url` (clickable), `avg_similarity`, `max_similarity`, and `matches_count`.
- Ensure your backend is running and exposes `/query_video` on port 8000 before using this page; otherwise the upload will error with a network error.
 - The backend sets CORS to allow requests from `http://localhost:3000` by default. If your frontend runs on a different host or port, set an environment variable when starting the backend server:

 ```powershell
 $env:ALLOWED_ORIGINS = 'http://localhost:3000'
 # For development only: allow multiple origins as a comma-separated list
 $env:ALLOWED_ORIGINS = 'http://localhost:3000,http://127.0.0.1:3000'
 npm run start # or the command you use to run the FastAPI app
 ```

 For a quick, permissive dev environment (not recommended in production), you can set `ALLOWED_ORIGINS` to `*`.

Cloud Run integration (server-side forwarding)
-------------------------------------------

This project includes a Next.js server route at `app/api/query/route.ts` that forwards an uploaded video and `page_id` to an external Cloud Run service expecting a POST `/query` endpoint.

Environment variables (set in Vercel or your runtime):

- `CLOUD_RUN_URL` (required) — base URL of your Cloud Run service, e.g. `https://my-cloudrun-service-xyz.a.run.app`
- `NEXT_SA_KEY` (optional) — service account JSON string **only** if ADC is not available. Prefer Workload Identity Federation (no key file) in production.

GCS upload configuration

- `UPLOAD_BUCKET` (required) — the name of the Google Cloud Storage bucket to use for signed uploads (e.g., `closer-query-prod-12345`). Ensure the bucket exists and that the service account used by your app has `roles/storage.objectAdmin` on the bucket.

If your deployment environment does not provide Application Default Credentials (ADC), you have two options:

1. Workload Identity Federation (recommended): configure a Workload Identity Pool and Provider that trusts your hosting provider (e.g., Vercel), then allow the pool to impersonate a service account that has access to the bucket. See https://cloud.google.com/iam/docs/workload-identity-federation for details.

2. Short-term workaround: set `NEXT_SA_KEY` to the JSON contents of a service account key that has `roles/storage.objectAdmin`. This is less secure and not recommended for production — prefer WIF.


Note about Vercel deploys and `npm install` errors
-------------------------------------------------

If you hit an `ETARGET` error on Vercel during `npm install` (e.g., "No matching version found for google-auth-library@..."), try the following:

- Ensure your `package.json` pins a valid published version (this repo uses `google-auth-library@10.5.0`).
- Clear the Vercel build cache and re-deploy: in the Vercel dashboard, go to the deployment and select "Retry with cleared cache" or set the project to clear cache on the next deploy.
- If the problem persists, check your lockfile (`package-lock.json`) and remove/recreate it locally, then push the updated lockfile before redeploying.


Authentication:

- The route uses Google ADC and `google-auth-library` to obtain an ID token for `CLOUD_RUN_URL` and adds `Authorization: Bearer <ID_TOKEN>` when calling the Cloud Run `/query` endpoint.
- In Vercel: enable Workload Identity Federation / ADC or configure your project to use short-lived credentials. If ADC is not available, you may provide `NEXT_SA_KEY` containing service account JSON (not recommended for production).

Client usage (call the Next.js route):

```ts
// Example client-side handler that POSTs to our Next.js API route
async function uploadAndQuery(file: File, pageId: string, topK = 10) {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('page_id', pageId)

  const res = await fetch('/api/query', { method: 'POST', body: fd })
  if (!res.ok) throw new Error(`Server error: ${res.status}`)
  const data = await res.json()
  return data // { results: [...] }
}
```

Test example (dry-run):

- See `tests/queryRoute.spec.ts` for a simple Jest-style dry-run that mocks `getIdTokenClient` and upstream `fetch` to assert truncation to top-10 results.

### Example cURL requests

Upload using top_k and file (PowerShell):

```powershell
curl.exe -X POST "http://localhost:8000/query_video/" `
	-F "file=@C:\Users\rachi\Desktop\closer-projects\video-similarity\videos\10.mp4" `
	-F "top_k=5"
```

Upload with top_k + page_id (if your backend accepts page_id):

```powershell
curl.exe -X POST "http://localhost:8000/query_video/" `
	-F "file=@C:\Users\rachi\Desktop\closer-projects\video-similarity\videos\10.mp4" `
	-F "top_k=5" `
	-F "page_id=123456789"
```

If you're using Linux or WSL/Command Prompt (no backticks needed):

```bash
curl -X POST "http://localhost:8000/query_video/" \
	-F "file=@/path/to/10.mp4" \
	-F "top_k=5"
```

Enjoy! 🎉
