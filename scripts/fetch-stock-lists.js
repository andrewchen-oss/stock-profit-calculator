// One-time script: fetch full stock lists from Tushare Pro and save as JSON
// Run: node scripts/fetch-stock-lists.js
import fs from 'node:fs/promises';
import path from 'node:path';

const TOKEN = process.env.TUSHARE_TOKEN || process.argv[2];
if (!TOKEN) {
  console.error('Usage: TUSHARE_TOKEN=xxx node scripts/fetch-stock-lists.js');
  process.exit(1);
}

const OUT_DIR = path.join(process.cwd(), 'stocks-data');

async function tushare(api_name, params = {}, fields = '') {
  const r = await fetch('http://api.tushare.pro', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_name, token: TOKEN, params, fields }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  if (data.code !== 0) throw new Error(`Tushare error: ${data.msg}`);
  const { fields: f, items } = data.data;
  return items.map(row => Object.fromEntries(f.map((k, i) => [k, row[i]])));
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  // ===== A-shares (沪A + 深A + 北A) =====
  console.log('Fetching A-share list...');
  const aShares = await tushare('stock_basic', { list_status: 'L' }, 'ts_code,symbol,name,market,exchange');
  console.log(`  Got ${aShares.length} A-share stocks`);

  const sh = aShares.filter(s => s.exchange === 'SSE').map(s => ({ code: s.symbol, name: s.name }));
  const sz = aShares.filter(s => s.exchange === 'SZSE').map(s => ({ code: s.symbol, name: s.name }));
  // BSE (北交所) - merge into sz for now or separate file
  const bse = aShares.filter(s => s.exchange === 'BSE').map(s => ({ code: s.symbol, name: s.name }));

  await fs.writeFile(path.join(OUT_DIR, 'sh.json'), JSON.stringify(sh));
  await fs.writeFile(path.join(OUT_DIR, 'sz.json'), JSON.stringify(sz));
  await fs.writeFile(path.join(OUT_DIR, 'bse.json'), JSON.stringify(bse));
  console.log(`  Saved sh.json (${sh.length}), sz.json (${sz.length}), bse.json (${bse.length})`);

  // ===== HK =====
  console.log('Fetching HK stock list...');
  try {
    const hk = await tushare('hk_basic', { list_status: 'L' }, 'ts_code,name,fullname,enname,list_status');
    const hkList = hk.map(s => ({ code: s.ts_code.replace('.HK', ''), name: s.name }));
    await fs.writeFile(path.join(OUT_DIR, 'hk.json'), JSON.stringify(hkList));
    console.log(`  Saved hk.json (${hkList.length})`);
  } catch (e) {
    console.warn(`  HK fetch failed (may need higher tier): ${e.message}`);
  }

  // ===== US (skip — use Yahoo) =====
  console.log('US: skipped (using Yahoo Finance)');

  console.log('\nDone!');
}

main().catch(e => { console.error(e); process.exit(1); });
