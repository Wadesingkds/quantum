// COT Gold — fetches CFTC Socrata directly (no self-reference).
// Returns v2-compatible shape: { categories: { metals: [{symbol:'GC',...}] } }

const CFTC_BASE = "https://publicreporting.cftc.gov/resource/6dca-aqww.json";
const GOLD_MARKET = "GOLD - COMMODITY EXCHANGE INC.";

async function fetchGold(weeks) {
  const where = `market_and_exchange_names='${GOLD_MARKET.replace(/'/g, "''")}'`;
  const url = `${CFTC_BASE}?$where=${encodeURIComponent(where)}&$order=report_date_as_yyyy_mm_dd DESC&$limit=${weeks}`;
  const r = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`CFTC API ${r.status}`);
  return r.json();
}

function net(d) {
  return Number(d.noncomm_positions_long_all) - Number(d.noncomm_positions_short_all);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const weeks = Math.min(Math.max(Number(req.query.weeks) || 12, 4), 52);
    const data = await fetchGold(52);
    if (!data.length) throw new Error("CFTC returned no rows");

    const nets = data.map(net);
    const latest = nets[0];
    const mu = nets.reduce((s, v) => s + v, 0) / nets.length;
    const sd = Math.sqrt(nets.reduce((s, v) => s + (v - mu) ** 2, 0) / nets.length);
    const z = sd !== 0 ? (latest - mu) / sd : 0;

    let level, signal;
    if (z >= 1.5) { level = "EXTREME LONG"; signal = "extreme_long"; }
    else if (z >= 0.5) { level = "LONG"; signal = "long"; }
    else if (z <= -1.5) { level = "EXTREME SHORT"; signal = "extreme_short"; }
    else if (z <= -0.5) { level = "SHORT"; signal = "short"; }
    else { level = "NEUTRAL"; signal = "neutral"; }

    const prev = nets.length >= 2 ? nets[1] : latest;
    const series = data.slice(0, weeks).map((d) => ({
      date: d.report_date_as_yyyy_mm_dd,
      net: net(d),
      long: Number(d.noncomm_positions_long_all),
      short: Number(d.noncomm_positions_short_all),
      oi: Number(d.open_interest_all),
    }));

    return res.status(200).json({
      ok: true,
      asOf: data[0].report_date_as_yyyy_mm_dd,
      categories: {
        metals: [{
          symbol: "GC",
          display: "Gold",
          category: "metals",
          asOf: data[0].report_date_as_yyyy_mm_dd,
          net: Math.round(latest),
          zScore: +z.toFixed(2),
          level,
          signal,
          weekChange: Math.round(latest - prev),
        }],
      },
    });
  } catch (e) {
    console.error("[COT] error:", e.message);
    return res.status(502).json({ error: "COT fetch failed", detail: e.message });
  }
}
