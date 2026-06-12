// Pakasir Webhook Handler
// POST /api/pakasir/webhook
// Verifies payment via Pakasir Transaction Detail API before activating subscription

const PLAN_PRICES = {
  lifetime: 500000
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const PAKASIR_SLUG = process.env.PAKASIR_SLUG;
  const PAKASIR_API_KEY = process.env.PAKASIR_API_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  // Pakasir may send flat or nested payload
  const payload = req.body?.payment || req.body;
  const { order_id, status, amount } = payload;

  console.log('[Pakasir Webhook] payload:', JSON.stringify(req.body));

  if (!order_id) {
    return res.status(400).json({ error: 'Missing order_id' });
  }

  // Only process completed/paid/success statuses
  const isPaid = status === 'paid' || status === 'success' || status === 'completed';
  if (!isPaid) {
    return res.status(200).json({ received: true, note: 'status_not_paid' });
  }

  // ── Cross-verify with Pakasir Transaction Detail API ──
  if (PAKASIR_API_KEY && PAKASIR_SLUG) {
    try {
      const verifyUrl = `https://app.pakasir.com/api/transactiondetail?project=${encodeURIComponent(PAKASIR_SLUG)}&amount=${encodeURIComponent(amount)}&order_id=${encodeURIComponent(order_id)}&api_key=${encodeURIComponent(PAKASIR_API_KEY)}`;
      const verifyResp = await fetch(verifyUrl);
      const verifyData = await verifyResp.json();

      const txn = verifyData?.transaction;

      if (!txn) {
        console.error('[Pakasir Webhook] Transaction not found in Pakasir:', order_id);
        return res.status(400).json({ error: 'Transaction not found in Pakasir' });
      }

      const txnStatus = txn.status;
      if (txnStatus !== 'completed' && txnStatus !== 'paid' && txnStatus !== 'success') {
        console.error(`[Pakasir Webhook] Pakasir status is '${txnStatus}', not paid — rejected`);
        return res.status(400).json({ error: `Payment not confirmed by Pakasir (status: ${txnStatus})` });
      }

      // Verify amount matches
      const confirmedAmount = Number(txn.amount);
      if (confirmedAmount < 500000) {
        console.error(`[Pakasir Webhook] Amount too low: ${confirmedAmount}`);
        return res.status(400).json({ error: 'Amount too low' });
      }

      console.log('[Pakasir Webhook] Pakasir verification OK:', order_id, confirmedAmount);
    } catch (e) {
      console.error('[Pakasir Webhook] Pakasir verification error:', e.message);
      // Fail closed — if we can't verify, don't activate
      return res.status(500).json({ error: 'Cannot verify payment with Pakasir' });
    }
  } else {
    console.warn('[Pakasir Webhook] PAKASIR_API_KEY not set — skipping cross-verification');
  }

  // ── Activate in Supabase ──
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      // Check order exists and not already active
      const checkResp = await fetch(
        `${SUPABASE_URL}/rest/v1/subscriptions?metadata->>order_id=eq.${encodeURIComponent(order_id)}&select=email,plan,metadata,status`,
        {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
          }
        }
      );
      const rows = await checkResp.json();

      if (!rows || rows.length === 0) {
        console.error('[Pakasir Webhook] Order not found in Supabase:', order_id);
        return res.status(404).json({ error: 'Order not found' });
      }

      const sub = rows[0];

      // Idempotency guard
      if (sub.status === 'active') {
        console.log('[Pakasir Webhook] Already active, skipping:', order_id);
        return res.status(200).json({ received: true, note: 'already_active' });
      }

      // Activate
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/subscriptions?metadata->>order_id=eq.${encodeURIComponent(order_id)}`,
        {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify({
            status: 'active',
            updated_at: new Date().toISOString(),
            metadata: {
              ...sub.metadata,
              order_id,
              paid_at: new Date().toISOString(),
              amount
            }
          })
        }
      );
      const data = await resp.json();
      console.log('[Pakasir Webhook] Activated:', JSON.stringify(data));
    } catch (e) {
      console.error('[Pakasir Webhook] Supabase error:', e.message);
      return res.status(500).json({ error: 'Internal error' });
    }
  }

  return res.status(200).json({ received: true });
}
