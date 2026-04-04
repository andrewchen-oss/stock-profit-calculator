// Vercel Serverless Function - Yahoo Finance stock search
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export default async function handler(req, res) {
  const { q } = req.query;
  if (!q || q.length < 1) {
    return res.status(400).json({ results: [] });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    // Yahoo Finance search API
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0&listsCount=0&enableFuzzyQuery=false&quotesQueryId=tss_match_phrase_query`;
    const r = await fetch(url, {
      headers: { 'User-Agent': UA },
    });

    if (!r.ok) {
      // Fallback: try autoc endpoint
      const url2 = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`;
      const r2 = await fetch(url2, { headers: { 'User-Agent': UA } });
      if (!r2.ok) {
        return res.status(200).json({ results: [] });
      }
      const d2 = await r2.json();
      const results = (d2.quotes || []).map(item => ({
        symbol: item.symbol,
        name: item.shortname || item.longname || '',
        type: item.quoteType || '',
        exchange: item.exchange || '',
      }));
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
      return res.status(200).json({ results });
    }

    const data = await r.json();
    const results = (data.quotes || [])
      .filter(item => item.quoteType === 'EQUITY' || item.quoteType === 'ETF')
      .map(item => ({
        symbol: item.symbol,
        name: item.shortname || item.longname || '',
        type: item.quoteType || '',
        exchange: item.exchange || '',
      }));

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    return res.status(200).json({ results });
  } catch (e) {
    console.error('Search error:', e.message);
    return res.status(200).json({ results: [] });
  }
}
