// Server-side activation endpoint
// GET /api/subscription/activate?order_id=...&email=...&plan=...
// Called by Pakasir redirect after payment — verifies order exists in Supabase before activating
// This replaces the old success.html direct localStorage activation

const PLAN_PRICES = {
  monthly: 100000,
  lifetime: 1000000
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { order_id, email, plan } = req.query;

  // Basic validation
  if (!order_id || !email || !plan) {
    return res.redirect('/success.html?status=error&reason=missing_params');
  }

  if (!PLAN_PRICES[plan]) {
    return res.redirect('/success.html?status=error&reason=invalid_plan');
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    // Fallback: redirect to success without localStorage activation params
    // User will need to wait for webhook to activate
    return res.redirect('/success.html?status=pending');
  }

  try {
    // Check order exists and belongs to this email
    const checkResp = await fetch(
      `${SUPABASE_URL}/rest/v1/subscriptions?metadata->>order_id=eq.${encodeURIComponent(order_id)}&email=eq.${encodeURIComponent(email)}&select=status,plan,email`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        }
      }
    );
    const rows = await checkResp.json();

    if (!rows || rows.length === 0) {
      console.error('[Activate] Order not found:', order_id, email);
      return res.redirect('/success.html?status=pending&reason=verifying');
    }

    const sub = rows[0];

    // Order exists and belongs to correct email
    if (sub.status === 'active') {
      // Already activated (likely by webhook) — safe to show success
      return res.redirect(`/success.html?status=active&plan=${encodeURIComponent(sub.plan)}&verified=1`);
    }

    // Payment may still be processing — show pending page
    // Webhook will activate when Pakasir confirms
    return res.redirect(`/success.html?status=pending&plan=${encodeURIComponent(plan)}&order_id=${encodeURIComponent(order_id)}`);

  } catch (e) {
    console.error('[Activate] Error:', e.message);
    return res.redirect('/success.html?status=pending');
  }
}
