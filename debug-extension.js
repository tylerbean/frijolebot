const puppeteer = require('puppeteer');
const path = require('path');

async function debugExtension() {
  const extensionPath = path.join(process.env.HOME, 'util', 'chrome-extension');
  console.log('Extension path:', extensionPath);

  // Launch browser with extension
  const browser = await puppeteer.launch({
    headless: false, // Keep visible for debugging
    devtools: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
    ]
  });

  const page = await browser.newPage();

  // Navigate to localhost:3000
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });

  // Listen for console messages
  page.on('console', msg => {
    console.log(`PAGE LOG (${msg.type()}):`, msg.text());
  });

  // Check if extension is loaded
  const extensions = await browser.targets().filter(target => target.type() === 'service_worker');
  console.log('Service workers found:', extensions.length);

  if (extensions.length > 0) {
    console.log('Extension service worker found');

    // Get the service worker page
    const extensionWorker = await extensions[0].worker();
    if (extensionWorker) {
      // Listen to extension console logs
      extensionWorker.on('console', msg => {
        console.log(`EXTENSION LOG (${msg.type()}):`, msg.text());
      });

      // Inject code to test server connection
      await extensionWorker.evaluate(async () => {
        console.log('Testing server connection from extension...');
        try {
          const response = await fetch('http://localhost:3025/.identity');
          const data = await response.json();
          console.log('Server identity response:', data);

          // Test validateServerIdentity function
          if (typeof validateServerIdentity === 'function') {
            const isValid = await validateServerIdentity('localhost', 3025);
            console.log('validateServerIdentity result:', isValid);
          } else {
            console.log('validateServerIdentity function not found');
          }
        } catch (error) {
          console.error('Server connection error:', error);
        }
      });
    }
  }

  // Keep the browser open for 30 seconds to observe
  await new Promise(resolve => setTimeout(resolve, 30000));

  await browser.close();
}

debugExtension().catch(console.error);