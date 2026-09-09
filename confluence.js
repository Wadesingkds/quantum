/**
 * Confluence - Badge merge logic
 * Finds which SMC zones are near each Gann level (threshold <0.5% distance)
 */
window.Confluence = (function () {
  const THRESHOLD = 0.005; // 0.5%
  const BADGE_MAP = {
    FVG: { emoji: '🟡', label: 'FVG' },
    OB:  { emoji: '🔴', label: 'OB' },
    BOS: { emoji: '🟢', label: 'BOS' },
    CHoCH: { emoji: '🟠', label: 'CHoCH' }
  };

  function getBadges(gannPrice, signals) {
    if (!gannPrice || !signals || !signals.length) return [];
    const seen = new Set();
    const badges = [];
    for (const sig of signals) {
      const dist = Math.abs(sig.price - gannPrice) / gannPrice;
      if (dist < THRESHOLD) {
        const key = sig.type + '-' + sig.direction;
        if (!seen.has(key)) {
          seen.add(key);
          const badge = BADGE_MAP[sig.type];
          if (badge) badges.push({ ...badge, direction: sig.direction, distance: dist });
        }
      }
    }
    return badges;
  }

  // Confluence score 0-100: weighted zone count (max 60) + proximity bonus (max 40)
  const TYPE_W = { BOS: 25, CHoCH: 20, OB: 15, FVG: 10 };
  function scoreLevel(price, signals) {
    const badges = getBadges(price, signals);
    let pts = 0;
    let nearest = Infinity;
    for (const b of badges) {
      pts += TYPE_W[b.label] || 5;
      if (b.distance < nearest) nearest = b.distance;
    }
    pts = Math.min(pts, 60);
    if (nearest !== Infinity) pts += 40 * Math.max(0, 1 - nearest / THRESHOLD);
    return { price: price, badges: badges, score: Math.round(Math.min(100, pts)) };
  }

  function mergeLevels(levels, signals) {
    // levels: { buy1, buy2, buy3, sell1, sell2, sell3 }
    const result = {};
    for (const [key, price] of Object.entries(levels)) {
      if (price && price > 0) {
        result[key] = scoreLevel(price, signals);
      }
    }
    return result;
  }

  return { mergeLevels, getBadges, scoreLevel };
})();
