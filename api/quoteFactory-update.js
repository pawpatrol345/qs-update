// sample quotefactory update code - simplified version with retry logic

import puppeteer from 'puppeteer-core';

class QuikSkopeAutomation {
  constructor() {
    this.browser = null;
    this.page = null;
    this.MAX_LOGIN_RETRIES = 3;
    this.LOGIN_RETRY_DELAY = 2000;
    this.MAX_SEARCH_RETRIES = 3;
    this.SEARCH_RETRY_DELAY = 2000;
  }

  async wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  extractLoadReference(text) {
    console.log('🔍 Extracting load reference from text...');
   
    const exclusionPatterns = [
      /MC\s*\d+/i,
      /DOT\s*\d+/i,
      /USDOT\s*\d+/i,
      /invoice\s*#?\s*\d+/i,
      /bill\s*#?\s*\d+/i
    ];
   
    for (const pattern of exclusionPatterns) {
      const match = text.match(pattern);
      if (match) {
        console.log(`❌ Found exclusion pattern: ${match[0]} - ignoring`);
        text = text.replace(pattern, '');
      }
    }
   
    const patterns = [
      /order\s*#?\s*(\d{6,8})/i,
      /reference\s+number\s+(\d{6,8})/i,
      /ref[:\s]+(\d{6,8})/i,
      /load[:\s]+(\d{6,8})/i,
      /\b(\d{6})\b/i,
      /(?:load\s*(?:ref|reference|number|id|#)[:\-\s]*)([A-Z0-9\-\_]+)/i,
      /([A-Z]{2,4}[\-\_\s]*\d{3,8}[\-\_\s]*[A-Z0-9]*)/i,
      /([A-HJ-Z]+\d{4,8}[A-Z0-9]*)/i
    ];
   
    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
      const match = text.match(pattern);
     
      if (match && match[1]) {
        let cleanMatch = match[1].trim();
        cleanMatch = cleanMatch.replace(/[^\w\-]/g, '');
       
        if (cleanMatch &&
            cleanMatch.length >= 4 &&
            !cleanMatch.toUpperCase().startsWith('MC') &&
            !cleanMatch.toUpperCase().startsWith('DOT')) {
          console.log(`✅ Found load reference: ${cleanMatch}`);
          return cleanMatch;
        }
      }
    }
   
    console.log('❌ No valid load reference found in text');
    return null;
  }

  async initialize() {
    try {
      console.log('🚀 Initializing browser for QuoteFactory...');
     
      if (!process.env.BROWSERLESS_TOKEN) {
        throw new Error('BROWSERLESS_TOKEN is required. Get one at https://www.browserless.io/');
      }

      console.log('🌐 Connecting to Browserless.io...');
      
      let retries = 3;
      let lastError = null;

      while (retries > 0) {
        try {
          this.browser = await puppeteer.connect({
            browserWSEndpoint: `wss://production-sfo.browserless.io?token=${process.env.BROWSERLESS_TOKEN}&stealth=true&blockAds=true`,
            timeout: 60000
          });
          console.log('✅ Connected to Browserless.io successfully');
          break;
        } catch (error) {
          lastError = error;
          
          if (error.message.includes('429')) {
            console.log(`⚠️ Rate limited. Retrying in 5 seconds... (${retries} attempts left)`);
            retries--;
            if (retries > 0) {
              await this.wait(5000);
              continue;
            } else {
              throw new Error('Browserless.io rate limit exceeded. Please check your usage at https://www.browserless.io/account or try again in a few minutes.');
            }
          }
          
          throw error;
        }
      }

      if (!this.browser) {
        throw lastError || new Error('Failed to connect to browser');
      }
     
      this.page = await this.browser.newPage();
     
      await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
     
      await this.page.setRequestInterception(true);
      this.page.on('request', (req) => {
        const url = req.url();
        const resourceType = req.resourceType();
       
        if (url.includes('quotefactory.com') || url.includes('auth0.com')) {
          req.continue();
        } else if (['image', 'font', 'stylesheet', 'media'].includes(resourceType)) {
          req.abort();
        } else {
          req.continue();
        }
      });
     
      console.log('✅ Browser initialized successfully');
      return true;
     
    } catch (error) {
      console.error('❌ Failed to initialize browser:', error.message);
      throw error;
    }
  }

  async cleanup() {
    try {
      if (this.page) {
        await this.page.close().catch(e => console.log('Page close error:', e.message));
      }
      if (this.browser) {
        await this.browser.close().catch(e => console.log('Browser close error:', e.message));
      }
      console.log('✅ Browser cleanup completed');
    } catch (error) {
      console.error('❌ Cleanup error:', error.message);
    }
  }

  async findVisible(selectors) {
    for (const sel of selectors) {
      try {
        const el = await this.page.$(sel);
        if (el && (await this.page.evaluate((e) => getComputedStyle(e).display !== 'none', el))) {
          return sel;
        }
      } catch {}
    }
    return null;
  }

  async isLoggedIn() {
    if (this.page.url().includes('auth.quotefactory.com')) return false;
    if (this.page.url().includes('app.quotefactory.com')) {
      await this.wait(1000);
      return this.page.evaluate(
        () => !!(document.querySelector('nav, header, button') || document.body.textContent.includes('find'))
      );
    }
    return false;
  }

  async performSingleLogin() {
    try {
      const username = process.env.QF_USERNAME;
      const password = process.env.QF_PASSWORD;
     
      if (!username || !password) {
        throw new Error('QF_USERNAME and QF_PASSWORD environment variables are required');
      }

      try {
        await this.page.goto('https://app.quotefactory.com', {
          waitUntil: 'domcontentloaded',
          timeout: 60000
        });
      } catch {}
     
      await this.wait(3000);
     
      if (await this.isLoggedIn()) {
        console.log('✅ Already logged in');
        return true;
      }

      try {
        await this.page.waitForSelector('.auth0-lock-widget', { timeout: 8000 });
        await this.wait(2000);
      } catch {
        await this.page.waitForFunction(
          () => document.querySelectorAll('input[type="email"], input[type="password"]').length >= 2,
          { timeout: 30000 }
        );
      }

      const emailSel = await this.findVisible([
        'input[type="email"]',
        'input[name="email"]',
        'input[name="username"]'
      ]);
     
      if (!emailSel) throw new Error('Email input not found');
     
      await this.page.click(emailSel, { clickCount: 3 });
      await this.page.type(emailSel, username, { delay: 50 });
      await this.wait(500);

      const passSel = await this.findVisible([
        'input[type="password"]',
        'input[name="password"]'
      ]);
     
      if (!passSel) throw new Error('Password input not found');
     
      await this.page.click(passSel, { clickCount: 3 });
      await this.page.type(passSel, password, { delay: 50 });
      await this.wait(500);

      let submitSel = await this.findVisible([
        'button[type="submit"]',
        'button[name="submit"]',
        '.auth0-lock-submit'
      ]);
     
      if (!submitSel) {
        submitSel = await this.page.evaluate(() => {
          const btn = [...document.querySelectorAll('button')].find((b) =>
            /log in|sign in|continue/i.test(b.textContent)
          );
          if (btn) {
            btn.setAttribute('data-submit', '1');
            return '[data-submit="1"]';
          }
          return null;
        });
      }
     
      if (!submitSel) throw new Error('Submit button not found');
     
      await this.page.click(submitSel);

      try {
        await this.page.waitForNavigation({ timeout: 30000, waitUntil: 'domcontentloaded' });
      } catch {}

      await this.wait(2000);
      const loggedIn = await this.isLoggedIn();
     
      if (loggedIn) {
        console.log('✅ Login successful');
      } else {
        console.log('❌ Login failed');
      }
     
      return loggedIn;
     
    } catch (error) {
      console.error('❌ Login error:', error.message);
      return false;
    }
  }

  async login() {
    console.log('🔐 Starting login process with retry logic...');
    
    for (let attempt = 1; attempt <= this.MAX_LOGIN_RETRIES; attempt++) {
      console.log(`📍 Login attempt ${attempt}/${this.MAX_LOGIN_RETRIES}`);
      
      const success = await this.performSingleLogin();
      
      if (success) {
        console.log(`✅ Login successful on attempt ${attempt}`);
        return true;
      }
      
      console.log(`❌ Login failed on attempt ${attempt}`);
      
      if (attempt < this.MAX_LOGIN_RETRIES) {
        console.log(`⏳ Waiting ${this.LOGIN_RETRY_DELAY / 1000} seconds before retry...`);
        await this.wait(this.LOGIN_RETRY_DELAY);
        
        // Reload page for next attempt
        try {
          console.log('🔄 Reloading page for next login attempt...');
          await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
          await this.wait(2000);
        } catch (err) {
          console.log('⚠️ Page reload failed, continuing...');
        }
      }
    }
    
    console.log(`❌ Login failed after ${this.MAX_LOGIN_RETRIES} attempts`);
    return false;
  }

  async extractDriverInfo() {
    try {
      console.log('📋 Extracting driver info...');
      const btn = await this.page.$('button[aria-label*="Update driver information"]');
      if (!btn) {
        console.log('⚠️ Driver info button not found');
        return { driverName: 'N/A', driverPhone: 'N/A' };
      }
     
      await btn.click();
      console.log('✅ Clicked driver info button');
     
      await this.wait(2000);
     
      try {
        await this.page.waitForSelector('#driverName', { timeout: 3000, visible: true });
      } catch (e) {
        console.log('⚠️ Driver name input not found');
      }
     
      const driverInfo = await this.page.evaluate(() => {
        const driverName = document.querySelector('#driverName')?.value || 'N/A';
        let driverPhone = document.querySelector('#driverPhone')?.value || 'N/A';
        
        // Remove +1 prefix if it exists
        if (driverPhone !== 'N/A') {
          driverPhone = driverPhone.replace(/^\+1\s*/, '').trim();
        }
        
        return { driverName, driverPhone };
      });
     
      console.log('📞 Driver info:', driverInfo);
     
      await this.page.keyboard.press('Escape');
      await this.wait(1000);
     
      return driverInfo;
    } catch (error) {
      console.log('❌ Driver info extraction failed:', error.message);
      return { driverName: 'N/A', driverPhone: 'N/A' };
    }
  }

  async extractCompanyInfo() {
    try {
      console.log('🏢 Extracting company info...');
      const btn = await this.page.$('button[aria-label*="Open"][aria-label*="detail"]');
      if (!btn) {
        console.log('⚠️ Company info button not found');
        return { companyName: 'N/A', usdot: 'N/A', mcNumber: 'N/A' };
      }
     
      await btn.click();
      console.log('✅ Clicked company info button');
     
      await this.wait(2500);
     
      const info = await this.page.evaluate(() => {
        const bodyText = document.body.innerText;

        const modal = document.querySelector('.flex.flex-col.gap-10.flex-1');
        if (!modal) {
          return {
            companyName: "N/A",
            usdot: bodyText.match(/USDOT\s+(\d+)/)?.[1] || "N/A",
            mcNumber: bodyText.match(/MC-(\d+)/)?.[1] || "N/A",
          };
        }

        const titleEl = modal.querySelector(".text-24.font-semibold");
        const companyName = titleEl?.textContent.trim() || "N/A";

        return {
          companyName,
          usdot: bodyText.match(/USDOT\s+(\d+)/)?.[1] || "N/A",
          mcNumber: bodyText.match(/MC-(\d+)/)?.[1] || "N/A",
        };
      });
     
      console.log('🏢 Company info:', info);
     
      await this.page.keyboard.press('Escape');
      await this.wait(1000);
     
      return info;
    } catch (error) {
      console.log('❌ Company info extraction failed:', error.message);
      return { companyName: 'N/A', usdot: 'N/A', mcNumber: 'N/A' };
    }
  }

  async searchLoad(ref) {
    console.log(`🔎 Searching for load: ${ref}`);
   
    await this.page.keyboard.down('Control');
    await this.page.keyboard.press('KeyK');
    await this.page.keyboard.up('Control');
    await this.wait(1000);

    try {
      await this.page.waitForSelector('#search_field', { timeout: 3000 });
    } catch {
      await this.page.evaluate(() => {
        [...document.querySelectorAll('button')].find((b) =>
          /find|anything/i.test(b.textContent)
        )?.click();
      });
      await this.wait(1000);
      await this.page.waitForSelector('#search_field', { timeout: 3000 });
    }

    await this.page.click('#search_field', { clickCount: 3 });
    await this.page.type('#search_field', ref, { delay: 50 });
    await this.page.keyboard.press('Enter');
   
    await this.wait(4000);

    await this.page.evaluate(() => {
      const sels = [
        '.\\@container a[data-current="true"]',
        '.\\@container a',
        '.\\@container',
      ];
      for (const sel of sels) {
        const el = document.querySelector(sel);
        if (el) {
          el.click();
          break;
        }
      }
    });

    await this.wait(3000);

    console.log('📋 Extracting driver and company information...');

    const driverInfo = await this.extractDriverInfo();
    const companyInfo = await this.extractCompanyInfo();

    return {
      ...driverInfo,
      ...companyInfo
    };
  }

  async searchLoadWithRetry(ref) {
    console.log(`🔁 Starting searchLoad with retry logic for: ${ref}`);
    
    for (let attempt = 1; attempt <= this.MAX_SEARCH_RETRIES; attempt++) {
      try {
        console.log(`📍 Search attempt ${attempt}/${this.MAX_SEARCH_RETRIES}`);
        
        const loadData = await this.searchLoad(ref);
        console.log(`✅ Search successful on attempt ${attempt}`);
        return loadData;
        
      } catch (error) {
        console.error(`❌ Search attempt ${attempt} failed:`, error.message);
        
        // If not the last attempt, try to re-login
        if (attempt < this.MAX_SEARCH_RETRIES) {
          const waitMs = this.SEARCH_RETRY_DELAY + (attempt * 1000);
          console.log(`⏳ Waiting ${waitMs / 1000} seconds before re-login attempt...`);
          await this.wait(waitMs);
          
          try {
            console.log('🔄 Attempting to re-login after search failure...');
            
            // Clear session and re-login
            try {
              await this.page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 15000 });
              await this.wait(1000);
            } catch {}
            
            const loginSuccess = await this.login();
            
            if (!loginSuccess) {
              console.log('❌ Re-login failed, but will try search again anyway');
            } else {
              console.log('✅ Re-login successful, retrying search...');
            }
          } catch (loginError) {
            console.error('❌ Re-login error:', loginError.message);
            // Continue to retry search anyway
          }
        } else {
          // Last attempt failed
          throw error;
        }
      }
    }
    
