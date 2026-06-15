/**
 * Claudezilla Stripe Checkout Worker
 *
 * Handles payment session creation for Stripe Checkout.
 * Communicates with Stripe API and returns checkout URLs to the extension.
 *
 * SECURITY:
 * - Origin validation against whitelist
 * - Amount bounds checking (min $3, max $999.99)
 * - Redirect URL whitelist
 * - Type validation on all inputs
 */

interface Env {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  FRONTEND_URL?: string;
  DB?: D1Database;
}

/**
 * Stable hash of a string using SHA-256. Used to derive idempotency keys
 * from request bodies so retried checkout creations don't produce duplicate
 * Stripe Checkout sessions.
 */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify a Stripe webhook signature header.
 * Header format: `t=<timestamp>,v1=<sig>,v1=<sig>,…` (Stripe may include
 * multiple v1 signatures during secret rotation).
 *
 * Returns true on first matching v1 signature within a 5-minute tolerance.
 */
async function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
): Promise<boolean> {
  if (!header) return false;

  const parts = header.split(',').reduce<Record<string, string[]>>((acc, p) => {
    const [k, v] = p.split('=');
    if (k && v) (acc[k] ||= []).push(v);
    return acc;
  }, {});

  const timestamp = parts['t']?.[0];
  const signatures = parts['v1'] || [];
  if (!timestamp || signatures.length === 0) return false;

  // 5-minute replay-protection window (matches Stripe library default)
  const nowSec = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > 300) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBytes = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signedPayload),
  );
  const expected = Array.from(new Uint8Array(sigBytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time equality across each provided v1 sig
  return signatures.some(sig => timingSafeEqualHex(sig, expected));
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// SECURITY: Allowed origins for CORS and request validation
const ALLOWED_ORIGINS = [
  'https://boot.industries',
  'https://claudezilla.com',
  'https://www.claudezilla.com',
];

// SECURITY: Allowed redirect URL prefixes
const ALLOWED_REDIRECT_PREFIXES = [
  'https://boot.industries',
  'https://claudezilla.com',
];

// SECURITY: Amount limits in cents
const MIN_AMOUNT = 300;      // $3.00
const MAX_AMOUNT = 99999;    // $999.99

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');

    // SECURITY: Validate origin against whitelist
    // Allow requests with no origin (direct API calls) but validate if present
    const isAllowedOrigin = !origin || ALLOWED_ORIGINS.includes(origin);
    const corsOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

    // CORS headers - use specific origin, not wildcard
    const corsHeaders = {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Credentials': 'false',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // /create-checkout endpoint
    if (url.pathname === '/create-checkout' && request.method === 'POST') {
      // SECURITY: Reject requests from non-whitelisted origins
      if (!isAllowedOrigin) {
        return Response.json(
          { error: 'Origin not allowed' },
          { status: 403, headers: corsHeaders }
        );
      }

      try {
        const body = await request.json();
        const { amount, frequency } = body;

        // Validation: amount must be a number
        if (typeof amount !== 'number') {
          return Response.json(
            { error: 'Amount must be a number' },
            { status: 400, headers: corsHeaders }
          );
        }

        // Validation: amount minimum ($3)
        if (amount < MIN_AMOUNT) {
          return Response.json(
            { error: `Amount must be at least $${MIN_AMOUNT / 100} (${MIN_AMOUNT} cents)` },
            { status: 400, headers: corsHeaders }
          );
        }

        // SECURITY: Amount maximum ($999.99) to prevent abuse
        if (amount > MAX_AMOUNT) {
          return Response.json(
            { error: `Amount cannot exceed $${MAX_AMOUNT / 100}` },
            { status: 400, headers: corsHeaders }
          );
        }

        // Validation: frequency must be string and valid value
        if (typeof frequency !== 'string' || !['one-time', 'monthly'].includes(frequency)) {
          return Response.json(
            { error: 'Frequency must be "one-time" or "monthly"' },
            { status: 400, headers: corsHeaders }
          );
        }

        // Get Stripe secret key
        const stripeKey = env.STRIPE_SECRET_KEY;
        if (!stripeKey) {
          return Response.json(
            { error: 'Stripe not configured' },
            { status: 500, headers: corsHeaders }
          );
        }

        // Get frontend URL for redirects
        const frontendUrl = env.FRONTEND_URL || 'https://boot.industries';

        // SECURITY: Validate redirect URL against whitelist
        const isValidRedirect = ALLOWED_REDIRECT_PREFIXES.some(prefix => frontendUrl.startsWith(prefix));
        if (!isValidRedirect) {
          console.error('Invalid FRONTEND_URL configuration:', frontendUrl);
          return Response.json(
            { error: 'Server misconfiguration' },
            { status: 500, headers: corsHeaders }
          );
        }

        // Determine product name and description
        const isMonthly = frequency === 'monthly';
        const productName = isMonthly
          ? 'Claudezilla Monthly Support'
          : 'Claudezilla One-Time Support';
        const productDescription = isMonthly
          ? 'Monthly contribution to keep Claudezilla free and open source'
          : 'One-time contribution to Claudezilla development';

        // Build Stripe Checkout Session request
        const params = new URLSearchParams({
          'mode': isMonthly ? 'subscription' : 'payment',
          'success_url': `${frontendUrl}/extension/welcome.html?session_id={CHECKOUT_SESSION_ID}`,
          'cancel_url': `${frontendUrl}/extension/support.html`,
          'line_items[0][price_data][currency]': 'usd',
          'line_items[0][price_data][product_data][name]': productName,
          'line_items[0][price_data][product_data][description]': productDescription,
          'line_items[0][price_data][unit_amount]': amount.toString(),
          'line_items[0][quantity]': '1',
        });

        // Add recurring pricing for monthly subscriptions
        if (isMonthly) {
          params.append('line_items[0][price_data][recurring][interval]', 'month');
        }

        // Derive an Idempotency-Key from the request shape so retries by a
        // flaky client (or our own fetch retry under transient network
        // failure) don't produce duplicate Checkout sessions on Stripe's side.
        // Key includes the body-derived params + the cf-ray header (when
        // present) to differentiate distinct front-end attempts that happen
        // to send identical bodies.
        const idempotencyKey = await sha256Hex(
          params.toString() + '|' + (request.headers.get('cf-ray') || ''),
        );

        // Call Stripe API
        const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${stripeKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Idempotency-Key': idempotencyKey,
          },
          body: params.toString(),
        });

        // Handle Stripe API errors
        if (!stripeResponse.ok) {
          const errorText = await stripeResponse.text();
          console.error('Stripe API error:', stripeResponse.status, errorText);
          return Response.json(
            { error: 'Failed to create checkout session' },
            { status: 500, headers: corsHeaders }
          );
        }

        // Parse Stripe response
        const session = await stripeResponse.json();

        // Return checkout URL
        return Response.json(
          { url: session.url },
          { status: 200, headers: corsHeaders }
        );

      } catch (error) {
        console.error('Checkout error:', error);
        const message = error instanceof Error ? error.message : 'Internal server error';
        return Response.json(
          { error: message },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // /notify endpoint - Email capture
    if (url.pathname === '/notify' && request.method === 'POST') {
      // SECURITY: Origin validation
      if (!isAllowedOrigin) {
        return Response.json(
          { error: 'Origin not allowed' },
          { status: 403, headers: corsHeaders }
        );
      }

      try {
        const body = await request.json();
        const { email } = body;

        // Validation: email must be string
        if (typeof email !== 'string') {
          return Response.json(
            { error: 'Email must be a string' },
            { status: 400, headers: corsHeaders }
          );
        }

        // Validation: email format (basic check)
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          return Response.json(
            { error: 'Invalid email format' },
            { status: 400, headers: corsHeaders }
          );
        }

        // Validation: length limits
        if (email.length < 3 || email.length > 254) {
          return Response.json(
            { error: 'Email length must be 3-254 characters' },
            { status: 400, headers: corsHeaders }
          );
        }

        // Get D1 database binding
        const db = env.DB;
        if (!db) {
          return Response.json(
            { error: 'Database not configured' },
            { status: 500, headers: corsHeaders }
          );
        }

        // Insert email (ignore duplicates)
        const result = await db.prepare(
          'INSERT OR IGNORE INTO email_signups (email, created_at) VALUES (?, ?)'
        ).bind(email.toLowerCase(), Date.now()).run();

        // Check if inserted (result.meta.changes > 0) or duplicate
        const isDuplicate = result.meta.changes === 0;

        return Response.json(
          {
            success: true,
            message: isDuplicate ? 'Already subscribed' : 'Subscribed successfully'
          },
          { status: 200, headers: corsHeaders }
        );

      } catch (error) {
        console.error('Notify error:', error);
        const message = error instanceof Error ? error.message : 'Internal server error';
        return Response.json(
          { error: message },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // Stripe webhook endpoint
    // Currently handles `checkout.session.completed` only.
    // Other events (subscription churn, payment failures) are intentionally
    // ignored until they're actually needed — Stripe will return 200 and
    // not re-deliver if we acknowledge with a 200.
    if (url.pathname === '/webhook' && request.method === 'POST') {
      const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
      if (!webhookSecret) {
        console.error('Webhook hit but STRIPE_WEBHOOK_SECRET is not configured');
        return new Response('Webhook not configured', { status: 500 });
      }

      // Read raw body — Stripe signs the exact bytes sent
      const rawBody = await request.text();
      const signature = request.headers.get('Stripe-Signature');

      const verified = await verifyStripeSignature(rawBody, signature, webhookSecret);
      if (!verified) {
        console.error('Invalid Stripe signature on /webhook');
        return new Response('Invalid signature', { status: 401 });
      }

      let event: { type?: string; data?: { object?: Record<string, unknown> }; id?: string };
      try {
        event = JSON.parse(rawBody);
      } catch {
        return new Response('Invalid JSON', { status: 400 });
      }

      // Only handle checkout.session.completed for now (min-viable scope)
      if (event.type !== 'checkout.session.completed') {
        // Acknowledge so Stripe doesn't retry events we don't care about
        return new Response('Ignored', { status: 200 });
      }

      const session = event.data?.object as Record<string, any> | undefined;
      if (!session) return new Response('Malformed event', { status: 400 });

      const stripeSessionId = String(session.id || '');
      const stripePaymentIntent = session.payment_intent ? String(session.payment_intent) : null;
      const amountTotal = typeof session.amount_total === 'number' ? session.amount_total : 0;
      const currency = String(session.currency || 'usd');
      const customerEmail = session.customer_details?.email || session.customer_email || null;
      const mode = String(session.mode || 'payment');
      const eventId = String(event.id || '');

      const db = env.DB;
      if (!db) {
        console.error('Webhook received but DB binding is not configured');
        // Return 500 so Stripe retries when the binding is wired up
        return new Response('Database not configured', { status: 500 });
      }

      try {
        // INSERT OR IGNORE guards against Stripe redelivering the same event
        // (e.g. our 200 acknowledgment was lost), so we silently de-dupe on
        // stripe_event_id.
        await db.prepare(
          `INSERT OR IGNORE INTO donations
            (stripe_event_id, stripe_session_id, stripe_payment_intent,
             email, amount_cents, currency, mode, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          eventId,
          stripeSessionId,
          stripePaymentIntent,
          customerEmail,
          amountTotal,
          currency,
          mode,
          Date.now(),
        ).run();
      } catch (e) {
        console.error('Failed to insert donation row:', e);
        // Return 500 so Stripe retries the event
        return new Response('DB write failed', { status: 500 });
      }

      return new Response('OK', { status: 200 });
    }

    // Health check endpoint
    if (url.pathname === '/health' && request.method === 'GET') {
      return Response.json({ status: 'ok' }, { headers: corsHeaders });
    }

    // 404
    return Response.json(
      { error: 'Not found' },
      { status: 404, headers: corsHeaders }
    );
  },
};
