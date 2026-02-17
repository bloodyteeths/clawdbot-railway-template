#!/usr/bin/env node
/**
 * Browser automation helper for Clawd
 * Uses Puppeteer with system Chromium for headless browsing
 *
 * Usage: node browser-automation.js <action> [options]
 *
 * Actions:
 *   screenshot <url> <output>  - Take a screenshot of a URL
 *   pdf <url> <output>         - Save page as PDF
 *   fetch <url>                - Fetch page content as text
 *   canva-login                - Login to Canva (interactive)
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH ||
                      process.env.CHROME_PATH ||
                      '/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome' ||
                      '/usr/bin/chromium';

async function launchBrowser() {
  return puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });
}

async function screenshot(url, outputPath) {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.screenshot({ path: outputPath, fullPage: true });
    console.log(`Screenshot saved to: ${outputPath}`);
  } finally {
    await browser.close();
  }
}

async function savePdf(url, outputPath) {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.pdf({ path: outputPath, format: 'A4' });
    console.log(`PDF saved to: ${outputPath}`);
  } finally {
    await browser.close();
  }
}

async function fetchContent(url) {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    const content = await page.evaluate(() => {
      // Remove scripts and styles
      const scripts = document.querySelectorAll('script, style, noscript');
      scripts.forEach(s => s.remove());
      return document.body.innerText;
    });
    console.log(content);
  } finally {
    await browser.close();
  }
}

async function canvaLogin(email, password) {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // Go to Canva login
    await page.goto('https://www.canva.com/login', { waitUntil: 'networkidle2' });

    // Click "Continue with email"
    await page.waitForSelector('[data-testid="email-login-button"]', { timeout: 10000 });
    await page.click('[data-testid="email-login-button"]');

    // Enter email
    await page.waitForSelector('input[name="email"]');
    await page.type('input[name="email"]', email);
    await page.click('button[type="submit"]');

    // Enter password
    await page.waitForSelector('input[name="password"]', { timeout: 10000 });
    await page.type('input[name="password"]', password);
    await page.click('button[type="submit"]');

    // Wait for login to complete
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });

    // Save cookies for future sessions
    const cookies = await page.cookies();
    const cookiePath = path.join(process.env.HOME || '/tmp', '.canva-cookies.json');
    fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2));
    console.log(`Logged in successfully. Cookies saved to: ${cookiePath}`);

  } finally {
    await browser.close();
  }
}

async function main() {
  const [,, action, ...args] = process.argv;

  switch (action) {
    case 'screenshot':
      if (args.length < 2) {
        console.error('Usage: screenshot <url> <output-path>');
        process.exit(1);
      }
      await screenshot(args[0], args[1]);
      break;

    case 'pdf':
      if (args.length < 2) {
        console.error('Usage: pdf <url> <output-path>');
        process.exit(1);
      }
      await savePdf(args[0], args[1]);
      break;

    case 'fetch':
      if (args.length < 1) {
        console.error('Usage: fetch <url>');
        process.exit(1);
      }
      await fetchContent(args[0]);
      break;

    case 'canva-login':
      const email = process.env.CANVA_EMAIL || args[0];
      const password = process.env.CANVA_PASSWORD || args[1];
      if (!email || !password) {
        console.error('Usage: canva-login <email> <password>');
        console.error('Or set CANVA_EMAIL and CANVA_PASSWORD environment variables');
        process.exit(1);
      }
      await canvaLogin(email, password);
      break;

    default:
      console.log(`
Browser Automation Helper for Clawd

Usage: node browser-automation.js <action> [options]

Actions:
  screenshot <url> <output>  - Take a screenshot of a URL
  pdf <url> <output>         - Save page as PDF
  fetch <url>                - Fetch page content as text
  canva-login <email> <pass> - Login to Canva

Environment variables:
  CANVA_EMAIL    - Canva account email
  CANVA_PASSWORD - Canva account password
`);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
