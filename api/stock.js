// Vercel Serverless Function - Yahoo Finance proxy with cookie/crumb auth
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let cachedCrumb = null;
let cachedCookie = null;
let crumbExpiry = 0;

async function getCrumbAndCookie() {
  if (cachedCrumb && cachedCookie && Date.now() < crumbExpiry) {
    return { crumb: cachedCrumb, cookie: cachedCookie };
  }

  // Step 1: Visit Yahoo to get consent cookies
  const initRes = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': UA },
    redirect: 'manual',
  });

  // Extract cookies - handle both getSetCookie() and raw header
  let cookieParts = [];
  try {
    const raw = initRes.headers.get('set-cookie');
    if (raw) {
      // set-cookie header may contain multiple cookies joined by comma
      // But cookies themselves can contain commas in dates, so split carefully
      cookieParts = raw.split(/,(?=\s*\w+=)/).map(c => c.split(';')[0].trim());
    }
  } catch (e) {}

  const cookieStr = cookieParts.join('; ');
  console.log('Got cookies:', cookieStr ? 'yes (' + cookieParts.length + ')' : 'none');

  // Step 2: Get crumb
  const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: {
      'User-Agent': UA,
      'Cookie': cookieStr,
    },
  });

  console.log('Crumb response status:', crumbRes.status);
  const crumb = await crumbRes.text();
  console.log('Crumb value:', crumb?.substring(0, 20));

  if (!crumbRes.ok || !crumb || crumb.includes('<')) {
    // Crumb failed, return null to use fallback
    return { crumb: null, cookie: null };
  }

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
    let data = null;

    // Approach 1: query2 with crumb
    try {
      const { crumb, cookie } = await getCrumbAndCookie();
      if (crumb && cookie) {
        const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=max&interval=1d&crumb=${encodeURIComponent(crumb)}`;
        const response = await fetch(url, {
          headers: { 'User-Agent': UA, 'Cookie': cookie },
        });
        console.log('query2 with crumb status:', response.status);
        if (response.ok) {
          data = await response.json();
          if (!data?.chart?.result?.[0]) data = null;
        }
      }
    } catch (e) {
      console.log('Crumb approach error:', e.message);
    }

    // Approach 2: query1 without crumb
    if (!data) {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=max&interval=1d`;
        const r = await fetch(url, { headers: { 'User-Agent': UA } });
        console.log('query1 no crumb status:', r.status);
        if (r.ok) {
          data = await r.json();
          if (!data?.chart?.result?.[0]) data = null;
        }
      } catch (e) {
        console.log('query1 error:', e.message);
      }
    }

    // Approach 3: use allorigins as server-side proxy
    if (!data) {
      try {
        const yUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=max&interval=1d`;
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(yUrl)}`;
        const r = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
        console.log('allorigins status:', r.status);
        if (r.ok) {
          data = await r.json();
          if (!data?.chart?.result?.[0]) data = null;
        }
      } catch (e) {
        console.log('allorigins error:', e.message);
      }
    }

    if (!data?.chart?.result?.[0]) {
      return res.status(502).json({ error: 'All data sources failed for: ' + symbol });
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: 'Server error: ' + e.message });
  }
}
