#!/usr/bin/env node
/**
 * Clawd Idea Machine - Proactive E-commerce Insights Generator
 *
 * Automatically analyzes data and generates actionable ideas for:
 * - Etsy (BelleCoutureGifts)
 * - Trendyol (via KolayXport)
 *
 * Runs daily and sends insights to team via Slack/WhatsApp/Telegram
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const INSIGHTS_LOG = '/data/workspace/idea-machine-log.json';

// Helper to run commands and get output
function run(cmd) {
    try {
        return execSync(cmd, { encoding: 'utf8', timeout: 60000 }).trim();
    } catch (e) {
        return null;
    }
}

// Helper to call APIs
async function fetchJson(url) {
    try {
        const response = await fetch(url);
        return await response.json();
    } catch (e) {
        return null;
    }
}

// Get Etsy listings data
async function getEtsyInsights() {
    const insights = [];
    let allListings = [];
    const apiKey = process.env.KOLAYXPORT_API_KEY;
    const apiUrl = process.env.KOLAYXPORT_API_URL || 'https://kolayxport.com/api/clawd';

    if (!apiKey) return { insights, listings: allListings };

    try {
        // Get listings
        const listingsRes = await fetchJson(`${apiUrl}/etsy?apiKey=${apiKey}&action=listings&limit=50`);

        if (listingsRes?.listings) {
            const listings = listingsRes.listings;
            allListings = listings;

            // Find low-performing listings (low views, low favorites)
            const lowPerformers = listings.filter(l => l.views < 10 && l.num_favorers < 2);
            if (lowPerformers.length > 0) {
                insights.push({
                    type: 'optimization',
                    priority: 'high',
                    title: `${lowPerformers.length} listings need SEO optimization`,
                    details: `These listings have very low views/favorites. Consider updating titles, tags, and photos.`,
                    listings: lowPerformers.slice(0, 5).map(l => ({ id: l.listing_id, title: l.title.substring(0, 50) })),
                    action: 'Review and optimize these listings with better keywords and photos'
                });
            }

            // Find listings with few tags
            const fewTags = listings.filter(l => l.tags && l.tags.length < 10);
            if (fewTags.length > 0) {
                insights.push({
                    type: 'seo',
                    priority: 'medium',
                    title: `${fewTags.length} listings have less than 10 tags`,
                    details: 'Etsy allows 13 tags. Using all 13 improves discoverability.',
                    action: 'Add more relevant tags to maximize SEO'
                });
            }

            // Find high performers to duplicate
            const highPerformers = listings.filter(l => l.views > 100 || l.num_favorers > 10);
            if (highPerformers.length > 0) {
                insights.push({
                    type: 'opportunity',
                    priority: 'high',
                    title: `${highPerformers.length} top performers - create variations!`,
                    details: 'These listings are doing well. Consider creating color/style variations.',
                    listings: highPerformers.slice(0, 3).map(l => ({ id: l.listing_id, title: l.title.substring(0, 50), views: l.views, favorites: l.num_favorers })),
                    action: 'Copy these listings and create variations (different colors, sizes, themes)'
                });
            }

            // Check for seasonal opportunities
            const now = new Date();
            const month = now.getMonth();
            const seasonalIdeas = getSeasonalIdeas(month);
            if (seasonalIdeas) {
                insights.push(seasonalIdeas);
            }
        }

        // Get recent orders for patterns
        const ordersRes = await fetchJson(`${apiUrl}/etsy?apiKey=${apiKey}&action=receipts&limit=20`);
        if (ordersRes && Array.isArray(ordersRes) && ordersRes.length > 0) {
            // Analyze order patterns
            const recentDays = 7;
            const recentOrders = ordersRes.filter(o => {
                const orderDate = new Date(o.order_date);
                const daysDiff = (now - orderDate) / (1000 * 60 * 60 * 24);
                return daysDiff <= recentDays;
            });

            if (recentOrders.length >= 3) {
                insights.push({
                    type: 'momentum',
                    priority: 'info',
                    title: `Great momentum! ${recentOrders.length} orders in last ${recentDays} days`,
                    details: 'Sales are going well. Consider increasing ad spend or adding new listings.',
                    action: 'Ride the wave - add more listings or boost ads'
                });
            } else if (recentOrders.length === 0) {
                insights.push({
                    type: 'alert',
                    priority: 'high',
                    title: 'No orders in the last week',
                    details: 'Sales have slowed down. Time to take action!',
                    action: 'Run a sale, refresh listings, or try new keywords'
                });
            }
        }

    } catch (e) {
        console.error('Etsy insights error:', e.message);
    }

    return { insights, listings: allListings };
}

// Get Pinterest insights and suggestions
async function getPinterestInsights(etsyListings) {
    const insights = [];
    const apiKey = process.env.KOLAYXPORT_API_KEY;
    const apiUrl = process.env.KOLAYXPORT_API_URL || 'https://kolayxport.com/api/clawd';

    if (!apiKey) return insights;

    try {
        // Check if Pinterest is connected
        const boardsRes = await fetchJson(`${apiUrl}/pinterest?apiKey=${apiKey}&action=boards`);

        if (boardsRes?.boards) {
            // Pinterest is connected - suggest daily pins
            const topListings = etsyListings
                ?.filter(l => l.views > 50 || l.num_favorers > 5)
                ?.slice(0, 5) || [];

            if (topListings.length > 0) {
                insights.push({
                    type: 'pinterest',
                    priority: 'high',
                    title: `📌 Create ${Math.min(3, topListings.length)} Pinterest pins today`,
                    details: `Top listings to pin:\n${topListings.slice(0, 3).map(l => `• ${l.title.substring(0, 40)}...`).join('\n')}`,
                    listings: topListings.slice(0, 3).map(l => ({ id: l.listing_id, title: l.title.substring(0, 50) })),
                    action: 'Use: pinterest.sh pin-from-etsy <listing_id> to create pins'
                });
            }

            // Suggest Pinterest content strategy
            const now = new Date();
            const dayOfWeek = now.getDay();

            // Different content types for different days
            const contentStrategies = {
                0: { type: 'Gift Guide', tip: 'Sunday: Create a "Top 5 Gifts" pin collage' },
                1: { type: 'Motivation', tip: 'Monday: "Self-care starts with..." lifestyle pin' },
                2: { type: 'Tutorial', tip: 'Tuesday: "How to wrap the perfect gift" content' },
                3: { type: 'Product Focus', tip: 'Wednesday: Feature best-seller with text overlay' },
                4: { type: 'Behind-the-scenes', tip: 'Thursday: Show gift box assembly process' },
                5: { type: 'Inspiration', tip: 'Friday: "Weekend treat yourself" theme' },
                6: { type: 'Seasonal', tip: 'Saturday: Create seasonal/holiday themed pins' }
            };

            const todayStrategy = contentStrategies[dayOfWeek];
            insights.push({
                type: 'pinterest_content',
                priority: 'medium',
                title: `Pinterest Content: ${todayStrategy.type}`,
                details: todayStrategy.tip,
                action: 'Create engaging visual content to drive traffic from Pinterest'
            });

            // Check for underutilized boards
            const emptyBoards = boardsRes.boards.filter(b => (b.pin_count || 0) < 5);
            if (emptyBoards.length > 0) {
                insights.push({
                    type: 'pinterest_optimization',
                    priority: 'medium',
                    title: `${emptyBoards.length} Pinterest boards need more pins`,
                    details: `Boards with <5 pins: ${emptyBoards.map(b => b.name).slice(0, 3).join(', ')}`,
                    action: 'Fill these boards to improve Pinterest SEO'
                });
            }
        } else if (boardsRes?.error?.includes('not connected') || boardsRes?.error?.includes('unauthorized')) {
            // Pinterest not connected - suggest setting it up
            insights.push({
                type: 'pinterest_setup',
                priority: 'high',
                title: '📌 Connect Pinterest for more traffic!',
                details: 'Pinterest drives huge traffic to Etsy. Visual platform = perfect for gift products.',
                action: 'Connect Pinterest via KolayXport to start automated pinning'
            });
        }
    } catch (e) {
        // Pinterest may not be set up yet - add as suggestion
        insights.push({
            type: 'pinterest_suggestion',
            priority: 'idea',
            title: '📌 Pinterest = Free Traffic Source',
            details: 'Pinterest is a visual search engine. Product pins drive buyers directly to Etsy.',
            action: 'Set up Pinterest Business account and connect to Clawd'
        });
    }

    return insights;
}

// Get Trendyol insights
    const insights = [];
    const apiKey = process.env.KOLAYXPORT_API_KEY;
    const apiUrl = process.env.KOLAYXPORT_API_URL || 'https://kolayxport.com/api/clawd';

    if (!apiKey) return insights;

    try {
        const ordersRes = await fetchJson(`${apiUrl}/orders?apiKey=${apiKey}&limit=20`);

        if (Array.isArray(ordersRes) && ordersRes.length > 0) {
            // Check for orders stuck in "Picking" status
            const pickingOrders = ordersRes.filter(o => o.status === 'Picking');
            if (pickingOrders.length > 2) {
                insights.push({
                    type: 'operations',
                    priority: 'high',
                    title: `${pickingOrders.length} Trendyol orders waiting to ship`,
                    details: 'Orders in "Picking" status need to be shipped soon.',
                    action: 'Ship these orders today to maintain good seller rating'
                });
            }

            // Analyze bestsellers
            const productCounts = {};
            ordersRes.forEach(order => {
                order.items?.forEach(item => {
                    const name = item.productName || 'Unknown';
                    productCounts[name] = (productCounts[name] || 0) + item.quantity;
                });
            });

            const topProducts = Object.entries(productCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3);

            if (topProducts.length > 0) {
                insights.push({
                    type: 'bestseller',
                    priority: 'info',
                    title: 'Top selling products on Trendyol',
                    details: topProducts.map(([name, qty]) => `${name}: ${qty} sold`).join('\n'),
                    action: 'Ensure these items are well-stocked and consider featuring them'
                });
            }
        }
    } catch (e) {
        console.error('Trendyol insights error:', e.message);
    }

    return insights;
}

// Seasonal/holiday ideas
function getSeasonalIdeas(month) {
    const seasons = {
        0: { event: "Valentine's Day", tip: "Valentine's gift boxes should be featured NOW! Peak shopping is 2 weeks before." },
        1: { event: "Valentine's Day", tip: "Last chance for Valentine's orders! Push gift boxes hard." },
        2: { event: "Mother's Day prep", tip: "Start promoting Mother's Day gifts - shoppers plan early!" },
        3: { event: "Mother's Day", tip: "Mother's Day is coming! Feature pamper boxes and personalized gifts." },
        4: { event: "Mother's Day + Graduation", tip: "Last push for Mother's Day + start graduation gift promotions." },
        5: { event: "Summer Wedding Season", tip: "Wedding season! Promote bridesmaid gifts and bridal party boxes." },
        6: { event: "Summer Sales", tip: "Mid-year sale time. Consider clearance on slow movers." },
        7: { event: "Back to School", tip: "Teachers gifts and college care packages can sell well." },
        8: { event: "Fall Season Start", tip: "Start planning Halloween and fall-themed products." },
        9: { event: "Halloween + Holiday Prep", tip: "Halloween items + start holiday gift box prep!" },
        10: { event: "Black Friday/Holiday", tip: "CRITICAL: Black Friday & Cyber Monday! Run promotions and ensure stock." },
        11: { event: "Christmas Rush", tip: "Peak holiday season! Shipping cutoffs matter - communicate clearly." }
    };

    const current = seasons[month];
    if (current) {
        return {
            type: 'seasonal',
            priority: 'high',
            title: `Seasonal Opportunity: ${current.event}`,
            details: current.tip,
            action: 'Create or promote seasonal listings aligned with this event'
        };
    }
    return null;
}

// Generate random creative ideas
function getCreativeIdeas() {
    const ideas = [
        {
            type: 'product',
            title: 'Bundle Deal Idea',
            details: 'Create a "Build Your Own Gift Box" listing where customers choose items.',
            action: 'Higher perceived value = higher prices and customer satisfaction'
        },
        {
            type: 'marketing',
            title: 'User Generated Content',
            details: 'Reach out to recent customers for photos/reviews. Offer 10% off next order.',
            action: 'UGC builds trust and provides free marketing content'
        },
        {
            type: 'product',
            title: 'Subscription Box Idea',
            details: 'Monthly self-care subscription box could create recurring revenue.',
            action: 'Test with existing customers first - gauge interest'
        },
        {
            type: 'optimization',
            title: 'A/B Test Listing Photos',
            details: 'Try lifestyle photos vs white background. See which converts better.',
            action: 'Small changes in photos can dramatically improve conversion'
        },
        {
            type: 'marketing',
            title: 'Collaborate with Influencers',
            details: 'Micro-influencers (5-20k followers) often accept free products for posts.',
            action: 'Find gift/lifestyle influencers and send PR packages'
        },
        {
            type: 'pricing',
            title: 'Price Psychology',
            details: 'Try $29.99 instead of $30, or bundle at $49.99 instead of individual items.',
            action: 'Small pricing tweaks can increase conversions significantly'
        },
        {
            type: 'product',
            title: 'Corporate Gift Market',
            details: 'Companies buy bulk gifts for employees/clients. Create wholesale listings.',
            action: 'Add "Corporate Orders Welcome" to descriptions'
        },
        {
            type: 'seo',
            title: 'Video Listings Convert Better',
            details: 'Listings with videos get 40% more views on Etsy.',
            action: 'Add short product videos to top 5 listings'
        },
        {
            type: 'pinterest',
            title: 'Pinterest Viral Pin Strategy',
            details: 'Long pins (1000x1500) with text overlay get 80% more saves.',
            action: 'Create "Top 10 Gift Ideas" or "Gift Guide" format pins'
        },
        {
            type: 'pinterest',
            title: 'Pinterest SEO Hack',
            details: 'Pinterest is a search engine. Use keywords in pin titles and descriptions.',
            action: 'Add keywords like "personalized gift box for her valentines day" to pin descriptions'
        },
        {
            type: 'pinterest',
            title: 'Pinterest Seasonal Boards',
            details: 'Create seasonal boards: "Valentine Gifts", "Mother Day Ideas", "Wedding Gifts"',
            action: 'Seasonal boards rank well and attract buyers during peak times'
        },
        {
            type: 'pinterest',
            title: 'Pinterest Rich Pins',
            details: 'Enable Rich Pins to automatically sync Etsy product info to Pinterest.',
            action: 'Rich Pins show real-time pricing and availability'
        },
        {
            type: 'retention',
            title: 'Thank You Card Upsell',
            details: 'Include discount code in package for repeat customers.',
            action: 'Print cards with "15% off your next order" QR code'
        }
    ];

    // Return 2 random ideas
    const shuffled = ideas.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 2).map(idea => ({
        ...idea,
        priority: 'idea'
    }));
}

// Format insights for messaging
function formatInsightsMessage(insights) {
    if (insights.length === 0) {
        return "All systems running smoothly! No urgent actions needed today.";
    }

    const priorityEmoji = {
        high: '🔴',
        medium: '🟡',
        info: '🔵',
        idea: '💡'
    };

    let message = `🤖 *Clawd's Daily E-commerce Insights*\n`;
    message += `📅 ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}\n\n`;

    // Group by priority
    const highPriority = insights.filter(i => i.priority === 'high');
    const others = insights.filter(i => i.priority !== 'high');

    if (highPriority.length > 0) {
        message += `*🚨 ACTION NEEDED:*\n`;
        highPriority.forEach(insight => {
            message += `\n${priorityEmoji[insight.priority]} *${insight.title}*\n`;
            message += `${insight.details}\n`;
            message += `➡️ _${insight.action}_\n`;
        });
    }

    if (others.length > 0) {
        message += `\n*📊 INSIGHTS & IDEAS:*\n`;
        others.forEach(insight => {
            message += `\n${priorityEmoji[insight.priority] || '💡'} *${insight.title}*\n`;
            message += `${insight.details}\n`;
            if (insight.action) message += `➡️ _${insight.action}_\n`;
        });
    }

    message += `\n---\nReply with questions or "analyze [keyword]" for deeper research!`;

    return message;
}

// Save insights log
function saveInsightsLog(insights) {
    let log = [];
    if (fs.existsSync(INSIGHTS_LOG)) {
        try {
            log = JSON.parse(fs.readFileSync(INSIGHTS_LOG, 'utf8'));
        } catch (e) {}
    }

    log.push({
        date: new Date().toISOString(),
        insights: insights
    });

    // Keep last 30 days
    log = log.slice(-30);

    fs.mkdirSync(path.dirname(INSIGHTS_LOG), { recursive: true });
    fs.writeFileSync(INSIGHTS_LOG, JSON.stringify(log, null, 2));
}

// Main function
async function main() {
    console.log('🤖 Clawd Idea Machine starting...\n');

    const allInsights = [];

    // Gather insights from all sources
    console.log('📊 Analyzing Etsy data...');
    const { insights: etsyInsights, listings: etsyListings } = await getEtsyInsights();
    allInsights.push(...etsyInsights);

    console.log('📌 Analyzing Pinterest opportunities...');
    const pinterestInsights = await getPinterestInsights(etsyListings);
    allInsights.push(...pinterestInsights);

    console.log('📊 Analyzing Trendyol data...');
    const trendyolInsights = await getTrendyolInsights();
    allInsights.push(...trendyolInsights);

    console.log('💡 Generating creative ideas...');
    const creativeIdeas = getCreativeIdeas();
    allInsights.push(...creativeIdeas);

    // Format message
    const message = formatInsightsMessage(allInsights);

    // Save log
    saveInsightsLog(allInsights);

    // Output
    console.log('\n' + '='.repeat(50));
    console.log(message);
    console.log('='.repeat(50) + '\n');

    // Output as JSON for parsing
    console.log('\n__JSON_OUTPUT__');
    console.log(JSON.stringify({
        insights: allInsights,
        message: message,
        timestamp: new Date().toISOString()
    }));

    return { insights: allInsights, message };
}

main().catch(console.error);
