/**
 * SMC Detection - Ported from quantumleaps-v2/src/lib/smc.ts
 * Detects: FVG (Fair Value Gap), OB (Order Block), BOS (Break of Structure), CHoCH (Change of Character)
 */
window.SMC = (function () {
  // Find swing highs/lows using lookback
  function findSwingPoints(candles, lookback) {
    const swings = [];
    for (let i = lookback; i < candles.length - lookback; i++) {
      const h = candles[i].high;
      const l = candles[i].low;
      let isHigh = true, isLow = true;
      for (let j = 1; j <= lookback; j++) {
        if (candles[i - j].high >= h || candles[i + j].high >= h) isHigh = false;
        if (candles[i - j].low <= l || candles[i + j].low <= l) isLow = false;
      }
      if (isHigh) swings.push({ index: i, type: 'high', price: h });
      if (isLow) swings.push({ index: i, type: 'low', price: l });
    }
    return swings;
  }

  // Detect Fair Value Gaps
  function detectFVG(candles) {
    const fvgs = [];
    for (let i = 2; i < candles.length; i++) {
      const c0 = candles[i - 2], c2 = candles[i];
      // Bullish FVG: gap between c0.high and c2.low
      if (c2.low > c0.high) {
        fvgs.push({
          type: 'FVG',
          direction: 'bullish',
          price: (c0.high + c2.low) / 2,
          top: c2.low,
          bottom: c0.high,
          index: i
        });
      }
      // Bearish FVG: gap between c2.high and c0.low
      if (c2.high < c0.low) {
        fvgs.push({
          type: 'FVG',
          direction: 'bearish',
          price: (c2.high + c0.low) / 2,
          top: c0.low,
          bottom: c2.high,
          index: i
        });
      }
    }
    return fvgs;
  }

  // Detect Order Blocks
  function detectOB(candles) {
    const obs = [];
    for (let i = 2; i < candles.length; i++) {
      const prev = candles[i - 1], curr = candles[i];
      // Bullish OB: bearish candle followed by strong bullish move
      if (prev.close < prev.open && curr.close > curr.open &&
          (curr.close - curr.open) > (prev.open - prev.close) * 1.5) {
        obs.push({
          type: 'OB',
          direction: 'bullish',
          price: (prev.open + prev.close) / 2,
          top: prev.open,
          bottom: prev.close,
          index: i - 1
        });
      }
      // Bearish OB: bullish candle followed by strong bearish move
      if (prev.close > prev.open && curr.close < curr.open &&
          (curr.open - curr.close) > (prev.close - prev.open) * 1.5) {
        obs.push({
          type: 'OB',
          direction: 'bearish',
          price: (prev.open + prev.close) / 2,
          top: prev.close,
          bottom: prev.open,
          index: i - 1
        });
      }
    }
    return obs;
  }

  // Detect Break of Structure
  function detectBOS(candles, swings) {
    const bosList = [];
    let lastHigh = null, lastLow = null;
    for (const s of swings) {
      if (s.type === 'high') {
        if (lastHigh !== null && s.price > lastHigh.price) {
          bosList.push({
            type: 'BOS',
            direction: 'bullish',
            price: lastHigh.price,
            index: s.index
          });
        }
        lastHigh = s;
      } else {
        if (lastLow !== null && s.price < lastLow.price) {
          bosList.push({
            type: 'BOS',
            direction: 'bearish',
            price: lastLow.price,
            index: s.index
          });
        }
        lastLow = s;
      }
    }
    return bosList;
  }

  // Detect Change of Character
  function detectCHoCH(candles, swings) {
    const chochList = [];
    let trend = null; // 'up' or 'down'
    let prevSwing = null;
    for (const s of swings) {
      if (!prevSwing) { prevSwing = s; continue; }
      if (s.type === 'high' && prevSwing.type === 'low') {
        if (trend === 'down' && s.price > (prevSwing.price)) {
          chochList.push({
            type: 'CHoCH',
            direction: 'bullish',
            price: prevSwing.price,
            index: s.index
          });
        }
        trend = 'up';
      } else if (s.type === 'low' && prevSwing.type === 'high') {
        if (trend === 'up' && s.price < (prevSwing.price)) {
          chochList.push({
            type: 'CHoCH',
            direction: 'bearish',
            price: prevSwing.price,
            index: s.index
          });
        }
        trend = 'down';
      }
      prevSwing = s;
    }
    return chochList;
  }

  function detectAllSignals(candles, lookback) {
    lookback = lookback || 3;
    const swings = findSwingPoints(candles, lookback);
    const fvgs = detectFVG(candles);
    const obs = detectOB(candles);
    const bos = detectBOS(candles, swings);
    const choch = detectCHoCH(candles, swings);
    return [...fvgs, ...obs, ...bos, ...choch];
  }

  return { detectAllSignals };
})();
