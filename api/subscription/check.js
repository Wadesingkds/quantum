// Subscription Check API
// GET /api/subscription/check?email=xxx
// Returns: { premium: boolean, plan: string, expires_at: string }

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.query;
  
  if (!email) {
    return res.status(400).json({ error: 'Missing email parameter' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    // Fallback to localStorage if Supabase not configured
    return res.status(200).json({ 
      premium: false, 
      fallback: true 
    });
  }

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/subscriptions?email=eq.${encodeURIComponent(email)}&select=*`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    const data = await response.json();

    if (!data || data.length === 0) {
      return res.status(200).json({ premium: false });
    }

    const sub = data[0];
    const now = new Date();
    const expiresAt = sub.expires_at ? new Date(sub.expires_at) : null;
    
    // Check if active and not expired
    const isPremium = sub.status === 'active' && 
      (!expiresAt || expiresAt > now);

    return res.status(200).json({
      premium: isPremium,
      plan: sub.plan,
      status: sub.status,
      expires_at: sub.expires_at
    });

  } catch (err) {
    console.error('Subscription check error:', err);
    return res.status(500).json({ 
      error: 'Failed to check subscription',
      premium: false 
    });
  }
}
