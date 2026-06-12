// Pakasir Checkout API
// POST /api/pakasir/checkout
// Body: { plan: 'monthly'|'lifetime', email: string }
// amount is ALWAYS determined server-side — never trust client

const PLAN_PRICES = {
  lifetime: 500000
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { plan, email } = req.body;

  // Validate plan
  if (!plan || !PLAN_PRICES[plan]) {
    return res.status(400).json({ error: 'Invalid plan. Must be monthly or lifetime.' });
  }

  // Validate email format server-side
  if (!email || typeof email !== 'string' || !email.includes('@') || email.length > 254) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  const PAKASIR_SLUG = process.env.PAKASIR_SLUG;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!PAKASIR_SLUG) {
    return res.status(500).json({ error: 'Pakasir slug not configured' });
  }

  // Use server-determined price — ignore any client-sent amount
  const amount = PLAN_PRICES[plan];
  const orderId = `QL-${Date.now()}-${plan.toUpperCase()}`;

  // Insert pending subscription to Supabase
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const expiresAt = plan === 'lifetime' ? null :
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      await fetch(`${SUPABASE_URL}/rest/v1/subscriptions`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify({
          email,
          plan,
          status: 'pending',
          expires_at: expiresAt,
          metadata: { order_id: orderId, amount, timestamp: Date.now() }
        })
      });
    } catch (e) {
      console.error('Supabase insert error:', e.message);
    }
  }

  // Redirect goes to server-side activation endpoint, NOT success.html directly
  // The activation endpoint verifies order_id against Supabase before activating
  const activationUrl = `https://quantum-leaps-gamma.vercel.app/api/subscription/activate`;
  const redirectUrl = `${activationUrl}?order_id=${encodeURIComponent(orderId)}&email=${encodeURIComponent(email)}&plan=${encodeURIComponent(plan)}`;
  const checkoutUrl = `https://app.pakasir.com/pay/${PAKASIR_SLUG}/${amount}?order_id=${encodeURIComponent(orderId)}&redirect=${encodeURIComponent(redirectUrl)}`;

  return res.status(200).json({ checkoutUrl });
}
