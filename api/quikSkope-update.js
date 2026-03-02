// quikskope-update.js - Complete automation with load editing

import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_TIMEOUT = 15000;
const NAV_TIMEOUT = 30000;

async function isLoggedIn(page) {
  try {
    return await page.evaluate(() => {
      const hasNav = document.querySelector("nav, .navbar, .sidebar, .nk-sidebar");
      const hasLogout = document.body.textContent.toLowerCase().includes("logout");
      const hasLoadOrder = document.body.textContent.toLowerCase().includes("load/order management");
      return !!(hasNav || hasLogout || hasLoadOrder);
    });
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const start = Date.now();
  const logs = [];
  let browser;

  const log = (message) => {
    const elapsed = Date.now() - start;
    logs.push({ time: new Date().toISOString(), elapsed: `${elapsed}ms`, message });
    console.log(`[${elapsed}ms] ${message}`);
  };

  const ensureTimeLeft = (msNeeded = 5000) => {
    const elapsed = Date.now() - start;
    const timeLeft = 57000 - elapsed;
    if (timeLeft < msNeeded) {
      throw new Error(`Approaching Vercel timeout (${timeLeft}ms left, need ${msNeeded}ms)`);
    }
  };

  try {
    const QS_USERNAME = process.env.QS_USERNAME;
    const QS_PASSWORD = process.env.QS_PASSWORD;
    const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;

    if (!QS_USERNAME || !QS_PASSWORD) {
      throw new Error("Missing credentials");
    }

    const { loadNumber, driverName, driverNumber, companyName, companyDotNumber, companyMcNumber } = req.body;

    log(`Webhook received: Load ${loadNumber}`);
    
    if (!loadNumber) {
      return res.status(400).json({ 
        error: "Missing loadNumber", 
        received: req.body, 
        logs 
      });
    }

    const updateData = {};
    if (driverName) updateData.driverName = driverName;
    if (driverNumber) updateData.driverPhone = driverNumber;
    if (companyName) updateData.carrierName = companyName;
    if (companyMcNumber) updateData.carrierMC = companyMcNumber;
    if (companyDotNumber) updateData.carrierDOT = companyDotNumber;

    log(`Fields to update: ${JSON.stringify(updateData)}`);

    // Connect to Browserless
    ensureTimeLeft();
    browser = await puppeteer.connect({
      browserWSEndpoint: `wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}&stealth&blockAds`,
      defaultViewport: null,
    });
    log("✓ Browser connected");

    const page = await browser.newPage();
    page.setDefaultTimeout(DEFAULT_TIMEOUT);
    page.setDefaultNavigationTimeout(NAV_TIMEOUT);

    // CRITICAL: Set up alert/dialog handler to automatically dismiss any popups
    page.on('dialog', async dialog => {
      log(`⚠️ Alert detected: "${dialog.message()}" - Auto-dismissing...`);
      await dialog.accept();
      log("✓ Alert dismissed");
    });

    // Helper function to check for toast error messages
    const checkForToastError = async () => {
      return await page.evaluate(() => {
        // Check for toast error elements
        const toastError = document.querySelector('.toastr.toast-error, .toast-error, div.toast-error');
        if (toastError) {
          // Try multiple ways to get the message
          let message = '';
          
          // Method 1: Look for .toast-message element
          const messageEl = toastError.querySelector('.toast-message');
          if (messageEl) {
            message = messageEl.textContent.trim();
          }
          
          // Method 2: Get all text and remove "Close" button text
          if (!message) {
            message = toastError.textContent
              .replace(/Close/gi, '')
              .replace(/×/g, '')
              .trim();
          }
          
          // Method 3: Try data attributes
          if (!message && toastError.dataset && toastError.dataset.message) {
            message = toastError.dataset.message;
          }
          
          return { 
            found: true, 
            message: message || 'Unknown error occurred',
            html: toastError.outerHTML.substring(0, 200) // First 200 chars for debugging
          };
        }
        return { found: false };
      });
    };

    // LOGIN
    ensureTimeLeft(20000);
    log("🔐 Logging in...");
    await page.goto("https://quikskope.com/platform", { 
      waitUntil: "domcontentloaded", 
      timeout: 60000 
    });
    await wait(1500);

    if (!(await isLoggedIn(page))) {
      await page.waitForSelector('#adminLoginForm', { timeout: 10000 });
      
      await page.type('input#email[name="email"]', QS_USERNAME, { delay: 5 });
      await wait(300);
      await page.type('input#password[name="password"]', QS_PASSWORD, { delay: 5 });
      await wait(300);
      
      await page.waitForSelector('#loginInBtn', { timeout: 5000 });
      
      try {
        await page.click('#loginInBtn');
      } catch (e) {
        await page.evaluate(() => document.querySelector('#loginInBtn').click());
      }
      
      try {
        await page.waitForNavigation({ timeout: 20000, waitUntil: "domcontentloaded" });
      } catch (e) {
        // Ignore navigation timeout
      }
      
      await wait(1000);
      
      if (!(await isLoggedIn(page))) {
        throw new Error("Login failed");
      }
      
      log("✓ Logged in");
    } else {
      log("✓ Already logged in");
    }

    await wait(500);

    // Navigate to load-order page
    ensureTimeLeft(20000);
    log("📋 Navigating to Load/Order Management page...");
    
    await page.goto("https://quikskope.com/customer/load-order", { 
      waitUntil: "load", 
      timeout: 30000 
    });
    
    log("✓ Page navigation complete");
    
    // Wait for critical page elements to ensure page is fully loaded
    await wait(500);
    
    // Wait for the data table to be present (indicates page is ready)
    log("⏳ Waiting for data table to load...");
    
    let tableLoaded = false;
    const tableSelectors = [
      '#loadOrderListTable',
      'table.datatable-init',
      '.dataTables_wrapper',
      'table[aria-describedby="loadOrderListTable_info"]'
    ];
    
    for (const selector of tableSelectors) {
      try {
        await page.waitForSelector(selector, { 
          timeout: 3000,
          visible: true 
        });
        tableLoaded = true;
        log(`✓ Data table found using selector: ${selector}`);
        break;
      } catch (e) {
        // Try next selector
      }
    }
    
    if (!tableLoaded) {
      log("⚠️ Data table not found with standard selectors, checking DOM...");
      
      // Check if table exists in DOM even if not "visible" by Puppeteer standards
      tableLoaded = await page.evaluate(() => {
        return !!(document.querySelector('#loadOrderListTable') || 
                 document.querySelector('table.datatable-init'));
      });
      
      if (tableLoaded) {
        log("✓ Data table exists in DOM");
      } else {
        log("⚠️ Data table not found, but continuing anyway...");
      }
    }
    
    // Extra wait to ensure all JavaScript has finished loading
    await wait(500);
    
    // CRITICAL: Wait for the filter button container to be in the DOM
    log("🔍 Looking for filter button...");
    
    // Try to wait for the filter button with a reasonable timeout
    let filterButtonExists = false;
    try {
      await page.waitForSelector('em.icon.ni.ni-filter-alt', { 
        timeout: 5000 
      });
      filterButtonExists = true;
      log("✓ Filter icon found");
    } catch (e) {
      log("⚠️ Filter icon not found with standard wait, checking DOM...");
    }
    
    // The actual structure from HTML:
    // <li> -> <div class="dropdown"> -> <a class="btn btn-trigger btn-icon dropdown-toggle">
    const filterButtonFound = await page.evaluate(() => {
      // Look for the filter icon first
      const filterIcon = document.querySelector('em.icon.ni.ni-filter-alt');
      if (filterIcon) {
        const button = filterIcon.closest('a.dropdown-toggle');
        if (button) {
          return {
            found: true,
            hasDropdownToggle: button.hasAttribute('data-bs-toggle'),
            isVisible: window.getComputedStyle(button).display !== 'none',
            inDOM: true
          };
        }
      }
      
      // Also check for any dropdown toggle button
      const anyDropdown = document.querySelector('a.dropdown-toggle[data-bs-toggle="dropdown"]');
      return { 
        found: !!anyDropdown,
        fallbackFound: !!anyDropdown,
        inDOM: !!anyDropdown
      };
    });
    
    log(`Filter button status: ${JSON.stringify(filterButtonFound)}`);
    
    if (!filterButtonFound.found && !filterButtonFound.fallbackFound) {
      throw new Error("Filter button not found in DOM - page may not have loaded correctly");
    }
    
    // OPEN FILTER DROPDOWN
    log("🔽 Opening filter dropdown...");
    
    let dropdownOpened = false;
    
    // Method 1: Click using the icon parent approach (most reliable based on HTML)
    dropdownOpened = await page.evaluate(() => {
      const filterIcon = document.querySelector('em.icon.ni.ni-filter-alt');
      if (filterIcon) {
        const button = filterIcon.closest('a.dropdown-toggle');
        if (button) {
          button.click();
          return true;
        }
      }
      return false;
    });
    
    if (dropdownOpened) {
      log("✓ Filter button clicked (method 1: icon parent)");
      await wait(300);
      
      // Verify dropdown is visible
      const isVisible = await page.evaluate(() => {
        const dropdown = document.querySelector('.filter-wg.dropdown-menu');
        if (!dropdown) return false;
        const styles = window.getComputedStyle(dropdown);
        return dropdown.classList.contains('show') || styles.display !== 'none';
      });
      
      if (!isVisible) {
        log("⚠️ Dropdown not visible after click, trying alternative methods...");
        dropdownOpened = false;
      } else {
        log("✓ Filter dropdown is now visible");
      }
    }
    
    // Method 2: Try direct selector click
    if (!dropdownOpened) {
      log("Trying method 2: Direct Bootstrap dropdown toggle");
      try {
        await page.click('a.btn.btn-trigger.dropdown-toggle[data-bs-toggle="dropdown"]');
        await wait(300);
        
        const isVisible = await page.evaluate(() => {
          const dropdown = document.querySelector('.filter-wg.dropdown-menu');
          if (!dropdown) return false;
          return dropdown.classList.contains('show') || window.getComputedStyle(dropdown).display !== 'none';
        });
        
        if (isVisible) {
          dropdownOpened = true;
          log("✓ Filter dropdown opened (method 2)");
        }
      } catch (e) {
        log(`Method 2 failed: ${e.message}`);
      }
    }
    
    // Method 3: Force show the dropdown manually
    if (!dropdownOpened) {
      log("Trying method 3: Force show dropdown");
      dropdownOpened = await page.evaluate(() => {
        const dropdown = document.querySelector('.filter-wg.dropdown-menu');
        if (dropdown) {
          dropdown.classList.add('show');
          dropdown.style.display = 'block';
          dropdown.style.visibility = 'visible';
          dropdown.style.position = 'absolute';
          return true;
        }
        return false;
      });
      
      if (dropdownOpened) {
        log("✓ Filter dropdown forced open (method 3)");
      }
    }
    
    if (!dropdownOpened) {
      throw new Error("Failed to open filter dropdown after all attempts");
    }
    
    await wait(300);
    
    // ENTER LOAD NUMBER
    log(`📝 Entering load number: ${loadNumber}`);
    
    // Wait for the input to be available
    try {
      await page.waitForSelector('input#loadNumber', { 
        timeout: 5000,
        visible: true 
      });
    } catch (e) {
      throw new Error("Load number input field not found or not visible");
    }
    
    // Clear and enter the load number
    await page.click('input#loadNumber', { clickCount: 3 }); // Select all
    await page.type('input#loadNumber', String(loadNumber), { delay: 10 });
    
    log(`✓ Load number "${loadNumber}" entered`);
    await wait(300);
    
    // CLICK FILTER BUTTON
    log("🔘 Clicking Filter button...");
    
    try {
      await page.waitForSelector('button#loadFilter', { 
        timeout: 5000,
        visible: true 
      });
    } catch (e) {
      throw new Error("Filter button not found or not visible");
    }
    
    // Click the filter button
    await page.click('button#loadFilter');
    log("✓ Filter button clicked");
    
    // Wait for the table to update with filtered results
    await wait(1000);
    
    // Verify we got filtered results
    const filteredResults = await page.evaluate((loadNum) => {
      const table = document.querySelector('#loadOrderListTable');
      if (!table) return { found: false, message: 'Table not found' };
      
      const rows = table.querySelectorAll('tbody tr');
      const loadCell = Array.from(rows).find(row => {
        const loadText = row.textContent;
        return loadText.includes(loadNum);
      });
      
      return { 
        found: !!loadCell, 
        rowCount: rows.length,
        message: loadCell ? 'Load found in table' : 'Load not found in filtered results'
      };
    }, String(loadNumber));
    
    log(`Filter results: ${JSON.stringify(filteredResults)}`);
    
    if (!filteredResults.found) {
      throw new Error(`Load ${loadNumber} not found in filtered results`);
    }
    
    log(`✓ Load ${loadNumber} found in table`);
    
    // CLICK ON THE LOAD ROW
    ensureTimeLeft(10000);
    log("🖱️ Clicking on load to view details...");
    
    // Click on the load number link - look for the specific structure
    const loadClicked = await page.evaluate((loadNum) => {
      // Find all load-link anchors
      const loadLinks = Array.from(document.querySelectorAll('a.load-link[title="View Load Details"]'));
      
      for (const link of loadLinks) {
        // Check if this link contains a p tag with the load number
        const pTag = link.querySelector('p.mb-0.me-1');
        if (pTag && pTag.textContent.trim() === String(loadNum)) {
          link.click();
          return true;
        }
      }
      return false;
    }, String(loadNumber));
    
    if (!loadClicked) {
      throw new Error(`Could not click on load ${loadNumber}`);
    }
    
    log("✓ Load details page opening...");
    
    // Wait for navigation to load details page
    try {
      await page.waitForNavigation({ timeout: 10000, waitUntil: "domcontentloaded" });
    } catch (e) {
      log("⚠️ Navigation timeout, but continuing...");
    }
    
    await wait(800);
    
    // CLICK EDIT LOAD BUTTON
    ensureTimeLeft(10000);
    log("✏️ Looking for Edit Load button...");
    
    // Wait for and click the Edit Load button
    let editButtonClicked = false;
    
    // Try to find the button with the exact structure from your HTML
    editButtonClicked = await page.evaluate(() => {
      // Look for the Edit Load link with the specific href pattern
      const editLinks = Array.from(document.querySelectorAll('a.btn.btn-primary'));
      const editButton = editLinks.find(link => 
        link.href && link.href.includes('/customer/edit-load/') &&
        link.textContent.includes('Edit Load')
      );
      
      if (editButton) {
        editButton.click();
        return true;
      }
      return false;
    });
    
    if (!editButtonClicked) {
      throw new Error("Edit Load button not found");
    }
    
    log("✓ Edit Load button clicked");
    
    // Wait for navigation to edit page
    try {
      await page.waitForNavigation({ timeout: 10000, waitUntil: "domcontentloaded" });
    } catch (e) {
      log("⚠️ Navigation timeout, but continuing...");
    }
    
    await wait(800);
    
    // FILL IN THE FORM
    ensureTimeLeft(8000);
    log("📝 Filling in driver and carrier information...");
    
    let fieldsUpdated = [];
    
    // Update Driver Name
    if (updateData.driverName) {
      try {
        await page.waitForSelector('input[name="driver_name"]', { timeout: 5000 });
        await page.evaluate((value) => {
          const input = document.querySelector('input[name="driver_name"]');
          if (input) {
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, updateData.driverName);
        fieldsUpdated.push('driverName');
        log(`✓ Driver name updated: ${updateData.driverName}`);
      } catch (e) {
        log(`⚠️ Could not update driver name: ${e.message}`);
      }
    }
    
    // Update Driver Phone Number
    if (updateData.driverPhone) {
      try {
        await page.waitForSelector('input[name="phone_number"]', { timeout: 5000 });
        
        const phoneDigits = updateData.driverPhone.replace(/\D/g, '');
        await page.evaluate((value) => {
          const input = document.querySelector('input[name="phone_number"]');
          if (input) {
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, phoneDigits);
        fieldsUpdated.push('driverPhone');
        log(`✓ Driver phone updated: ${phoneDigits}`);
      } catch (e) {
        log(`⚠️ Could not update driver phone: ${e.message}`);
      }
    }
    
    // Update Carrier Name
    if (updateData.carrierName) {
      try {
        await page.waitForSelector('input[name="carrier_name"]', { timeout: 5000 });
        await page.evaluate((value) => {
          const input = document.querySelector('input[name="carrier_name"]');
          if (input) {
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, updateData.carrierName);
        fieldsUpdated.push('carrierName');
        log(`✓ Carrier name updated: ${updateData.carrierName}`);
      } catch (e) {
        log(`⚠️ Could not update carrier name: ${e.message}`);
      }
    }
    
    // Update MC Number
    if (updateData.carrierMC) {
      try {
        await page.waitForSelector('input[name="carrier_mc_number"]', { timeout: 5000 });
        await page.evaluate((value) => {
          const input = document.querySelector('input[name="carrier_mc_number"]');
          if (input) {
            input.value = value.toUpperCase();
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, String(updateData.carrierMC));
        fieldsUpdated.push('carrierMC');
        log(`✓ MC number updated: ${updateData.carrierMC}`);
      } catch (e) {
        log(`⚠️ Could not update MC number: ${e.message}`);
      }
    }
    
    // Update DOT Number
    if (updateData.carrierDOT) {
      try {
        await page.waitForSelector('input[name="carrier_dot_number"]', { timeout: 5000 });
        await page.evaluate((value) => {
          const input = document.querySelector('input[name="carrier_dot_number"]');
          if (input) {
            input.value = value.toUpperCase();
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, String(updateData.carrierDOT));
        fieldsUpdated.push('carrierDOT');
        log(`✓ DOT number updated: ${updateData.carrierDOT}`);
      } catch (e) {
        log(`⚠️ Could not update DOT number: ${e.message}`);
      }
    }
    
    if (fieldsUpdated.length === 0) {
      log("⚠️ No fields were updated - nothing to save");
    } else {
      log(`✓ Updated ${fieldsUpdated.length} field(s): ${fieldsUpdated.join(', ')}`);
      
      // SAVE THE CHANGES
      ensureTimeLeft(6000);
      log("💾 Clicking Save & Continue button...");
      
      // Look for the specific "Save & Continue" button
      const saveButtonClicked = await page.evaluate(() => {
        const saveButton = document.querySelector('button#saveAndContinuePreviewLoad');
        if (saveButton) {
          saveButton.click();
          return true;
        }
        return false;
      });
      
      if (!saveButtonClicked) {
        log("⚠️ Save & Continue button not found - changes may not be saved");
      } else {
        log("✓ Save & Continue button clicked");
        
        // Wait for the confirmation modal to appear
        log("⏳ Waiting for confirmation modal...");
        await wait(1000);
        
        // CHECK FOR TOAST ERRORS after clicking Save & Continue
        const toastError = await checkForToastError();
        if (toastError.found) {
          const errorMsg = `Toast Error: ${toastError.message}`;
          log(`❌ ${errorMsg}`);
          log(`Toast HTML preview: ${toastError.html || 'N/A'}`);
          console.error(`TOAST ERROR DETECTED: ${toastError.message}`);
          
          const duration = Date.now() - start;
          
          // Return success response but with error details
          return res.status(200).json({
            success: false,
            error: true,
            errorMessage: toastError.message,
            errorType: 'toast_error',
            loadNumber,
            duration,
            message: errorMsg,
            logs,
          });
        }
        
        try {
          // Wait for the Confirm Load button to be visible
          await page.waitForSelector('button#confirmLoadData', { 
            timeout: 5000,
            visible: true 
          });
          
          log("✓ Confirmation modal appeared");
          
          // Click the Confirm Load button
          const confirmClicked = await page.evaluate(() => {
            const confirmButton = document.querySelector('button#confirmLoadData');
            if (confirmButton) {
              confirmButton.click();
              return true;
            }
            return false;
          });
          
          if (confirmClicked) {
            log("✓ Confirm Load button clicked");
            
            // Wait for confirmation to process
            await wait(1500);
            
            // CHECK FOR TOAST ERRORS after clicking Confirm Load
            const toastErrorAfterConfirm = await checkForToastError();
            if (toastErrorAfterConfirm.found) {
              const errorMsg = `Toast Error: ${toastErrorAfterConfirm.message}`;
              log(`❌ ${errorMsg}`);
              log(`Toast HTML preview: ${toastErrorAfterConfirm.html || 'N/A'}`);
              console.error(`TOAST ERROR DETECTED: ${toastErrorAfterConfirm.message}`);
              
              const duration = Date.now() - start;
              
              // Return success response but with error details
              return res.status(200).json({
                success: false,
                error: true,
                errorMessage: toastErrorAfterConfirm.message,
                errorType: 'toast_error',
                loadNumber,
                duration,
                message: errorMsg,
                logs,
              });
            }
            
            // Check for success message
            const saveConfirmed = await page.evaluate(() => {
              const body = document.body.textContent.toLowerCase();
              return body.includes('success') || body.includes('updated') || body.includes('saved') || body.includes('confirmed');
            });
            
            if (saveConfirmed) {
              log("✅ Load update confirmed successfully");
            } else {
              log("⚠️ Could not confirm save operation");
            }
          } else {
            log("⚠️ Could not click Confirm Load button");
          }
        } catch (e) {
          log(`⚠️ Error with confirmation modal: ${e.message}`);
          
          // Check for toast errors one more time in case the error appeared during the exception
          const toastErrorFinal = await checkForToastError();
          if (toastErrorFinal.found) {
            const errorMsg = `Toast Error: ${toastErrorFinal.message}`;
            log(`❌ ${errorMsg}`);
            log(`Toast HTML preview: ${toastErrorFinal.html || 'N/A'}`);
            console.error(`TOAST ERROR DETECTED: ${toastErrorFinal.message}`);
            
            const duration = Date.now() - start;
            
            // Return success response but with error details
            return res.status(200).json({
              success: false,
              error: true,
              errorMessage: toastErrorFinal.message,
              errorType: 'toast_error',
              loadNumber,
              duration,
              message: errorMsg,
              logs,
            });
          }
        }
      }
    }

    const duration = Date.now() - start;
    log(`✅ Process completed successfully in ${duration}ms`);

    return res.status(200).json({
      success: true,
      loadNumber,
      duration,
      message: `Successfully updated load ${loadNumber}`,
      filteredResults,
      updatedFields: fieldsUpdated,
      updateData,
      logs,
    });
    
  } catch (error) {
    log(`❌ ERROR: ${error.message}`);
    console.error(`ERROR: ${error.message}`);
    
    // Check if this is a toast error
    const isToastError = error.message.includes('Toast Error:');
    
    return res.status(500).json({
      success: false,
      error: error.message,
      errorType: isToastError ? 'toast_error' : 'automation_error',
      message: error.message, // Zapier often looks for 'message' field
      stack: error.stack,
      logs,
    });
    
  } finally {
    if (browser) {
      try {
        await browser.close();
        log("Browser closed");
      } catch (e) {
        log(`Browser close error: ${e.message}`);
      }
    }
  }
}

export const config = {
  maxDuration: 300,
};