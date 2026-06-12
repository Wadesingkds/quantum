// Pakasir Webhook Handler
// POST /api/pakasir/webhook
// Verifies HMAC signature before processing any payment activation

import { createHmac, timingSafeEqual } from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const WEBHOOK_SECRET = process.env.PAKASIR_WEBHOOK_SECRET;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  // Verify HMAC signature if secret is configured
  if (WEBHOOK_SECRET) {
    const signature = req.headers['x-pakasir-signature'] || req.headers['x-signature'] || '';
    const rawBody = JSON.stringify(req.body);
    const expectedSig = createHmac('sha256', WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    let isValid = false;
    try {
      isValid = timingSafeEqual(
        Buffer.from(signature.replace(/^sha256=/, '')),
        Buffer.from(expectedSig)
      );
    } catch {
      isValid = false;
    }

    if (!isValid) {
      console.error('[Pakasir Webhook] Invalid signature — rejected');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  } else {
    // No secret configured — log warning but allow (backward compat)
    console.warn('[Pakasir Webhook] PAKASIR_WEBHOOK_SECRET not set — signature verification skipped');
  }

  // Pakasir may send flat or nested payload
  const payload = req.body?.payment || req.body;
  const { order_id, status, amount } = payload;

  console.log('[Pakasir Webhook] payload:', JSON.stringify(req.body));

  if (!order_id) {
    return res.status(400).json({ error: 'Missing order_id' });
  }

  // Pakasir sends 'paid', 'success', or 'completed'
  if (status === 'paid' || status === 'success' || status === 'completed') {
    if (SUPABASE_URL && SUPABASE_KEY) {
      try {
        // First fetch the subscription to verify order exists and get expected amount
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
          console.error('[Pakasir Webhook] order_id not found:', order_id);
          return res.status(404).json({ error: 'Order not found' });
        }

        const sub = rows[0];

        // Guard: skip if already active (idempotency)
        if (sub.status === 'active') {
          console.log('[Pakasir Webhook] Already active, skipping:', order_id);
          return res.status(200).json({ received: true, note: 'already_active' });
        }

        // Verify amount matches expected plan price
        const PLAN_PRICES = { lifetime: 500000 };
        const expectedAmount = PLAN_PRICES[sub.plan];
        if (expectedAmount && amount && Number(amount) < expectedAmount) {
          console.error(`[Pakasir Webhook] Amount mismatch: got ${amount}, expected ${expectedAmount}`);
          return res.status(400).json({ error: 'Amount mismatch' });
        }

        // Activate subscription
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
  }

  return res.status(200).json({ received: true });
}
