#!/usr/bin/env node
/**
 * Pinterest helper for Clawd via Make.com webhooks
 *
 * Instead of direct Pinterest API (which requires approval),
 * this sends data to Make.com which handles Pinterest posting.
 *
 * Setup:
 *   1. Create Make.com account (free tier available)
 *   2. Create scenario: Webhook → Pinterest "Create a Pin"
 *   3. Copy the webhook URL
 *   4. Set in Railway: MAKE_PINTEREST_WEBHOOK_URL
 */

const https = require('https');
const http = require('http');

const MAKE_WEBHOOK_URL = process.env.MAKE_PINTEREST_WEBHOOK_URL;
const KOLAYXPORT_URL = process.env.KOLAYXPORT_API_URL || 'https://kolayxport.com/api/clawd';
const KOLAYXPORT_KEY = process.env.KOLAYXPORT_API_KEY;
const CLOUDINARY_CLOUD = process.env.CLOUDINARY_CLOUD_NAME || 'dhcwyis5i';

// Wrap image URL with Cloudinary proxy for Etsy images
function proxyImageUrl(url) {
  if (!url) return url;
  // Etsy images need Cloudinary proxy to be fetchable
  if (url.includes('etsystatic.com')) {
    return `https://res.cloudinary.com/${CLOUDINARY_CLOUD}/image/fetch/${url}`;
  }
  return url;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function sendToWebhook(data) {
  return new Promise((resolve, reject) => {
    if (!MAKE_WEBHOOK_URL) {
      reject(new Error('MAKE_PINTEREST_WEBHOOK_URL not set. Create a Make.com scenario first.'));
      return;
    }

    const url = new URL(MAKE_WEBHOOK_URL);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = client.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ success: true, status: res.statusCode, response: body });
        } else {
          reject(new Error(`Webhook error ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(JSON.stringify(data));
    req.end();
  });
}

function fetchEtsyListing(listingId) {
  // Call etsy.sh directly like we do for Shopify
  const { execSync } = require('child_process');
  const scriptPath = require('path').join(__dirname, 'etsy.sh');

  try {
    const output = execSync(`"${scriptPath}" listing ${listingId}`, { encoding: 'utf8' });
    const data = JSON.parse(output);

    // KolayXport returns listing data directly or in a .listing property
    if (data.listing) {
      return data.listing;
    }
    return data;
  } catch (e) {
    throw new Error(`Failed to fetch Etsy listing: ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────────
// Pin Creation
// ─────────────────────────────────────────────────────────────

async function createPin(pinData) {
  /*
   * Expected pinData format:
   * {
   *   title: "Pin title",
   *   description: "Pin description with hashtags",
   *   link: "https://destination-url.com",
   *   imageUrl: "https://image-url.com/image.jpg",
   *   board: "Board Name" (optional - can be set in Make.com)
   * }
   */

  const result = await sendToWebhook({
    action: 'create_pin',
    ...pinData,
    timestamp: new Date().toISOString()
  });

  return {
    sent: true,
    message: 'Pin data sent to Make.com webhook',
    data: pinData
  };
}

async function createPinFromEtsy(listingId, options = {}) {
  const listing = await fetchEtsyListing(listingId);

  // Get the best image
  const imageUrl = listing.images?.[0]?.url_fullxfull ||
                   listing.images?.[0]?.url_570xN ||
                   listing.image?.url_fullxfull;

  if (!imageUrl) {
    throw new Error('No image found for listing');
  }

  // Build Pinterest-optimized description
  const price = listing.price?.amount
    ? `$${(listing.price.amount / listing.price.divisor).toFixed(2)}`
    : '';

  // Extract relevant tags for hashtags
  const hashtags = (listing.tags || [])
    .slice(0, 5)
    .map(tag => `#${tag.replace(/\s+/g, '')}`)
    .join(' ');

  const description = options.description ||
    `${listing.title}\n\n${price ? `${price} ` : ''}Shop now on Etsy!\n\n${hashtags}`;

  const pinData = {
    title: options.title || listing.title?.substring(0, 100),
    description: description,
    link: listing.url || `https://www.etsy.com/listing/${listingId}`,
    imageUrl: proxyImageUrl(imageUrl),
    board: options.board || null,
    source: 'etsy',
    sourceId: listingId
  };

  return createPin(pinData);
}

async function createPinFromShopify(productId, options = {}) {
  // Fetch from Shopify via our shopify.cjs
  const { execSync } = require('child_process');
  const scriptPath = require('path').join(__dirname, 'shopify.cjs');

  let product;
  try {
    const output = execSync(`node "${scriptPath}" product ${productId}`, { encoding: 'utf8' });
    product = JSON.parse(output);
  } catch (e) {
    throw new Error(`Failed to fetch Shopify product: ${e.message}`);
  }

  const imageUrl = product.images?.[0]?.src;
  if (!imageUrl) {
    throw new Error('No image found for product');
  }

  // Build description
  const hashtags = (product.tags || '')
    .split(',')
    .slice(0, 5)
    .map(tag => `#${tag.trim().replace(/\s+/g, '')}`)
    .filter(t => t.length > 1)
    .join(' ');

  const price = product.variants?.[0]?.price ? `$${product.variants[0].price}` : '';

  const description = options.description ||
    `${product.title}\n\n${price ? `${price} ` : ''}Shop now!\n\n${hashtags}`;

  const pinData = {
    title: options.title || product.title?.substring(0, 100),
    description: description,
    link: product.url,
    imageUrl: imageUrl,
    board: options.board || null,
    source: 'shopify',
    sourceId: productId
  };

  return createPin(pinData);
}

async function schedulePins(pins) {
  /*
   * Send multiple pins to be scheduled
   * Make.com can handle scheduling logic
   */
  const results = [];

  for (const pin of pins) {
    try {
      const result = await sendToWebhook({
        action: 'schedule_pin',
        ...pin,
        timestamp: new Date().toISOString()
      });
      results.push({ success: true, pin: pin.title || pin.sourceId });
    } catch (e) {
      results.push({ success: false, pin: pin.title || pin.sourceId, error: e.message });
    }
  }

  return results;
}

async function testWebhook() {
  const testData = {
    action: 'test',
    message: 'Test from Clawd',
    timestamp: new Date().toISOString()
  };

  return sendToWebhook(testData);
}

// ─────────────────────────────────────────────────────────────
// Content Generation Helpers
// ─────────────────────────────────────────────────────────────

function generatePinDescription(title, tags = [], price = null, shopUrl = null) {
  const hashtags = tags
    .slice(0, 8)
    .map(tag => `#${tag.replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '')}`)
    .join(' ');

  let desc = title;
  if (price) desc += `\n\n${price}`;
  if (shopUrl) desc += `\n\nShop: ${shopUrl}`;
  if (hashtags) desc += `\n\n${hashtags}`;

  return desc;
}

function generateViralPinIdeas(productTitle, productType) {
  return [
    `${productTitle} - Perfect Gift Idea!`,
    `DIY Gift Inspiration: ${productTitle}`,
    `Gift Guide: Why ${productType} Makes the Perfect Present`,
    `${productTitle} | Handmade with Love`,
    `Trending: ${productType} Gift Ideas for 2026`
  ];
}

// ─────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === 'help') {
    console.log(`Pinterest Helper (via Make.com)

Usage: pinterest.sh <command> [options]

Setup:
  1. Go to make.com and create free account
  2. Create new scenario:
     - Trigger: Webhooks → Custom webhook
     - Action: Pinterest → Create a Pin
  3. Copy the webhook URL from the Webhooks module
  4. Set in Railway: MAKE_PINTEREST_WEBHOOK_URL=<your-webhook-url>
  5. In Make.com, map the incoming fields:
     - title → Pin title
     - description → Pin description
     - link → Destination URL
     - imageUrl → Image URL
     - board → Board name (or set fixed board)

Commands:
  status                     Check webhook configuration
  test                       Send test data to webhook

  create-pin                 Create pin (JSON from stdin)
  pin-from-etsy <id>         Create pin from Etsy listing
  pin-from-shopify <id>      Create pin from Shopify product

  generate-description       Generate optimized pin description (JSON stdin)
  viral-ideas <title> <type> Generate viral pin title ideas

Examples:
  # Test webhook connection
  pinterest.sh test

  # Create pin from Etsy listing
  pinterest.sh pin-from-etsy 1234567890

  # Create pin from Shopify product
  pinterest.sh pin-from-shopify 8765432109876

  # Custom pin
  echo '{"title":"My Pin","description":"Check this out!","link":"https://etsy.com/...","imageUrl":"https://..."}' | pinterest.sh create-pin

  # Generate description
  echo '{"title":"Gift Box","tags":["gift","handmade","custom"],"price":"$29.99"}' | pinterest.sh generate-description

Make.com Scenario Setup:
  1. Webhooks (Custom webhook) - receives data from Clawd
  2. Router (optional) - handle different actions
  3. Pinterest (Create a Pin) - posts to Pinterest

  Field mapping in Pinterest module:
  - Board: Select your board or use {{board}} from webhook
  - Title: {{title}}
  - Description: {{description}}
  - Destination link: {{link}}
  - Image URL: {{imageUrl}}
`);
    return;
  }

  try {
    let result;

    switch (command) {
      case 'status': {
        if (MAKE_WEBHOOK_URL) {
          console.log('Pinterest via Make.com: Configured');
          console.log(`Webhook URL: ${MAKE_WEBHOOK_URL.substring(0, 50)}...`);
        } else {
          console.log('Pinterest via Make.com: NOT CONFIGURED');
          console.log('\nSet MAKE_PINTEREST_WEBHOOK_URL in Railway variables.');
          console.log('See "pinterest.sh help" for setup instructions.');
        }
        return;
      }

      case 'test': {
        console.log('Sending test to Make.com webhook...');
        result = await testWebhook();
        console.log('Test successful! Webhook is working.');
        return;
      }

      case 'create-pin': {
        let input = '';
        for await (const chunk of process.stdin) input += chunk;
        const pinData = JSON.parse(input);
        result = await createPin(pinData);
        break;
      }

      case 'pin-from-etsy': {
        if (!args[0]) throw new Error('Etsy listing ID required');
        const options = {};
        for (let i = 1; i < args.length; i++) {
          if (args[i] === '--board' && args[i+1]) options.board = args[++i];
          if (args[i] === '--title' && args[i+1]) options.title = args[++i];
        }
        result = await createPinFromEtsy(args[0], options);
        break;
      }

      case 'pin-from-shopify': {
        if (!args[0]) throw new Error('Shopify product ID required');
        const options = {};
        for (let i = 1; i < args.length; i++) {
          if (args[i] === '--board' && args[i+1]) options.board = args[++i];
          if (args[i] === '--title' && args[i+1]) options.title = args[++i];
        }
        result = await createPinFromShopify(args[0], options);
        break;
      }

      case 'generate-description': {
        let input = '';
        for await (const chunk of process.stdin) input += chunk;
        const { title, tags, price, shopUrl } = JSON.parse(input);
        result = generatePinDescription(title, tags || [], price, shopUrl);
        console.log(result);
        return;
      }

      case 'viral-ideas': {
        if (!args[0]) throw new Error('Product title required');
        const title = args[0];
        const type = args[1] || 'product';
        result = generateViralPinIdeas(title, type);
        break;
      }

      case 'schedule': {
        let input = '';
        for await (const chunk of process.stdin) input += chunk;
        const pins = JSON.parse(input);
        result = await schedulePins(Array.isArray(pins) ? pins : [pins]);
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        console.error('Run "pinterest.sh help" for usage');
        process.exit(1);
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
