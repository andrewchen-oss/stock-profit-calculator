// Vercel Serverless Function - stock data
// A-shares (.SS/.SZ/.BJ) + HK (.HK) → Tushare Pro
// US stocks → Yahoo Finance (cookie+crumb auth flow)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TUSHARE_TOKEN = process.env.TUSHARE_TOKEN || '4880861fadd401fea5adad20a72316409005360dcb5904eab14fd360';

// ===== Tushare path =====
async function tushare(api_name, params, fields) {
  const r = await fetch('http://api.tushare.pro', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_name, token: TUSHARE_TOKEN, params, fields }),
  });
  if (!r.ok) throw new Error(`tushare http ${r.status}`);
  const data = await r.json();
  if (data.code !== 0) throw new Error(`tushare: ${data.msg}`);
  const { fields: f, items } = data.data;
  return items.map(row => Object.fromEntries(f.map((k, i) => [k, row[i]])));
}

function ymd(d) {
  const dt = new Date(d * 1000);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}
function parseTushareDate(s) {
  // YYYYMMDD → unix seconds (UTC midnight)
  const y = parseInt(s.slice(0, 4), 10);
  const m = parseInt(s.slice(4, 6), 10) - 1;
  const d = parseInt(s.slice(6, 8), 10);
  return Math.floor(Date.UTC(y, m, d) / 1000);
}

function symbolToTushare(sym) {
  // Our symbols: 600519.SS, 000001.SZ, 430047.BJ, 0700.HK
  // Tushare:    600519.SH, 000001.SZ, 430047.BJ, 00700.HK (HK 5-digit padded)
  if (sym.endsWith('.SS')) return sym.replace('.SS', '.SH');
  if (sym.endsWith('.SZ') || sym.endsWith('.BJ')) return sym;
  if (sym.endsWith('.HK')) {
    const code = sym.replace('.HK', '');
    return code.padStart(5, '0') + '.HK';
  }
  return null;
}

async function fetchTushareDaily(symbol, period1) {
  const ts = symbolToTushare(symbol);
  if (!ts) return null;
  const startDate = ymd(period1);
  const endDate = ymd(Math.floor(Date.now() / 1000));
  const isHK = ts.endsWith('.HK');
  const apiName = isHK ? 'hk_daily' : 'daily';
  const fields = 'ts_code,trade_date,open,high,low,close,vol';
  // Tushare returns up to 6000 rows per call; for very long history we may need pagination
  let rows = await tushare(apiName, { ts_code: ts, start_date: startDate, end_date: endDate }, fields);
  if (!rows || rows.length === 0) return null;
  // Tushare returns descending by date — sort ascending
  rows.sort((a, b) => a.trade_date.localeCompare(b.trade_date));

  const timestamp = rows.map(r => parseTushareDate(r.trade_date));
  const open = rows.map(r => Number(r.open));
  const high = rows.map(r => Number(r.high));
  const low = rows.map(r => Number(r.low));
  const close = rows.map(r => Number(r.close));
  const volume = rows.map(r => Math.round(Number(r.vol) * 100)); // tushare vol is in 手 (100 shares)

  // Mirror Yahoo's chart response shape so the frontend doesn't need changes
  return {
    chart: {
      result: [{
        meta: {
          symbol,
          currency: isHK ? 'HKD' : 'CNY',
          regularMarketPrice: close[close.length - 1],
          firstTradeDate: timestamp[0],
        },
        timestamp,
        indicators: {
          quote: [{ open, high, low, close, volume }],
          adjclose: [{ adjclose: close }],
        },
      }],
      error: null,
    },
  };
}

// ===== Yahoo path (US) =====
let cachedAuth = null;
async function getAuth() {
  if (cachedAuth && Date.now() < cachedAuth.expiry) return cachedAuth;
  const r1 = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA }, redirect: 'manual' });
  let rawCookies = [];
  try { if (typeof r1.headers.getSetCookie === 'function') rawCookies = r1.headers.getSetCookie(); } catch {}
  if (rawCookies.length === 0) {
    const raw = r1.headers.get('set-cookie') || '';
    if (raw) rawCookies = raw.split(/,(?=[A-Za-z0-9_]+=)/).filter(Boolean);
  }
  const cookieStr = rawCookies.map(c => c.split(';')[0].trim()).filter(c => c.includes('=')).join('; ');
  const r2 = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, 'Cookie': cookieStr },
  });
  if (!r2.ok) return null;
  const crumb = await r2.text();
  if (!crumb || crumb.includes('<') || crumb.includes('{')) return null;
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

async function fetchYahoo(symbol, period1) {
  // Approach 1: crumb auth
  try {
    const auth = await getAuth();
    if (auth) {
      const url = buildYahooUrl('https://query2.finance.yahoo.com', symbol, period1, auth.crumb);
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Cookie': auth.cookie } });
      if (r.ok) {
        const data = await r.json();
        if (data?.chart?.result?.[0]) return data;
      } else {
        cachedAuth = null;
      }
    }
  } catch {}
  // Approach 2: direct query1
  try {
    const url = buildYahooUrl('https://query1.finance.yahoo.com', symbol, period1);
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (r.ok) {
      const data = await r.json();
      if (data?.chart?.result?.[0]) return data;
    }
  } catch {}
  return null;
}

// ===== Handler =====
export default async function handler(req, res) {
  const { symbol, period1: p1Str } = req.query;
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' });
  const period1 = p1Str ? parseInt(p1Str) : Math.floor(Date.now() / 1000) - 30 * 365 * 86400;

  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Route by symbol suffix
  const isAOrHK = /\.(SS|SZ|BJ|HK)$/i.test(symbol);
  try {
    if (isAOrHK) {
      const data = await fetchTushareDaily(symbol, period1);
      if (data) {
        res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800');
        return res.status(200).json(data);
      }
      // Fallback to Yahoo if Tushare returns nothing
      const yh = await fetchYahoo(symbol, period1);
      if (yh) {
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
        return res.status(200).json(yh);
      }
      return res.status(502).json({ error: 'No data from Tushare or Yahoo' });
    } else {
      const yh = await fetchYahoo(symbol, period1);
      if (yh) {
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
        return res.status(200).json(yh);
      }
      return res.status(502).json({ error: 'Yahoo failed' });
    }
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
