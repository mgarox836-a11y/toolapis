import { chromium, devices } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

const PORT = 8765;
const SHOTS_DIR = '/tmp/shots/intro-scroll';
fs.mkdirSync(SHOTS_DIR, { recursive: true });

// Simple HTTP server
const server = http.createServer((req, res) => {
  let filePath = path.join(ROOT, req.url === '/' ? 'index.html' : req.url);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
      '.mjs': 'application/javascript', '.svg': 'image/svg+xml',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
    };
    res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
    res.end(data);
  });
});

await new Promise((resolve) => server.listen(PORT, resolve));
console.log(`Server running on http://localhost:${PORT}`);

const scenarios = [
  { name: 'wheel', action: async (page) => { await page.mouse.wheel(0, 800); await page.mouse.wheel(0, 800); } },
  { name: 'space', action: async (page) => { await page.keyboard.press('Space'); } },
  { name: 'pageDown', action: async (page) => { await page.keyboard.press('PageDown'); } },
  { name: 'arrowDown', action: async (page) => { await page.keyboard.press('ArrowDown'); } },
  { name: 'end', action: async (page) => { await page.keyboard.press('End'); } },
  { name: 'scrollTo', action: async (page) => { await page.evaluate(() => window.scrollTo(0, 900)); } },
];

const timings = [200, 1000, 2500, 4000];

async function runScenario(browser, scenario, timing, isMobile) {
  const context = await browser.newContext({
    ...(isMobile ? devices['iPhone 13'] : {}),
    viewport: isMobile ? { width: 390, height: 844 } : { width: 1366, height: 530 },
    isMobile,
    hasTouch: isMobile,
  });
  const page = await context.newPage();
  
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));
  
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded' });
  
  await page.waitForFunction(() => document.documentElement.classList.contains('intro-active'), { timeout: 3000 });
  
  await page.waitForTimeout(timing);
  
  await scenario.action(page);
  
  await page.waitForFunction(() => {
    const intro = document.getElementById('intro-overlay');
    return document.documentElement.classList.contains('intro-done') || !intro || !intro.parentNode;
  }, { timeout: 10000 });
  
  await page.waitForTimeout(1500);
  
  const diag = await page.evaluate(() => {
    const intro = document.querySelector('#intro-overlay');
    const transition = document.querySelector('#page-transition');
    const centerEl = document.elementFromPoint(innerWidth/2, innerHeight/2);
    const hiddenInView = [...document.querySelectorAll('[class*="reveal"], [data-reveal], h1, h2, p, .card, .bento > *')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < innerHeight && parseFloat(getComputedStyle(el).opacity) < 0.05;
    }).length;
    return {
      scrollY: window.scrollY,
      htmlClass: document.documentElement.className,
      htmlOverflow: getComputedStyle(document.documentElement).overflow,
      bodyOverflow: getComputedStyle(document.body).overflow,
      introPresent: !!document.querySelector('#intro-overlay'),
      introDisplay: document.querySelector('#intro-overlay') ? getComputedStyle(document.querySelector('#intro-overlay')).display : 'none',
      transitionOpacity: transition ? getComputedStyle(transition).opacity : 'none',
      centerEl: centerEl ? (centerEl.tagName + '#' + centerEl.id + '.' + String(centerEl.className).slice(0,40)) : 'none',
      hiddenInView,
    };
  });
  
  diag.errors = errors;
  
  const shotName = `${isMobile ? 'mobile' : 'desktop'}-${scenario.name}-t${timing}.png`;
  await page.screenshot({ path: path.join(SHOTS_DIR, shotName), fullPage: false });
  
  await context.close();
  return { scenario: scenario.name, timing, isMobile, diag, shot: shotName };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  
  for (const isMobile of [false, true]) {
    for (const scenario of scenarios) {
      for (const timing of timings) {
        console.log(`Testing: ${isMobile ? 'mobile' : 'desktop'} ${scenario.name} t=${timing}ms`);
        try {
          const result = await runScenario(browser, scenario, timing, isMobile);
          results.push(result);
          console.log(`  scrollY=${result.diag.scrollY}, hiddenInView=${result.diag.hiddenInView}, introPresent=${result.diag.introPresent}, centerEl=${result.diag.centerEl}`);
        } catch (e) {
          console.error(`  FAILED: ${e.message}`);
          results.push({ scenario: scenario.name, timing, isMobile, error: e.message });
        }
      }
    }
  }
  
  await browser.close();
  server.close();
  
  fs.writeFileSync(path.join(SHOTS_DIR, 'results.json'), JSON.stringify(results, null, 2));
  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    if (r.error) {
      console.log(`${r.isMobile ? 'mobile' : 'desktop'} ${r.scenario} t=${r.timing}: ERROR - ${r.error}`);
    } else {
      const blank = r.diag.hiddenInView > 0 || r.diag.introPresent || r.diag.transitionOpacity > 0.1 || r.diag.centerEl?.includes('intro') || r.diag.centerEl?.includes('transition');
      console.log(`${r.isMobile ? 'mobile' : 'desktop'} ${r.scenario} t=${r.timing}: blank=${blank} (hiddenInView=${r.diag.hiddenInView}, introPresent=${r.diag.introPresent}, transOpacity=${r.diag.transitionOpacity}, centerEl=${r.diag.centerEl})`);
    }
  }
}

main().catch(console.error);
