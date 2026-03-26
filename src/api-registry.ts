/**
 * Known API providers registry.
 * Used to detect semantic mismatches: e.g. PEXELS_API_KEY sent to attacker.com
 *
 * keywords: matched against project name + secret key names (case-insensitive, partial)
 * domains:  expected outbound domains for this API
 */

export interface ApiEntry {
  name:     string
  keywords: string[]
  domains:  string[]
}

export const API_REGISTRY: ApiEntry[] = [
  // ── Stock / Media ──────────────────────────────────────────────────────────
  { name: 'Pexels',         keywords: ['pexels'],                       domains: ['api.pexels.com'] },
  { name: 'Unsplash',       keywords: ['unsplash'],                     domains: ['api.unsplash.com', 'unsplash.com'] },
  { name: 'Pixabay',        keywords: ['pixabay'],                      domains: ['pixabay.com'] },
  { name: 'Shutterstock',   keywords: ['shutterstock'],                 domains: ['api.shutterstock.com'] },
  { name: 'Getty Images',   keywords: ['getty'],                        domains: ['api.gettyimages.com'] },
  { name: 'Cloudinary',     keywords: ['cloudinary'],                   domains: ['api.cloudinary.com', 'res.cloudinary.com'] },

  // ── AI / LLM ───────────────────────────────────────────────────────────────
  { name: 'OpenAI',         keywords: ['openai', 'gpt', 'chatgpt'],     domains: ['api.openai.com'] },
  { name: 'Anthropic',      keywords: ['anthropic', 'claude'],          domains: ['api.anthropic.com'] },
  { name: 'Gemini/Google',  keywords: ['gemini', 'bard'],               domains: ['generativelanguage.googleapis.com'] },
  { name: 'Mistral',        keywords: ['mistral'],                      domains: ['api.mistral.ai'] },
  { name: 'Cohere',         keywords: ['cohere'],                       domains: ['api.cohere.ai', 'api.cohere.com'] },
  { name: 'Hugging Face',   keywords: ['huggingface', 'hf_'],           domains: ['huggingface.co', 'api-inference.huggingface.co'] },
  { name: 'Together AI',    keywords: ['together'],                     domains: ['api.together.xyz'] },
  { name: 'Groq',           keywords: ['groq'],                         domains: ['api.groq.com'] },
  { name: 'Replicate',      keywords: ['replicate'],                    domains: ['api.replicate.com'] },
  { name: 'ElevenLabs',     keywords: ['elevenlabs', 'eleven_labs'],    domains: ['api.elevenlabs.io'] },
  { name: 'Stability AI',   keywords: ['stability', 'stablediffusion'], domains: ['api.stability.ai'] },

  // ── Payment ────────────────────────────────────────────────────────────────
  { name: 'Stripe',         keywords: ['stripe'],                       domains: ['api.stripe.com', 'checkout.stripe.com', 'connect.stripe.com'] },
  { name: 'PayPal',         keywords: ['paypal'],                       domains: ['api.paypal.com', 'api.sandbox.paypal.com'] },
  { name: 'Braintree',      keywords: ['braintree'],                    domains: ['api.braintreegateway.com', 'sandbox.braintreegateway.com'] },
  { name: 'Adyen',          keywords: ['adyen'],                        domains: ['checkout-test.adyen.com', 'checkout-live.adyenpayments.com'] },
  { name: 'Square',         keywords: ['square'],                       domains: ['connect.squareupsandbox.com', 'connect.squareup.com'] },
  { name: 'Paddle',         keywords: ['paddle'],                       domains: ['api.paddle.com', 'sandbox-api.paddle.com'] },
  { name: 'LemonSqueezy',   keywords: ['lemonsqueezy', 'lemon_squeezy'], domains: ['api.lemonsqueezy.com'] },
  { name: 'Coinbase',       keywords: ['coinbase'],                     domains: ['api.coinbase.com', 'api.commerce.coinbase.com'] },

  // ── Cloud / Infrastructure ─────────────────────────────────────────────────
  { name: 'AWS',            keywords: ['aws', 'amazon', 'amazonaws'],   domains: ['amazonaws.com', 's3.amazonaws.com', 'ec2.amazonaws.com', 'sts.amazonaws.com'] },
  { name: 'Google Cloud',   keywords: ['gcp', 'google_cloud', 'gcloud'], domains: ['googleapis.com', 'storage.googleapis.com'] },
  { name: 'Azure',          keywords: ['azure'],                        domains: ['azure.com', 'management.azure.com', 'login.microsoftonline.com'] },
  { name: 'Cloudflare',     keywords: ['cloudflare', 'cf_'],            domains: ['api.cloudflare.com'] },
  { name: 'DigitalOcean',   keywords: ['digitalocean', 'do_'],          domains: ['api.digitalocean.com'] },
  { name: 'Vercel',         keywords: ['vercel'],                       domains: ['api.vercel.com'] },
  { name: 'Netlify',        keywords: ['netlify'],                      domains: ['api.netlify.com'] },
  { name: 'Railway',        keywords: ['railway'],                      domains: ['backboard.railway.app'] },
  { name: 'Fly.io',         keywords: ['fly', 'flyio'],                 domains: ['api.machines.dev', 'fly.io'] },

  // ── Communication ──────────────────────────────────────────────────────────
  { name: 'Twilio',         keywords: ['twilio'],                       domains: ['api.twilio.com', 'verify.twilio.com'] },
  { name: 'SendGrid',       keywords: ['sendgrid'],                     domains: ['api.sendgrid.com'] },
  { name: 'Mailgun',        keywords: ['mailgun'],                      domains: ['api.mailgun.net', 'api.eu.mailgun.net'] },
  { name: 'Postmark',       keywords: ['postmark'],                     domains: ['api.postmarkapp.com'] },
  { name: 'Resend',         keywords: ['resend'],                       domains: ['api.resend.com'] },
  { name: 'Slack',          keywords: ['slack'],                        domains: ['slack.com', 'hooks.slack.com'] },
  { name: 'Discord',        keywords: ['discord'],                      domains: ['discord.com', 'discordapp.com'] },
  { name: 'Telegram',       keywords: ['telegram', 'tg_bot'],          domains: ['api.telegram.org'] },
  { name: 'WhatsApp',       keywords: ['whatsapp'],                     domains: ['graph.facebook.com'] },
  { name: 'Vonage/Nexmo',   keywords: ['vonage', 'nexmo'],              domains: ['rest.nexmo.com', 'api.nexmo.com'] },

  // ── Auth / Identity ────────────────────────────────────────────────────────
  { name: 'Auth0',          keywords: ['auth0'],                        domains: ['auth0.com'] },
  { name: 'Clerk',          keywords: ['clerk'],                        domains: ['api.clerk.dev', 'clerk.com'] },
  { name: 'Supabase',       keywords: ['supabase'],                     domains: ['supabase.co', 'supabase.io'] },
  { name: 'Firebase',       keywords: ['firebase', 'firestore'],        domains: ['firebase.googleapis.com', 'firebaseio.com', 'identitytoolkit.googleapis.com'] },
  { name: 'Okta',           keywords: ['okta'],                         domains: ['okta.com', 'okta-emea.com'] },

  // ── Dev Tools ──────────────────────────────────────────────────────────────
  { name: 'GitHub',         keywords: ['github', 'gh_'],                domains: ['api.github.com', 'github.com'] },
  { name: 'GitLab',         keywords: ['gitlab'],                       domains: ['gitlab.com'] },
  { name: 'Bitbucket',      keywords: ['bitbucket'],                    domains: ['api.bitbucket.org'] },
  { name: 'Linear',         keywords: ['linear'],                       domains: ['api.linear.app'] },
  { name: 'Jira/Atlassian', keywords: ['jira', 'atlassian', 'confluence'], domains: ['atlassian.net', 'atlassian.com'] },
  { name: 'Sentry',         keywords: ['sentry'],                       domains: ['sentry.io'] },
  { name: 'Datadog',        keywords: ['datadog', 'dd_'],               domains: ['api.datadoghq.com', 'api.datadoghq.eu'] },
  { name: 'PagerDuty',      keywords: ['pagerduty'],                    domains: ['api.pagerduty.com'] },

  // ── Data / Analytics ──────────────────────────────────────────────────────
  { name: 'Airtable',       keywords: ['airtable'],                     domains: ['api.airtable.com'] },
  { name: 'Notion',         keywords: ['notion'],                       domains: ['api.notion.com'] },
  { name: 'Supabase',       keywords: ['supabase'],                     domains: ['supabase.co'] },
  { name: 'PlanetScale',    keywords: ['planetscale'],                  domains: ['api.planetscale.com'] },
  { name: 'MongoDB Atlas',  keywords: ['mongodb', 'atlas'],             domains: ['cloud.mongodb.com', 'data.mongodb-api.com'] },
  { name: 'Pinecone',       keywords: ['pinecone'],                     domains: ['api.pinecone.io'] },
  { name: 'Algolia',        keywords: ['algolia'],                      domains: ['algolia.net', 'algolianet.com'] },
  { name: 'Elastic',        keywords: ['elastic', 'elasticsearch'],     domains: ['cloud.elastic.co'] },
  { name: 'Mixpanel',       keywords: ['mixpanel'],                     domains: ['api.mixpanel.com'] },
  { name: 'Amplitude',      keywords: ['amplitude'],                    domains: ['api.amplitude.com', 'api2.amplitude.com'] },

  // ── Maps / Location ────────────────────────────────────────────────────────
  { name: 'Google Maps',    keywords: ['googlemaps', 'google_maps', 'gmaps'], domains: ['maps.googleapis.com'] },
  { name: 'Mapbox',         keywords: ['mapbox'],                       domains: ['api.mapbox.com'] },
  { name: 'HERE Maps',      keywords: ['here_maps', 'heremaps'],        domains: ['geocoder.ls.hereapi.com', 'router.hereapi.com'] },
  { name: 'OpenWeather',    keywords: ['openweather', 'owm'],           domains: ['api.openweathermap.org'] },

  // ── E-commerce ────────────────────────────────────────────────────────────
  { name: 'Shopify',        keywords: ['shopify'],                      domains: ['myshopify.com', 'admin.shopify.com'] },
  { name: 'WooCommerce',    keywords: ['woocommerce', 'woo'],           domains: ['woocommerce.com'] },
  { name: 'Amazon MWS/SP',  keywords: ['amazon_seller', 'mws'],        domains: ['sellingpartnerapi-na.amazon.com', 'mws.amazonservices.com'] },
]

