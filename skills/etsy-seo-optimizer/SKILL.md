---
description: "Etsy SEO optimization engine for BelleCoutureGifts — title formulas, tag strategy, description framework, listing audits"
activation: "optimize, seo, tags, title, keywords, optimize listing, improve listing, listing audit, etsy seo, ranking, search ranking, low views, no views, underperforming"
tools: ["/app/scripts/etsy.sh", "node /app/scripts/erank.cjs"]
---

# Etsy SEO Optimizer — BelleCoutureGifts

Complete SEO optimization system for Etsy listings. Use this when asked to optimize, audit, or improve a listing's search performance.

## How Etsy Search Works

Etsy search ranks listings by **query matching** (does the listing match the search?) and **listing quality** (how well does it perform?).

**Query matching factors:**
- Tags (most important — exact match preferred)
- Title (matched left-to-right, front-loaded keywords rank higher)
- Categories/attributes
- Description (minor factor, but affects Google SEO)

**Quality factors:**
- Recency (new/renewed listings get a temporary boost)
- Conversion rate (views → purchases)
- Listing completeness (all 13 tags, 10 images, video, alt text)
- Shop quality (reviews, ship-on-time rate, response time)
- Favorites and engagement

## Title Formula (140 chars max)

**Structure:**
```
[Primary Keyword] [Product Type], [Secondary Keyword] [Variation], [Occasion/Use Case] [Differentiator]
```

**Rules:**
1. **Front-load the highest-volume keyword** — Etsy weighs the first words most
2. **Use natural phrases, not keyword stuffing** — "Baby Girl Birthday Dress" not "Baby Dress Girl Birthday Dress Baby"
3. **Include 2-3 long-tail phrases** — these are easier to rank for
4. **Add occasion/use case** — "for First Birthday", "Graduation Gift"
5. **End with differentiator** — "Handmade", "Personalized", "with Name"
6. **Separate phrases with commas or dashes** — helps Etsy parse distinct keyword groups
7. **Never repeat the same word more than twice** — diminishing returns, wastes space
8. **Use all 140 characters** — every unused character is wasted ranking opportunity

**Example (gift box):**
```
Personalized Gift Box for Her, Spa Self Care Birthday Box, Pamper Gift Set for Women, Thank You Gift with Custom Name
```

**Example (baby outfit):**
```
Baby Girl First Birthday Outfit, Pink Tutu Dress for 1st Birthday Party, Toddler Cake Smash Dress, Personalized with Name
```

## Tag Strategy (13 tags, 20 chars each max)

**You MUST use all 13 tag slots. Every empty slot is lost visibility.**

### Tag Hierarchy

| Priority | Slots | What | Example |
|----------|-------|------|---------|
| Tier 1: Primary | 1-3 | Highest-volume exact-match keywords | "gift box for her", "birthday gift box" |
| Tier 2: Long-tail | 4-7 | Specific multi-word phrases that convert | "spa gift set women", "self care box" |
| Tier 3: Occasion | 8-10 | When/why someone buys | "mothers day gift", "thank you gift" |
| Tier 4: Attribute | 11-13 | Color, style, material, feature | "personalized gift", "handmade gift box" |

### Tag Rules

1. **Tags should be multi-word phrases** — "gift box for her" beats "gift" and "box" separately
2. **Don't repeat words from the title exactly** — tags ADD search reach, duplicating wastes slots
3. **Use synonyms and alternate phrasings** — if title says "gift box", tags should include "gift set", "care package", "gift basket"
4. **Include seasonal tags when relevant** — rotate quarterly (spring, summer, fall, holiday)
5. **Use eRank to validate** — check search volume before committing tags
6. **Never use single-word tags** — too competitive, too vague
7. **Don't use brand names or trademarked terms** — Etsy penalizes this
8. **Match buyer language** — "gift for mom" not "maternal present"
9. **Include at least one long-tail phrase (4+ words)** — lower competition, higher conversion

### Tag Research Workflow

```bash
# 1. Research primary keyword
node /app/scripts/erank.cjs keyword "gift box for her"

# 2. Check trending keywords in your niche
node /app/scripts/erank.cjs trending

# 3. Analyze competitor's tags
node /app/scripts/erank.cjs analyze "https://www.etsy.com/listing/COMPETITOR_ID"

# 4. Check top sellers in category
node /app/scripts/erank.cjs top-sellers "gift boxes"
```

## Description Framework (SEO + Conversion)

Etsy descriptions have minimal impact on Etsy search but MAJOR impact on Google SEO. A well-structured description also converts browsers into buyers.

### Structure (6 parts)

```
[1. Hook — 1-2 sentences, primary keyword, emotional appeal]

[2. Product Details — what's included, materials, dimensions]

[3. Personalization Instructions — if applicable, be very specific]

[4. Occasion Suggestions — when/why to buy this]

[5. Shipping & Processing — set expectations]

[6. Shop Note — cross-sell, review request, care instructions]
```

### Description Rules

1. **First 160 characters are critical** — this shows in Google search results and Etsy preview
2. **Front-load the primary keyword** in the first sentence
3. **Use natural paragraphs** — not walls of keywords
4. **Include secondary keywords naturally** throughout
5. **Bullet points for product details** — easier to scan
6. **Include personalization instructions inline** — reduces buyer questions
7. **Call out what makes it special** — handmade, materials, process
8. **End with a gentle CTA** — "Add to cart", "Order now for [occasion]"

