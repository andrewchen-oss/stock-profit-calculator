// Vercel Serverless Function - Yahoo Finance proxy
// Implements cookie+crumb auth flow manually
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let cachedAuth = null;

async function getAuth() {
  if (cachedAuth && Date.now() < cachedAuth.expiry) {
    return cachedAuth;
  }

  // Step 1: Get consent cookie from Yahoo
  const r1 = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': UA },
    redirect: 'manual',
  });

  // Collect cookies - try multiple methods for compatibility
  let rawCookies = [];
  try {
    // Node 20+ has getSetCookie
    if (typeof r1.headers.getSetCookie === 'function') {
      rawCookies = r1.headers.getSetCookie();
    }
  } catch(e) {}

  if (rawCookies.length === 0) {
    // Fallback: parse from raw set-cookie header
    const raw = r1.headers.get('set-cookie') || '';
    if (raw) {
      rawCookies = raw.split(/,(?=[A-Za-z0-9_]+=)/).filter(Boolean);
    }
  }

  console.log('Raw cookies count:', rawCookies.length);

  let cookieStr = rawCookies
    .map(c => c.split(';')[0].trim())
    .filter(c => c.includes('='))
    .join('; ');

  console.log('Cookie string:', cookieStr ? 'present' : 'empty');

  // Step 2: Get crumb
  const r2 = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, 'Cookie': cookieStr },
  });

  console.log('Crumb status:', r2.status);

  if (!r2.ok) {
    const body = await r2.text();
    console.log('Crumb response:', body.substring(0, 200));
    return null;
  }

  const crumb = await r2.text();
  console.log('Got crumb:', crumb);

  if (!crumb || crumb.includes('<') || crumb.includes('{')) {
    return null;
  }

  cachedAuth = { crumb, cookie: cookieStr, expiry: Date.now() + 5 * 60 * 1000 };
  return cachedAuth;
}

function buildYahooUrl(base, symbol, period1, crumb) {
  const params = new URLSearchParams({
    interval: '1d',
    period1: period1.toString(),
    period2: Math.floor(Date.now() / 1000).toString(),
  });
  if (crumb) params.set('crumb', crumb);
  return `${base}/v8/finance/chart/${encodeURIComponent(symbol)}?${params}`;
}

export default async function handler(req, res) {
  const { symbol, period1: p1Str } = req.query;
  if (!symbol) {
    return res.status(400).json({ error: 'Missing symbol' });
  }

  // Default period1: 30 years ago if not specified
  const period1 = p1Str ? parseInt(p1Str) : Math.floor(Date.now() / 1000) - 30 * 365 * 86400;

  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let lastError = '';

  // Approach 1: with crumb auth
  try {
    const auth = await getAuth();
    if (auth) {
      const url = buildYahooUrl('https://query2.finance.yahoo.com', symbol, period1, auth.crumb);
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, 'Cookie': auth.cookie },
      });
      console.log('Chart with crumb status:', r.status);
      if (r.ok) {
        const data = await r.json();
        if (data?.chart?.result?.[0]) {
          res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
          return res.status(200).json(data);
        }
      } else {
        lastError = 'crumb-auth:' + r.status;
        cachedAuth = null;
      }
    }
  } catch (e) {
    lastError = 'crumb-error:' + e.message;
    console.log('Crumb approach error:', e.message);
  }

  // Approach 2: direct query1
  try {
    const url = buildYahooUrl('https://query1.finance.yahoo.com', symbol, period1);
    const r = await fetch(url, {
      headers: { 'User-Agent': UA },
    });
    console.log('Direct query1 status:', r.status);
    if (r.ok) {
      const data = await r.json();
      if (data?.chart?.result?.[0]) {
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
        return res.status(200).json(data);
      }
    } else {
      lastError += ' direct:' + r.status;
    }
  } catch (e) {
    lastError += ' direct-error:' + e.message;
  }

  return res.status(502).json({ error: 'All approaches failed. ' + lastError });
}