    throw new Error(`Search failed after ${this.MAX_SEARCH_RETRIES} attempts`);
  }
}

// vercel serverless function handler
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
 
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const automation = new QuikSkopeAutomation();
 
  try {
    console.log('=== QuikSkope Load Extraction ===');
    console.log('Request method:', req.method);
    console.log('Content-Type:', req.headers['content-type']);
    console.log('Full request body:', JSON.stringify(req.body, null, 2));
   
    let loadRef = null;
   
    if (req.method === 'GET') {
      loadRef = req.query.ref || req.query.loadReference;
    } else {
      const bodyKeys = Object.keys(req.body || {});
      console.log('Checking body keys:', bodyKeys);
     
      loadRef = req.body?.ref
        || req.body?.loadReference
        || req.body?.load_reference
        || req.body?.loadNumber
        || req.body?.text
        || req.body?.message
        || req.body?.content;
     
      if (!loadRef && bodyKeys.length > 0) {
        const firstKey = bodyKeys[0];
        loadRef = req.body[firstKey];
        console.log(`Using first body key "${firstKey}":`, loadRef);
      }
     
      if (!loadRef && bodyKeys.length > 0) {
        for (const key of bodyKeys) {
          if (/^\d{6,8}$/.test(key)) {
            loadRef = key;
            console.log(`Found load reference in body key: ${key}`);
            break;
          }
        }
      }
    }
   
    if (loadRef && typeof loadRef === 'string' && loadRef.length > 20) {
      console.log('📝 Received text content, attempting to extract load reference...');
      const extracted = automation.extractLoadReference(loadRef);
      if (extracted) {
        loadRef = extracted;
        console.log(`✅ Extracted load reference: ${loadRef}`);
      }
    }
   
    console.log('Final loadRef:', loadRef);
   
    if (!loadRef) {
      return res.status(400).json({
        error: 'Load reference is required',
        debug: {
          receivedBody: req.body,
          bodyKeys: Object.keys(req.body || {}),
          contentType: req.headers['content-type'],
          method: req.method
        },
        usage: 'POST /api/quikskope with { "ref": "315567" } or GET /api/quikskope?ref=315567'
      });
    }

    console.log(`📦 Processing load reference: ${loadRef}`);
   
    const browserReady = await automation.initialize();
    if (!browserReady) {
      return res.status(500).json({
        error: 'Browser initialization failed',
        message: 'Check BROWSERLESS_TOKEN environment variable'
      });
    }

    const loginSuccess = await automation.login();
    if (!loginSuccess) {
      await automation.cleanup();
      return res.status(401).json({
        error: 'Login failed after multiple attempts',
        message: 'Check QF_USERNAME and QF_PASSWORD environment variables',
        attempts: automation.MAX_LOGIN_RETRIES
      });
    }

    // Use the retry wrapper for searchLoad
    const loadData = await automation.searchLoadWithRetry(loadRef);
   
    await automation.cleanup();

    return res.status(200).json({
      success: true,
      loadReference: loadRef,
      data: {
        driver: {
          name: loadData.driverName,
          phone: loadData.driverPhone
        },
        company: {
          name: loadData.companyName,
          usdot: loadData.usdot,
          mcNumber: loadData.mcNumber
        }
      },
      timestamp: new Date().toISOString()
    });
   
  } catch (error) {
    console.error('❌ Error:', error);
   
    await automation.cleanup();
   
    if (error.message.includes('429') || error.message.includes('rate limit')) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: 'Browserless.io has rate limited your requests. Please wait a few minutes and try again, or check your usage at https://www.browserless.io/account',
        retryAfter: 300,
        timestamp: new Date().toISOString()
      });
    }
   
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

export const config = {
  maxDuration: 300,
};