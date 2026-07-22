/**
 * Quantum Leaps - Main App Logic
 * Live data + SMC confluence + COT integration
 */
(function () {
  const API_BASE = 'https://quantum-api.quantumleaps.biz.id';
  const COT_API = '/api/cot/proxy';
  let currentTF = 'M15';
  let livePriceData = null;
  let candleData = [];
  let smcSignals = [];

  // Badge HTML renderer
  function renderBadges(badges) {
    if (!badges || !badges.length) return '';
    return badges.map(b =>
      `<span class="smc-badge" title="${b.label} (${b.direction})">${b.emoji} ${b.label}</span>`
    ).join(' ');
  }

  // Show/hide loader
  function setLoading(on) {
    const loader = document.getElementById('dataLoader');
    if (loader) loader.style.display = on ? 'flex' : 'none';
    const btn = document.getElementById('btnCalc');
    if (btn) { btn.classList.toggle('loading', on); btn.disabled = on; }
  }

  // Fetch live price
  async function fetchPrice() {
    try {
      const r = await fetch(API_BASE + '/price');
      if (!r.ok) throw new Error('Price fetch failed');
      livePriceData = await r.json();
      updatePriceDisplay();
    } catch (e) {
      console.warn('Price fetch error:', e);
      const el = document.getElementById('livePriceValue');
      if (el) el.textContent = '—';
    }
  }

  // Update price display
  function updatePriceDisplay() {
    const priceEl = document.getElementById('livePriceValue');
    const changeEl = document.getElementById('livePriceChange');
    if (!livePriceData) return;
    const p = livePriceData.price || livePriceData.bid || livePriceData;
    if (priceEl) priceEl.textContent = typeof p === 'number' ? p.toFixed(2) : p;
    if (changeEl && livePriceData.change !== undefined) {
      const c = livePriceData.change;
      changeEl.textContent = (c >= 0 ? '+' : '') + c.toFixed(2);
      changeEl.style.color = c >= 0 ? '#22c55e' : '#ef4444';
    }
  }

  // Fetch candles for current timeframe
  async function fetchCandles() {
    try {
      const apiTF = TF_API_MAP[currentTF] || currentTF.toLowerCase();
      const r = await fetch(API_BASE + '/candles?tf=' + apiTF + '&limit=500');
      if (!r.ok) throw new Error('Candles fetch failed');
      const data = await r.json();
      candleData = (data.candles || data).map(c => ({
        open: c.open || c[1],
        high: c.high || c[2],
        low: c.low || c[3],
        close: c.close || c[4],
        time: c.time || c[0]
      }));
      // Run SMC detection
      if (window.SMC && candleData.length > 0) {
        smcSignals = window.SMC.detectAllSignals(candleData);
      }
    } catch (e) {
      console.warn('Candles fetch error:', e);
      candleData = [];
      smcSignals = [];
    }
  }

  // Fetch COT data
  async function fetchCOT() {
    try {
      const r = await fetch(COT_API);
      if (!r.ok) throw new Error('COT fetch failed');
      const json = await r.json();
      // API returns { categories: { metals: [{symbol:'GC', display:'Gold', net, zScore, level, signal}] } }
      const metals = json.categories?.metals || [];
      const gold = metals.find(m => m.symbol === 'GC') || metals[0] || null;
      if (!gold) throw new Error('No gold COT data');
      updateCOTDisplay({
        net_position: gold.net,
        z_score: gold.zScore,
        bias: gold.level || gold.signal,
        change: gold.weekChange,
        asOf: gold.asOf
      });
    } catch (e) {
      console.warn('COT fetch error:', e);
      const panel = document.getElementById('cotPanel');
      if (panel) panel.innerHTML = '<div class="cot-item">Data COT tidak tersedia</div>';
    }
  }

  // Update COT display
  function updateCOTDisplay(data) {
    const panel = document.getElementById('cotPanel');
    if (!panel) return;
    const net = data.net_position || data.net || '—';
    const zscore = data.z_score || data.zscore || '—';
    const bias = data.bias || '—';
    const biasColor = /bull/i.test(bias) ? '#22c55e' : /bear/i.test(bias) ? '#ef4444' : '#fbbf24';
    panel.innerHTML = `
      <div class="cot-item"><span class="cot-label">NET POS</span><span class="cot-value">${net}</span></div>
      <div class="cot-item"><span class="cot-label">Z-SCORE</span><span class="cot-value">${zscore}</span></div>
      <div class="cot-item"><span class="cot-label">BIAS</span><span class="cot-value" style="color:${biasColor}">${bias}</span></div>
    `;
  }

  // Timeframe selector
  window.selectTF = function (tf) {
    currentTF = tf;
    document.querySelectorAll('.tf-btn').forEach(b => b.classList.toggle('active', b.dataset.tf === tf));
    fetchCandles();
  };

  // Main calculate function - replaces inline calculate()
  window.calculate = async function () {
    // Check Supabase session
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
      const modal = document.getElementById('authModal');
      if (modal) modal.style.display = 'flex';
      return;
    }
    // Check premium
    const premium = await isPremium();
    if (!premium) {
      showToast('Upgrade ke Premium untuk akses penuh', 'warning', 'PREMIUM REQUIRED');
      showPage('pageSub');
      return;
    }

    const highEl = document.getElementById('swingHigh');
    const lowEl = document.getElementById('swingLow');
    const errHigh = document.getElementById('errHigh');
    const errLow = document.getElementById('errLow');
    const results = document.getElementById('results');

    if (!isValidInput(highEl, errHigh) || !isValidInput(lowEl, errLow)) return;

    const hasHigh = highEl.value.trim() !== '';
    const hasLow = lowEl.value.trim() !== '';

    if (!hasHigh && !hasLow) {
      [highEl, lowEl].forEach(el => el.classList.add('error'));
      errHigh.textContent = errLow.textContent = '⚠ Fill at least one field';
      errHigh.style.display = errLow.style.display = 'block';
      return;
    }

    errHigh.textContent = errLow.textContent = '⚠ Enter a valid positive number';
    results.classList.remove('show');
    setLoading(true);

    // Parallel fetch: price + candles + COT
    await Promise.allSettled([fetchPrice(), fetchCandles(), fetchCOT()]);

    // Calculate Gann levels
    const levels = {};
    if (hasHigh) {
      const high = parseFloat(highEl.value);
      levels.buy1 = Math.pow(Math.sqrt(high) - 0.125, 2);
      levels.buy2 = Math.pow(Math.sqrt(high) - 0.175, 2);
      levels.buy3 = Math.pow(Math.sqrt(high) - 0.250, 2);
    }
    if (hasLow) {
      const low = parseFloat(lowEl.value);
      levels.sell1 = Math.pow(Math.sqrt(low) + 0.125, 2);
      levels.sell2 = Math.pow(Math.sqrt(low) + 0.175, 2);
      levels.sell3 = Math.pow(Math.sqrt(low) + 0.250, 2);
    }

    // Merge with SMC confluence
    const merged = window.Confluence ? window.Confluence.mergeLevels(levels, smcSignals) : {};

    // Update UI
    const buyGroup = document.getElementById('buyGroup');
    const sellGroup = document.getElementById('sellGroup');

    if (hasHigh) {
      setLevelDisplay('buy1', levels.buy1, merged.buy1);
      setLevelDisplay('buy2', levels.buy2, merged.buy2);
      setLevelDisplay('buy3', levels.buy3, merged.buy3);
      buyGroup.style.display = 'block';
    } else { buyGroup.style.display = 'none'; }

    if (hasLow) {
      setLevelDisplay('sell1', levels.sell1, merged.sell1);
      setLevelDisplay('sell2', levels.sell2, merged.sell2);
      setLevelDisplay('sell3', levels.sell3, merged.sell3);
      sellGroup.style.display = 'block';
    } else { sellGroup.style.display = 'none'; }

    setLoading(false);
    results.classList.add('show');
  };

  function setLevelDisplay(id, price, merged) {
    const valEl = document.getElementById('val-' + id);
    const badgeEl = document.getElementById('badge-' + id);
    if (valEl) valEl.textContent = price ? price.toFixed(2) : '—';
    if (badgeEl) badgeEl.innerHTML = merged ? renderBadges(merged.badges) : '';
  }

  // Updated copyResults to include badges
  window.copyResults = function () {
    const high = document.getElementById('swingHigh').value;
    const low = document.getElementById('swingLow').value;
    const lines = ['QUANTUM Leaps — Gann Square of 9', 'XAUUSD Price Projection', '───────────────────────'];
    if (livePriceData) {
      const p = livePriceData.price || livePriceData.bid;
      if (p) lines.push('Live Price : ' + (typeof p === 'number' ? p.toFixed(2) : p));
    }
    if (high) lines.push('Swing High : ' + high);
    if (low) lines.push('Swing Low : ' + low);
    lines.push('');
    if (high) {
      lines.push('BUY LEVELS');
      ['buy1', 'buy2', 'buy3'].forEach(k => {
        const val = document.getElementById('val-' + k).textContent;
        const badges = document.getElementById('badge-' + k).textContent.trim();
        lines.push(k.toUpperCase() + ' : ' + val + (badges ? ' [' + badges + ']' : ''));
      });
      lines.push('');
    }
    if (low) {
      lines.push('SELL LEVELS');
      ['sell1', 'sell2', 'sell3'].forEach(k => {
        const val = document.getElementById('val-' + k).textContent;
        const badges = document.getElementById('badge-' + k).textContent.trim();
        lines.push(k.toUpperCase() + ' : ' + val + (badges ? ' [' + badges + ']' : ''));
      });
      lines.push('');
    }
    lines.push('───────────────────────');
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      const btn = document.getElementById('btnCopy');
      btn.classList.add('copied');
      btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> COPIED';
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> COPY ALL';
      }, 2000);
    });
  };

  window.copySingle = function (valId, label) {
    const val = document.getElementById(valId).textContent;
    if (val === '—') return;
    const badgeEl = document.getElementById(valId.replace('val-', 'badge-'));
    const badges = badgeEl ? badgeEl.textContent.trim() : '';
    const text = label + ' : ' + val + (badges ? ' [' + badges + ']' : '');
    navigator.clipboard.writeText(text).then(() => {
      const valEl = document.getElementById(valId);
      const btn = valEl.parentElement.querySelector('.btn-copy-single');
      if (!btn) return;
      btn.classList.add('copied');
      btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
      }, 1500);
    });
  };

  // ── Countdown Timer: next candle close per TF ──
  const TF_MINUTES = { M1: 1, M5: 5, M15: 15, M30: 30 };
  const TF_API_MAP = { M1: '1m', M5: '5m', M15: '15m', M30: '30m' };
  let countdownInterval = null;
  let autoRefreshTimeout = null;

  function getNextCandleClose(tf) {
    const mins = TF_MINUTES[tf] || 60;
    const now = new Date();
    const ms = now.getTime();
    const periodMs = mins * 60 * 1000;
    const nextClose = Math.ceil(ms / periodMs) * periodMs;
    return new Date(nextClose);
  }

  function formatCountdown(ms) {
    if (ms <= 0) return '00:00';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function updateCountdown() {
    const el = document.getElementById('countdownValue');
    if (!el) return;
    const nextClose = getNextCandleClose(currentTF);
    const remaining = nextClose.getTime() - Date.now();
    el.textContent = formatCountdown(remaining);
    // When candle closes → auto refresh
    if (remaining <= 1000) {
      el.textContent = 'Refreshing...';
      if (!autoRefreshTimeout) {
        autoRefreshTimeout = setTimeout(() => {
          autoRefreshTimeout = null;
          // Re-fetch and recalculate if results visible
          const results = document.getElementById('results');
          if (results && results.classList.contains('show')) {
            window.calculate();
          }
        }, 3000);
      }
    }
  }

  function startCountdown() {
    if (countdownInterval) clearInterval(countdownInterval);
    updateCountdown();
    countdownInterval = setInterval(updateCountdown, 1000);
  }

  // Patch selectTF to restart countdown
  const _origSelectTF = window.selectTF;
  window.selectTF = function (tf) {
    _origSelectTF(tf);
    startCountdown();
  };

  // Find nearest BUY/SELL signal
  function updateNearestSignals() {
    const buyEl = document.getElementById('nearestBuy');
    const sellEl = document.getElementById('nearestSell');
    if (!livePriceData || !smcSignals.length) {
      if (buyEl) buyEl.textContent = '—';
      if (sellEl) sellEl.textContent = '—';
      return;
    }
    const price = livePriceData.price || livePriceData.bid || 0;
    const buyLevels = ['buy1', 'buy2', 'buy3'].map(k => {
      const el = document.getElementById('val-' + k);
      return el ? parseFloat(el.textContent) : null;
    }).filter(v => v && v < price).sort((a, b) => b - a); // nearest below price

    const sellLevels = ['sell1', 'sell2', 'sell3'].map(k => {
      const el = document.getElementById('val-' + k);
      return el ? parseFloat(el.textContent) : null;
    }).filter(v => v && v > price).sort((a, b) => a - b); // nearest above price

    if (buyEl) {
      if (buyLevels.length) {
        const diff = (price - buyLevels[0]).toFixed(2);
        const badgeEl = document.getElementById('badge-buy' + (buyLevels[0] === parseFloat(document.getElementById('val-buy1')?.textContent) ? '1' : buyLevels[0] === parseFloat(document.getElementById('val-buy2')?.textContent) ? '2' : '3'));
        const badges = badgeEl ? badgeEl.textContent.trim() : '';
        buyEl.innerHTML = buyLevels[0].toFixed(2) + ' <span style="color:#22c55e;font-size:0.75rem">(-' + diff + ')</span>' + (badges ? ' ' + badges : '');
      } else {
        buyEl.textContent = '—';
      }
    }
    if (sellEl) {
      if (sellLevels.length) {
        const diff = (sellLevels[0] - price).toFixed(2);
        const badgeEl = document.getElementById('badge-sell' + (sellLevels[0] === parseFloat(document.getElementById('val-sell1')?.textContent) ? '1' : sellLevels[0] === parseFloat(document.getElementById('val-sell2')?.textContent) ? '2' : '3'));
        const badges = badgeEl ? badgeEl.textContent.trim() : '';
        sellEl.innerHTML = sellLevels[0].toFixed(2) + ' <span style="color:#ef4444;font-size:0.75rem">(+' + diff + ')</span>' + (badges ? ' ' + badges : '');
      } else {
        sellEl.textContent = '—';
      }
    }
  }

  // After calculate completes, update nearest signals + start countdown
  const _origCalc = window.calculate;
  window.calculate = async function () {
    await _origCalc();
    updateNearestSignals();
    startCountdown();
  };

  // Fetch live price on load (non-blocking)
  fetchPrice();
  startCountdown();
})();
