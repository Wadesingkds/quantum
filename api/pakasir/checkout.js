// Pakasir Checkout API
// POST /api/pakasir/checkout
// Body: { plan: 'monthly'|'lifetime', amount: number, email: string }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { plan, amount, email } = req.body;

  if (!plan || typeof amount !== 'number' || !email) {
    return res.status(400).json({ error: 'Missing plan, amount, or email' });
  }

  const PAKASIR_SLUG = process.env.PAKASIR_SLUG;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

  if (!PAKASIR_SLUG) {
    return res.status(500).json({ error: 'Pakasir slug not configured' });
  }

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
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify({
          email,
          plan,
          status: 'pending',
          expires_at: expiresAt,
          metadata: { order_id: orderId, timestamp: Date.now() }
        })
      });
    } catch (e) {
      // non-blocking — lanjut checkout walau supabase gagal
      console.error('Supabase insert error:', e.message);
    }
  }

  // Build Pakasir pay URL (URL-based integration, no API key needed)
  const redirectUrl = `https://quantum-leaps-gamma.vercel.app/success.html?email=${encodeURIComponent(email)}&plan=${encodeURIComponent(plan)}`;
  const checkoutUrl = `https://app.pakasir.com/pay/${PAKASIR_SLUG}/${amount}?order_id=${encodeURIComponent(orderId)}&redirect=${encodeURIComponent(redirectUrl)}`;

  return res.status(200).json({ checkoutUrl });
}
