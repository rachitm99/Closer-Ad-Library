import fs from 'fs/promises';
import path from 'path';
import { extractShortcodeFromUrl } from '../../../utils/extractShortcode';

const API_ENDPOINT = 'https://v1.rocketapi.io/instagram/media/get_info_by_shortcode';

function maskToken(token) {
  if (!token) return null;
  return token.length > 6 ? `${token.slice(0, 3)}...${token.slice(-3)}` : '***';
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { url, shortcode: providedShortcode, token: providedToken, useMock: requestedUseMock } = body || {};
    console.log('🔁 Received /api/check-ad request', { providedShortcode, url });
    if (!url && !providedShortcode) {
      return new Response(JSON.stringify({ message: 'Missing url or shortcode in request body' }), { status: 400 });
    }
    // Prefer the shortcode extracted in realtime from the URL; fall back to any provided shortcode.
    const extractedShortcode = extractShortcodeFromUrl(url);
    const shortcode = extractedShortcode || providedShortcode;
    console.log('🧭 Shortcode extracted (preferred):', extractedShortcode, 'used_shortcode:', shortcode);
    if (!shortcode) {
      return new Response(JSON.stringify({ message: 'Could not extract shortcode from URL' }), { status: 400 });
    }
    // Default to call the live RocketAPI unless `useMock` is explicitly true in env or body.
    const useMockEnv = (process.env.USE_MOCK || 'false') === 'true';
    const useMock = requestedUseMock === true || useMockEnv === true;
    console.log(useMock ? '🔎 Using mock data (media_info.json)' : '🌐 Calling RocketAPI (live)');
    let apiResponse;

    if (useMock) {
      const jsonPath = path.join(process.cwd(), 'media_info.json');
      console.log('📂 Reading mock file:', jsonPath);
      const raw = await fs.readFile(jsonPath, 'utf8');
      apiResponse = JSON.parse(raw);
      console.log('✅ Mock file read and parsed (items count):', apiResponse?.response?.body?.items?.length ?? 0);
    } else {
      // The token can come from an env var (recommended) or a provided token for testing.
      const token = providedToken || process.env.ROCKET_API_TOKEN;
      if (!token) {
        console.error('⚠️ Missing ROCKET_API_TOKEN environment variable and no token provided in request');
        return new Response(JSON.stringify({ message: 'Server missing ROCKET_API_TOKEN env variable and no token provided in request' }), { status: 500 });
      }

      const payload = { shortcode };
      // Log endpoint and chosen (masked) token source
      console.log('📤 Sending POST to RocketAPI', { API_ENDPOINT, shortcode, tokenSource: providedToken ? 'request' : 'env', maskedToken: maskToken(token) });
      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Token ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error('⚠️ RocketAPI returned error', { status: response.status, body: text });
        // Prefer returning a descriptive JSON for upstream errors
        return new Response(JSON.stringify({ message: 'Upstream API Error', status: response.status, details: text }), { status: response.status });
      }

      apiResponse = await response.json();
    }

    // Walk into response.body.items[0].injected
    const responseBody = apiResponse?.response?.body;
    const items = responseBody?.items || [];
    const first = items[0] || {};
    console.log('📊 API response items count:', items.length, 'first_item_id:', first?.id ?? 'n/a');
    const injected = first?.injected;
    const adId = injected?.ad_id || null;
    const isAd = !!injected;
    console.log(isAd ? `🔔 Ad found! ad_id=${adId}` : '🪪 Not an ad (no injected object found)');
    if (isAd) console.log('🧾 Injected object keys', Object.keys(injected || {}));

    // If this is an ad, attempt to fetch ad details (ad URL) from the Facebook Ads Library Scraper API (RapidAPI)
    let adInfo = null;
    if (isAd && adId) {
      const providedRapidApiKey = body?.rapidApiKey || body?.rapidapiKey || body?.rapidAPIKey || null;
      const rapidApiKey = providedRapidApiKey || process.env.RAPIDAPI_KEY || null;
      const rapidApiHost = 'facebook-ads-library-scraper-api.p.rapidapi.com';
      if (!rapidApiKey) {
        // If the project is in mock mode, read ad_info.json for ad details
        if (useMock) {
          try {
            const adJsonPath = path.join(process.cwd(), 'ad_info.json');
            console.log('📂 Reading mock ad_info file:', adJsonPath);
            const rawAd = await fs.readFile(adJsonPath, 'utf8');
            adInfo = JSON.parse(rawAd);
            console.log('✅ Mock ad_info read and parsed, adUrl:', adInfo?.snapshot?.link_url ?? null);
          } catch (errAdMock) {
            console.error('⚠️ Failed to read mock ad_info.json', errAdMock);
          }
        } else {
          console.log('⚠️ No RapidAPI key provided; skipping ad details fetch. Set RAPIDAPI_KEY in env or provide rapidApiKey in request body');
        }
      } else {
        try {
          const adEndpoint = `https://${rapidApiHost}/ad?trim=false&get_transcript=false&id=${encodeURIComponent(adId)}`;
          console.log('📤 Fetching ad details from RapidAPI', { adEndpoint, maskedRapidApiKey: maskToken(rapidApiKey) });
          const adResp = await fetch(adEndpoint, {
            method: 'GET',
            headers: {
              'x-rapidapi-host': rapidApiHost,
              'x-rapidapi-key': rapidApiKey,
            },
          });
          if (!adResp.ok) {
            const adText = await adResp.text();
            console.error('⚠️ RapidAPI returned error', { status: adResp.status, body: adText });
            // continue but leave adInfo null
          } else {
            adInfo = await adResp.json();
            const adUrl = adInfo?.snapshot?.link_url ?? adInfo?.url ?? null;
            console.log('✅ RapidAPI returned ad info', { adId, adUrl });
          }
        } catch (errAd) {
          console.error('🔥 Error fetching ad details via RapidAPI', errAd);
        }
      }
    }

    const adUrl = adInfo?.snapshot?.link_url ?? adInfo?.url ?? null;
    if (adUrl) console.log('🔗 adUrl:', adUrl);
    console.log('✅ Responding with success', { shortcode, isAd, adId, adUrl });
    return new Response(JSON.stringify({ shortcode, isAd, adId, adUrl, adInfo, raw: apiResponse }), { status: 200 });
  } catch (err) {
    console.error('🔥 API check-ad error:', err);
    return new Response(JSON.stringify({ message: 'Internal Server Error', details: err.message }), { status: 500 });
  }
}
