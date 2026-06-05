// Pakasir Webhook Handler
// POST /api/pakasir/webhook
// Pakasir sends: { order_id, status, amount, project } or nested in { payment: {...} }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  // Pakasir may send flat or nested payload
  const payload = req.body?.payment || req.body;
  const { order_id, status, amount, customer_email } = payload;

  console.log('[Pakasir Webhook] payload:', JSON.stringify(req.body));

  if (!order_id) {
    return res.status(400).json({ error: 'Missing order_id' });
  }

  // Pakasir sends 'paid', 'success', or 'completed'
  if (status === 'paid' || status === 'success' || status === 'completed') {
    if (SUPABASE_URL && SUPABASE_KEY) {
      try {
        // Match by order_id inside metadata JSON
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
              metadata: { order_id, paid_at: new Date().toISOString(), amount }
            })
          }
        );
        const data = await resp.json();
        console.log('[Pakasir Webhook] Supabase update:', JSON.stringify(data));
      } catch (e) {
        console.error('[Pakasir Webhook] Supabase error:', e.message);
      }
    }
  }

  return res.status(200).json({ received: true });
}
