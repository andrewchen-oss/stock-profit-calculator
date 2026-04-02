// Vercel Serverless Function - Yahoo Finance proxy with cookie/crumb auth
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let cachedCrumb = null;
let cachedCookie = null;
let crumbExpiry = 0;

async function getCrumbAndCookie() {
  // Return cached values if still fresh (cache for 10 minutes)
  if (cachedCrumb && cachedCookie && Date.now() < crumbExpiry) {
    return { crumb: cachedCrumb, cookie: cachedCookie };
  }

  // Step 1: Visit Yahoo Finance to get cookies
  const initRes = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': UA },
    redirect: 'manual',
  });

  // Extract Set-Cookie headers
  const cookies = initRes.headers.getSetCookie?.() || [];
  const cookieStr = cookies.map(c => c.split(';')[0]).join('; ');

  // Step 2: Get crumb using the cookies
  const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: {
      'User-Agent': UA,
      'Cookie': cookieStr,
    },
  });

  if (!crumbRes.ok) {
    throw new Error(`Failed to get crumb: ${crumbRes.status}`);
  }

  const crumb = await crumbRes.text();

  cachedCrumb = crumb;
  cachedCookie = cookieStr;
  crumbExpiry = Date.now() + 10 * 60 * 1000;

  return { crumb, cookie: cookieStr };
}

export default async function handler(req, res) {
  const { symbol } = req.query;
  if (!symbol) {
    return res.status(400).json({ error: 'Missing symbol parameter' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    // Try with crumb auth first
    let data = null;

    try {
      const { crumb, cookie } = await getCrumbAndCookie();
      const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=max&interval=1d&crumb=${encodeURIComponent(crumb)}`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'Cookie': cookie,
        },
      });
      if (response.ok) {
        data = await response.json();
      }
    } catch (e) {
      // crumb approach failed, try without
    }

    // Fallback: try without crumb on query1
    if (!data?.chart?.result?.[0]) {
      const url2 = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=max&interval=1d`;
      const r2 = await fetch(url2, {
        headers: { 'User-Agent': UA },
      });
      if (r2.ok) {
        data = await r2.json();
      }
    }

    if (!data?.chart?.result?.[0]) {
      return res.status(404).json({ error: 'No data found for symbol: ' + symbol });
    }

    // Cache for 5 minutes
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: 'Failed to fetch: ' + e.message });
  }
}
