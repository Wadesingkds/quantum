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

  function mergeLevels(levels, signals) {
    // levels: { buy1, buy2, buy3, sell1, sell2, sell3 }
    const result = {};
    for (const [key, price] of Object.entries(levels)) {
      if (price && price > 0) {
        result[key] = { price: price, badges: getBadges(price, signals) };
      }
    }
    return result;
  }

  return { mergeLevels, getBadges };
})();