// ─── Lookup ───────────────────────────────────────────────────────────────────

/** Extract search terms from project name + key names */
export function extractHints(projectName: string, keyNames: string[]): string[] {
  return [projectName, ...keyNames]
    .join(' ')
    .toLowerCase()
    .split(/[\s_\-./]+/)
    .filter(s => s.length >= 3)
}

/**
 * Given hints (from project name + key names) and a destination domain,
 * returns a match if we can confidently say the destination is wrong.
 *
 * Returns null if no known API is identified (can't judge).
 */
export interface DomainCheckResult {
  matched:   ApiEntry       // which API we identified from hints
  expected:  string[]       // domains we expect
  actual:    string         // domain that was used
  ok:        boolean        // true = domain matches; false = mismatch
}

export function checkDomainMatch(hints: string[], destinationDomain: string): DomainCheckResult | null {
  const dest = destinationDomain.toLowerCase()

  for (const entry of API_REGISTRY) {
    const matched = entry.keywords.some(kw => hints.some(h => h.includes(kw) || kw.includes(h)))
    if (!matched) continue

    // Check if destination is an expected domain (or subdomain of one)
    const ok = entry.domains.some(d => dest === d || dest.endsWith('.' + d) || d.endsWith('.' + dest))

    return { matched: entry, expected: entry.domains, actual: dest, ok }
  }

  return null  // unknown API — can't judge
}
