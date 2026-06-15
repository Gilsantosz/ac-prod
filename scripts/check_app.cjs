const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const consoleErrors = [];
  const networkErrors = [];
  
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  
  page.on('pageerror', err => {
    consoleErrors.push(`PAGE ERROR: ${err.message}`);
  });
  
  page.on('requestfailed', req => {
    networkErrors.push(`NETWORK FAIL: ${req.url()} — ${req.failure()?.errorText}`);
  });
  
  try {
    console.log('Navigating to app...');
    await page.goto('http://localhost:5173/ac-prod/', { waitUntil: 'networkidle', timeout: 15000 });
    
    const title = await page.title();
    console.log('Page title:', title);
    
    // Get visible text
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));
    console.log('Body text:', bodyText);
    
    // Check for root div content
    const rootHTML = await page.evaluate(() => document.getElementById('root')?.innerHTML?.slice(0, 1000));
    console.log('Root HTML:', rootHTML || '(empty)');
    
    if (consoleErrors.length > 0) {
      console.log('\n=== CONSOLE ERRORS ===');
      consoleErrors.forEach(e => console.log(e));
    } else {
      console.log('\nNo console errors.');
    }
    
    if (networkErrors.length > 0) {
      console.log('\n=== NETWORK ERRORS ===');
      networkErrors.forEach(e => console.log(e));
    }
    
    // Take screenshot
    await page.screenshot({ path: '/tmp/app_screenshot.png', fullPage: false });
    console.log('\nScreenshot saved to /tmp/app_screenshot.png');
    
  } catch (err) {
    console.error('Navigation error:', err.message);
    if (consoleErrors.length > 0) {
      console.log('\n=== CONSOLE ERRORS ===');
      consoleErrors.forEach(e => console.log(e));
    }
  }
  
  await browser.close();
})();
