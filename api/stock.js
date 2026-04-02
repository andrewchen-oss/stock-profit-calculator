import yahooFinance from 'yahoo-finance2';

export default async function handler(req, res) {
  const { symbol } = req.query;
  if (!symbol) {
    return res.status(400).json({ error: 'Missing symbol parameter' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const result = await yahooFinance.chart(symbol, {
      period1: '1990-01-01',
      interval: '1d',
    });

    if (!result || !result.quotes || result.quotes.length === 0) {
      return res.status(404).json({ error: 'No data found for: ' + symbol });
    }

    // Convert to Yahoo Finance v8 chart format that the frontend expects
    const timestamps = [];
    const closes = [];
    const highs = [];
    const opens = [];
    const lows = [];
    const volumes = [];

    for (const q of result.quotes) {
      if (q.close != null && q.date) {
        timestamps.push(Math.floor(new Date(q.date).getTime() / 1000));
        closes.push(q.close);
        highs.push(q.high);
        opens.push(q.open);
        lows.push(q.low);
        volumes.push(q.volume);
      }
    }

    const data = {
      chart: {
        result: [{
          meta: {
            symbol: symbol,
            shortName: result.meta?.shortName || symbol,
            currency: result.meta?.currency || 'USD',
            regularMarketPrice: result.meta?.regularMarketPrice,
          },
          timestamp: timestamps,
          indicators: {
            quote: [{
              close: closes,
              high: highs,
              open: opens,
              low: lows,
              volume: volumes,
            }]
          }
        }],
        error: null
      }
    };

    // Cache for 5 minutes
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(data);
  } catch (e) {
    console.error('Yahoo Finance error:', e.message);
    return res.status(502).json({ error: 'Failed to fetch data: ' + e.message });
  }
}