## Image Alt Text Strategy

Alt text affects both Etsy search and Google Image search. You can set alt text via:

```bash
etsy.sh upload-image <listing_id> <image_url> <rank> "descriptive alt text here"
```

### Alt Text Rules

1. **Describe what's IN the image** — "Pink tutu dress on toddler girl with gold headband"
2. **Include the primary keyword naturally** — "Personalized gift box for her with spa items"
3. **Each image gets a unique alt text** — don't copy-paste the same text
4. **Keep it under 250 characters** — concise but descriptive
5. **Don't keyword stuff** — write for humans who can't see the image
6. **Mention colors, materials, size context** — "Rose gold jewelry box, 8x6 inches, velvet lined"

## Listing Audit Checklist

When optimizing a listing, check ALL of these:

```
[ ] Title uses all 140 characters
[ ] Title front-loads highest-volume keyword
[ ] Title contains 2-3 distinct keyword phrases
[ ] All 13 tag slots used
[ ] Tags use multi-word phrases (no single words)
[ ] Tags don't duplicate title words unnecessarily
[ ] Tags include seasonal/occasion keywords
[ ] Tags validated with eRank for search volume
[ ] Description front-loads primary keyword in first sentence
[ ] Description includes product details with bullet points
[ ] Description has personalization instructions (if applicable)
[ ] All 10 image slots used (or maximum relevant images)
[ ] Primary image is clean, well-lit, on white/neutral background
[ ] Image alt text set for all images with keywords
[ ] Video uploaded (if available — huge ranking boost)
[ ] Materials field populated
[ ] Correct category/taxonomy selected
[ ] Personalization enabled (if product supports it)
[ ] Price is competitive (check top 5 competitors)
```

## Optimization Workflow (Step by Step)

### 1. Pull Current Listing Data
```bash
etsy.sh listing <listing_id>
```
Note: title, tags, description, views, favorites, materials, price.

### 2. Research Keywords
```bash
node /app/scripts/erank.cjs keyword "<main product keyword>"
node /app/scripts/erank.cjs keyword "<alternate keyword>"
```

### 3. Audit Current SEO via eRank
```bash
node /app/scripts/erank.cjs analyze "https://www.etsy.com/listing/<listing_id>"
```

### 4. Check Competitors
```bash
node /app/scripts/erank.cjs top-sellers "<product category>"
```

### 5. Build Optimized Title
Apply the title formula. Front-load highest-volume keyword from eRank research.

### 6. Build Optimized Tags (all 13)
Follow the tag hierarchy. Mix in trending keywords. Never waste a slot on single words.

### 7. Rewrite Description
Follow the 6-part framework. Front-load primary keyword.

### 8. Apply Changes
```bash
echo '{
  "title": "Optimized Title Here...",
  "tags": ["tag one", "tag two", "tag three", "tag four", "tag five", "tag six", "tag seven", "tag eight", "tag nine", "tag ten", "tag eleven", "tag twelve", "tag thirteen"],
  "description": "Optimized description..."
}' | etsy.sh update <listing_id>
```

### 9. Verify
```bash
etsy.sh listing <listing_id>
```
Confirm all changes applied. Check tag count = 13, title length near 140.

### 10. Report to User
Show before/after comparison:
- Old title vs new title
- Tags added/removed/changed
- Description changes
- What to expect (increased visibility within 24-48 hours)

## Performance Benchmarks

| Metric | Poor | Okay | Good | Great |
|--------|------|------|------|-------|
| Views (7 days) | <10 | 10-50 | 50-200 | 200+ |
| Favorites (7 days) | 0 | 1-3 | 3-10 | 10+ |
| Conversion rate | <1% | 1-2% | 2-4% | 4%+ |
| Tags used | <10 | 10-12 | 13 | 13 |
| Title length | <80 | 80-110 | 110-130 | 130-140 |

## Seasonal Calendar

Optimize tags for upcoming seasons/events. Rotate tags 4-6 weeks BEFORE the event.

| Month | Events to Target |
|-------|-----------------|
| Jan-Feb | Valentine's Day, Winter clearance |
| Mar-Apr | Mother's Day (prep starts March!), Easter, Spring |
| May-Jun | Graduation, Father's Day, Wedding season |
| Jul-Aug | Back to school, Summer |
| Sep-Oct | Halloween, Fall, Thanksgiving prep |
| Nov-Dec | Black Friday, Christmas, Hanukkah, New Year |

## Common Mistakes

1. **Single-word tags** — "gift" alone competes with millions. Use "gift box for her" instead.
2. **Duplicate words across title and tags** — wastes ranking slots. Use synonyms in tags.
3. **Ignoring seasonal rotation** — same tags year-round misses seasonal traffic spikes.
4. **Short titles** — leaving 60+ unused characters is throwing away rankings.
5. **Generic descriptions** — "Beautiful handmade product" tells Etsy nothing. Be specific.
6. **No alt text on images** — free SEO left on the table.
7. **Less than 10 images** — Etsy favors complete listings.
8. **No video** — listings with video get 2-3x more views on average.
9. **Wrong category** — misfiled listings don't show in category browsing.
10. **Ignoring materials field** — another signal Etsy uses for search matching.
