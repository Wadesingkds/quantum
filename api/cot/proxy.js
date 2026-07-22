// COT Proxy — forwards to quantumleaps.biz.id/api/cot
// Avoids CORS issue since both are same-origin via Vercel

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const weeks = req.query.weeks || 12;
    const resp = await fetch(`https://quantumleaps.biz.id/api/cot?weeks=${weeks}`, {
      signal: AbortSignal.timeout(25000)
    });
    if (!resp.ok) throw new Error(`COT API ${resp.status}`);
    const data = await resp.json();
    return res.status(200).json(data);
  } catch (e) {
    console.error('[COT Proxy] error:', e.message);
    return res.status(502).json({ error: 'COT fetch failed', detail: e.message });
  }
}
