const fs = require('fs');
const https = require('https');

const ROCKETAPI_KEY = process.env.ROCKET_API_TOKEN || 'ZKMBv0r5ALDKoie7Z_5fXw';

// Extract shortcode from Instagram URL
function extractShortcode(url) {
  // Try regex patterns first for common Instagram URL formats
  const patterns = [
    /instagram\.com\/reel\/([A-Za-z0-9_-]+)/i,
    /instagram\.com\/p\/([A-Za-z0-9_-]+)/i,
    /instagram\.com\/tv\/([A-Za-z0-9_-]+)/i,
    /instagram\.com\/reels\/([A-Za-z0-9_-]+)/i,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      // Remove trailing slash or query params if captured
      return match[1].split('/')[0].split('?')[0];
    }
  }

  // Fallback: try parsing as URL
  try {
    const urlObj = new URL(url);
    const parts = urlObj.pathname.split('/').filter(Boolean);
    const reelIdx = parts.findIndex(p => ['reel', 'reels', 'p', 'tv'].includes(p));
    if (reelIdx !== -1 && parts[reelIdx + 1]) {
      return parts[reelIdx + 1];
    }
    // Last resort: return last non-empty path segment
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  } catch (e) {
    // If not a URL, assume it's already a shortcode
    if (/^[A-Za-z0-9_\-]+$/.test(url.trim())) {
      return url.trim();
    }
  }
  
  return null;
}

// Make HTTPS POST request
function makeRequest(url, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = JSON.stringify(data);

    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Token ${ROCKETAPI_KEY}`,
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve(body);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Main function
async function main() {
  const instagramUrl = process.argv[2];

  if (!instagramUrl) {
    console.error('Usage: node fetch-instagram-media.js <instagram-url>');
    console.error('Example: node fetch-instagram-media.js https://www.instagram.com/reel/Ckv3mrWq7W/');
    process.exit(1);
  }

  console.log('Instagram URL:', instagramUrl);

  // Step 1: Extract shortcode
  const shortcode = extractShortcode(instagramUrl);
  if (!shortcode) {
    console.error('Error: Could not extract shortcode from URL');
    process.exit(1);
  }
  console.log('Extracted shortcode:', shortcode);

  try {
    // Step 2: Get media ID
    console.log('\nFetching media ID...');
    const idResponse = await makeRequest(
      'https://v1.rocketapi.io/instagram/media/get_id_by_shortcode',
      { shortcode }
    );
    
    console.log('ID Response:', idResponse);
    
    if (!idResponse.id) {
      console.error('Error: No ID in response');
      process.exit(1);
    }

    const mediaId = idResponse.id;
    console.log('Media ID:', mediaId);

    // Step 3: Get media info
    console.log('\nFetching media info...');
    const mediaInfo = await makeRequest(
      'https://v1.rocketapi.io/instagram/media/get_info_by_shortcode',
      { shortcode }
    );

    // Step 4: Save to JSON file
    const filename = `instagram-media-${shortcode}.json`;
    fs.writeFileSync(filename, JSON.stringify(mediaInfo, null, 2));
    
    console.log('\n✅ Success!');
    console.log('Media info saved to:', filename);
    console.log('\nMedia Info Preview:');
    console.log(JSON.stringify(mediaInfo, null, 2).substring(0, 500) + '...');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();
