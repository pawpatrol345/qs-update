import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

const SELECTORS = {
  // Form fields
  loadNumber: 'input[name="load_number"]',
  driverName: 'input[name="driver_name"]',
  driverPhone: 'input#adminProfileDailingCode[name="phone_number"]',
  carrierName: 'input[name="carrier_name"]',
  carrierMC: 'input[name="carrier_mc_number"]',
  carrierDOT: 'input[name="carrier_dot_number"]',
  
  // Buttons
  multipleLoadBtn: '#multipleLoadButton',
  addMoreForm: '#addMorePickupDropForm',
  saveBtn: '#saveAndContinuePreviewLoad',
  confirmBtn: '#confirmLoadData',
  createLoadBtn: 'a#createLoadByForm',
  
  // Modal & errors
  confirmModal: '#viewLoadReceiptModel',
  toastError: '.toastr.toast-error, .toast-error, div.toast-error',
  
  // Checkboxes
  clonePickupCheckbox: '#addpickcheck',
  cloneDropCheckbox: '#addpickcheck1',
};

const TIMEOUTS = {
  navigation: 30000,  // Increased from 12s to 30s
  selector: 15000,    // Increased from 8s to 15s
  short: 3000,        // Increased from 1s to 3s
  modal: 18000,       // Increased from 6s to 18s
};

const WAITS = {
  afterType: 100,           // Increased from 50ms
  afterAutocomplete: 100,   // Increased from 50ms
  afterFieldSet: 100,       // Increased from 50ms
  afterClick: 500,          // Increased from 300ms
  afterFormAdd: 500,        // Increased from 300ms
  modalCheck: 300,
  pageStabilize: 2000,      // Increased from 1500ms
  betweenAddresses: 2000,   // NEW: wait between geocoding operations
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if browser/page is still alive
 */
async function ensureBrowserAlive(page, log) {
  try {
    await page.evaluate(() => document.title);
    return true;
  } catch (error) {
    log(`❌ Browser connection lost: ${error.message}`);
    throw new Error('Browser crashed or disconnected');
  }
}

/**
 * Check for toast error messages on the page
 */
const checkForToastError = async (page) => {
  return await page.evaluate((selector) => {
    const toastError = document.querySelector(selector);
    if (!toastError) return { found: false };
    
    // Try multiple methods to extract error message
    const messageEl = toastError.querySelector('.toast-message');
    let message = messageEl?.textContent.trim() || '';
    
    if (!message) {
      message = toastError.textContent
        .replace(/Close/gi, '')
        .replace(/×/g, '')
        .trim();
    }
    
    if (!message && toastError.dataset?.message) {
      message = toastError.dataset.message;
    }
    
    return { 
      found: true, 
      message: message || 'Unknown error occurred',
      html: toastError.outerHTML.substring(0, 200)
    };
  }, SELECTORS.toastError);
};

/**
 * Parse and normalize driver name
 */
const parseDriverName = (str) => {
  if (!str) return '';
  
  let name = String(str).trim().replace(/\s+/g, ' ');
  if (!name) return '';
  
  // Reverse "Last, First" format
  if (name.includes(',')) {
    const parts = name.split(',').map(part => part.trim()).filter(Boolean);
    name = parts.reverse().join(' ');
  }
  
  // Capitalize each word
  return name.split(' ')
    .map(word => word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : '')
    .join(' ');
};

/**
 * Parse array from string with intelligent address splitting
 */
const parseAddressArray = (str) => {
  if (!str) return [];
  if (Array.isArray(str)) return str.map(String);
  
  const strVal = String(str).trim();
  
  // Split on ", USA" pattern for multiple addresses
  const usaSplitPattern = /,\s*USA\s*(?=\d|\w)/i;
  if (usaSplitPattern.test(strVal)) {
    const addresses = strVal.split(usaSplitPattern).map(addr => {
      const trimmed = addr.trim();
      return trimmed.toUpperCase().endsWith(', USA') ? trimmed : `${trimmed}, USA`;
    });
    
    if (addresses.length > 1) {
      return addresses.filter(a => a && a.length > 10);
    }
  }
  
  // Split on state+zip pattern for multiple addresses
  const stateZipPattern = /([A-Z]{2}\s+\d{5}(?:-\d{4})?)/g;
  const matches = [...strVal.matchAll(stateZipPattern)];
  
  if (matches.length > 1) {
    const addresses = [];
    
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const matchEnd = match.index + match[0].length;
      
      let addrStart = 0;
      if (i > 0) {
        const prevMatchEnd = matches[i - 1].index + matches[i - 1][0].length;
        let searchStart = prevMatchEnd;
        
        const afterPrevMatch = strVal.substring(prevMatchEnd);
        const usaMatch = afterPrevMatch.match(/^\s*,?\s*USA\s*/i);
        if (usaMatch) {
          searchStart = prevMatchEnd + usaMatch[0].length;
        }
        
        addrStart = strVal.substring(searchStart).search(/\S/) + searchStart;
      }
      
      let addrEnd = matchEnd;
      const afterMatch = strVal.substring(matchEnd);
      const usaMatch = afterMatch.match(/^\s*,?\s*USA/i);
      if (usaMatch) {
        addrEnd = matchEnd + usaMatch[0].length;
      }
      
      const addr = strVal.substring(addrStart, addrEnd).trim().replace(/^,\s*/, '');
      if (addr && addr.length > 10) {
        addresses.push(addr.toUpperCase().endsWith(', USA') ? addr : `${addr}, USA`);
      }
    }
    
    if (addresses.length > 0) return addresses;
  }
  
  return [strVal].filter(Boolean);
};

/**
 * Parse simple comma-separated array or object with numeric keys
 */
const parseSimpleArray = (str) => {
  if (!str) return [];
  if (Array.isArray(str)) return str.map(String);
  
  // Handle object with numeric keys
  if (typeof str === 'object' && str !== null) {
    const keys = Object.keys(str).sort((a, b) => parseInt(a) - parseInt(b));
    return keys.map(key => String(str[key])).filter(n => n && n.trim());
  }
  
  return String(str)
    .split(',')
    .map(n => n.trim())
    .filter(n => n && n !== '#');
};

/**
 * Parse Zapier data into structured format
 */
function parseZapierData(zapierData) {
  const rawDriverName = zapierData.driverName || 
                        zapierData.driver_name || 
                        zapierData.driver || 
                        zapierData["8. Data Driver Name"] ||
                        '';
  
  const normalizedDriverName = parseDriverName(rawDriverName);
  
  console.log(`📝 Driver Name: "${rawDriverName}" → "${normalizedDriverName}"`);
  
  const data = {
    loadNumber: zapierData.loadNumber || zapierData.load_number || zapierData["8. Load Reference"],
    driver: {
      name: normalizedDriverName,
      phone: zapierData.driverNumber || zapierData.driver_number || zapierData.driver_phone || zapierData["8. Data Driver Phone"]
    },
    company: {
      name: zapierData.companyName || zapierData.company_name || zapierData.company || zapierData["8. Data Company Name"],
      usdot: zapierData.DotNumber || zapierData.dot_number || zapierData.usdot || zapierData["8. Data Company Usdot"],
      mc: zapierData.McNumber || zapierData.mc_number || zapierData.mc || zapierData["8. Data Company Mc Number"]
    },
    pickups: [],
    deliveries: []
  };

  // Parse pickup data
  const pickupAddrs = parseAddressArray(zapierData.pickUp || zapierData.pickup || zapierData.pickup_address || zapierData["8. Data Pickups Address"]);
  const pickupDates = parseSimpleArray(zapierData.pickUpDate || zapierData.pickup_date || zapierData["8. Data Pickups Date"]);
  const pickupNums = parseSimpleArray(zapierData.pickUpNumber || zapierData.pickup_numbers || zapierData.pickup_number || zapierData["8. Data Pickups Po Numbers"]);

  console.log('📦 Pickup Numbers:', pickupNums);

  // Deduplicate pickup addresses
  const uniquePickupAddrs = [];
  const seenPickups = new Set();
  
  pickupAddrs.forEach((addr, i) => {
    const normalizedAddr = addr.trim().toUpperCase().replace(/,\s+USA$/, '');
    if (!seenPickups.has(normalizedAddr)) {
      seenPickups.add(normalizedAddr);
      uniquePickupAddrs.push({ addr, index: i });
    }
  });

  // Build pickup objects
  uniquePickupAddrs.forEach(({ addr, index }, i) => {
    // First pickup gets all pickup numbers, others get load number
    const nums = i === 0 && pickupNums.length > 0 ? pickupNums : [data.loadNumber];
    
    data.pickups.push({
      address: addr.trim().toUpperCase().endsWith(', USA') ? addr : `${addr}, USA`,
      date: pickupDates[index] || pickupDates[0] || '',
      pickUp: nums.filter(Boolean)
    });
  });

  // Parse delivery data
  const deliveryAddrs = parseAddressArray(zapierData.deliveries || zapierData.delivery || zapierData.delivery_address || zapierData["8. Data Deliveries Address"]);
  const deliveryDates = parseSimpleArray(zapierData.deliveriesDate || zapierData.delivery_date || zapierData["8. Data Deliveries Date"]);
  const deliveryNums = parseSimpleArray(zapierData.dropOffNumber || zapierData.delivery_numbers || zapierData.dropoff_number || zapierData["8. Data Deliveries Del Numbers"]);

  console.log('🚚 Delivery Numbers:', deliveryNums);

  // Deduplicate delivery addresses
  const uniqueDeliveryAddrs = [];
  const seenDeliveries = new Set();
  
  deliveryAddrs.forEach((addr, i) => {
    const normalizedAddr = addr.trim().toUpperCase().replace(/,\s+USA$/, '');
    if (!seenDeliveries.has(normalizedAddr)) {
      seenDeliveries.add(normalizedAddr);
      uniqueDeliveryAddrs.push({ addr, index: i });
    }
  });

  // Distribute delivery numbers across deliveries
  if (uniqueDeliveryAddrs.length > 0) {
    const numsPerDelivery = Math.ceil(deliveryNums.length / uniqueDeliveryAddrs.length);
    
    uniqueDeliveryAddrs.forEach(({ addr, index }, i) => {
      const startIdx = i * numsPerDelivery;
      const endIdx = startIdx + numsPerDelivery;
      let nums = deliveryNums.slice(startIdx, endIdx);
      
      // Fallback to load number if empty
      if (!nums || nums.length === 0 || nums.every(n => !n)) {
        nums = [data.loadNumber];
      }
      
      data.deliveries.push({
        address: addr.trim().toUpperCase().endsWith(', USA') ? addr : `${addr}, USA`,
        date: deliveryDates[index] || deliveryDates[0] || '',
        dropOff: nums.filter(Boolean)
      });
    });
  }
  
  return data;
}

// ============================================================================
// FORM FILLING FUNCTIONS
// ============================================================================

/**
 * Clear all location fields (pickups and deliveries)
 */
async function clearAllLocationFields(page, log) {
  log('  🧹 Clearing existing location fields...');
  
  await page.evaluate(() => {
    const fieldNames = [
      'pickup_location', 'pickup_lat', 'pickup_long', 'pickup_number', 'pickup_date',
      'drop_location', 'drop_lat', 'drop_long', 'drop_number', 'dropoff_date'
    ];
    
    for (let i = 0; i < 10; i++) {
      fieldNames.forEach(fieldName => {
        const field = document.querySelector(`input[name="${fieldName}[${i}]"]`);
        if (!field) return;
        
        // Clear tagsinput if present
        if (fieldName.includes('number') && typeof jQuery !== 'undefined' && jQuery(field).data('tagsinput')) {
          try {
            const tags = jQuery(field).tagsinput('items');
            tags.forEach(tag => jQuery(field).tagsinput('remove', tag));
          } catch (e) {}
        }
        
        field.value = '';
      });
    }
  });
  
  log('  ✓ Fields cleared');
}

/**
 * Fill a single field instantly
 */
async function fillFieldInstant(page, selector, value) {
  await page.evaluate((sel, val) => {
    const el = document.querySelector(sel);
    if (el) {
      el.disabled = false;
      el.removeAttribute('disabled');
      el.readOnly = false;
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, selector, value);
}

/**
 * Fill address field with Google autocomplete - WITH RETRY AND BROWSER CHECK
 */
async function fillAddressInstant(page, selector, value, log) {
  const startTime = Date.now();
  log(`  🏠 Filling address: ${value.substring(0, 50)}...`);
  
  // Check browser is alive before starting
  await ensureBrowserAlive(page, log);
  
  // Wait between geocodes to prevent rate limiting
  await wait(WAITS.betweenAddresses);
  
  try {
    await page.waitForSelector(selector, { timeout: TIMEOUTS.short });
  } catch (e) {
    log(`  ❌ Field not found: ${selector}`);
    throw new Error(`Field not found: ${selector}`);
  }
  
  // Enable and clear field
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) {
      el.disabled = false;
      el.removeAttribute('disabled');
      el.classList.remove('multipleLoadDisable', 'singleLoadDisable');
      el.readOnly = false;
      el.value = '';
      el.focus();
    }
  }, selector);

  await wait(500);  // Increased from 300

  // Type address slowly for autocomplete to trigger
  await page.type(selector, value, { delay: 60 });  // Increased from 50
  await wait(1500); // Increased from 1000
  
  // Wait for .pac-container (Google autocomplete dropdown) to appear
  const dropdownVisible = await page.evaluate(() => {
    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = 25; // Increased from 20
      
      const checkInterval = setInterval(() => {
        attempts++;
        const dropdown = document.querySelector('.pac-container');
        
        if (dropdown && dropdown.style.display !== 'none') {
          const items = dropdown.querySelectorAll('.pac-item');
          if (items.length > 0) {
            clearInterval(checkInterval);
            resolve(true);
            return;
          }
        }
        
        if (attempts >= maxAttempts) {
          clearInterval(checkInterval);
          resolve(false);
        }
      }, 100);
    });
  });
  
  if (dropdownVisible) {
    log(`    ✓ Autocomplete dropdown appeared`);
    
    // Select first option
    await page.keyboard.press('ArrowDown');
    await wait(500);  // Increased from 300
    await page.keyboard.press('Enter');
    await wait(2000); // Increased from 1500
  } else {
    log(`    ⚠️ Autocomplete dropdown didn't appear, trying Enter key...`);
    await page.keyboard.press('Enter');
    await wait(2000);  // Increased from 1500
  }
  
  // Verify lat/lng fields were populated
  const validation = await page.evaluate((sel) => {
    const addressInput = document.querySelector(sel);
    if (!addressInput) return { valid: false, reason: 'address input not found' };
    
    const addressValue = addressInput.value.trim();
    if (!addressValue || addressValue.length < 10) {
      return { valid: false, reason: 'address value empty or too short', value: addressValue };
    }
    
    // Extract index from selector
    const match = sel.match(/\[(\d+)\]/);
    const index = match ? match[1] : '0';
    
    // Determine if pickup or delivery
    const isPickup = sel.includes('pickup');
    const latField = isPickup ? `pickup_lat[${index}]` : `drop_lat[${index}]`;
    const lngField = isPickup ? `pickup_long[${index}]` : `drop_long[${index}]`;
    
    const latInput = document.querySelector(`input[name="${latField}"]`);
    const lngInput = document.querySelector(`input[name="${lngField}"]`);
    
    const lat = latInput?.value || '';
    const lng = lngInput?.value || '';
    
    return {
      valid: lat && lng && lat.length > 0 && lng.length > 0,
      address: addressValue,
      lat,
      lng,
      latFieldName: latField,
      lngFieldName: lngField,
      latExists: !!latInput,
      lngExists: !!lngInput
    };
  }, selector);
  
  if (!validation.valid) {
    log(`    ❌ Lat/Lng not populated! Attempting manual geocode...`);
    log(`    Debug: ${JSON.stringify(validation)}`);
    
    // Fallback: Use Google Geocoding API in browser context
    const geocoded = await page.evaluate(async (sel, addr) => {
      const match = sel.match(/\[(\d+)\]/);
      const index = match ? match[1] : '0';
      const isPickup = sel.includes('pickup');
      const latField = isPickup ? `pickup_lat[${index}]` : `drop_lat[${index}]`;
      const lngField = isPickup ? `pickup_long[${index}]` : `drop_long[${index}]`;
      
      // Try using existing Google Maps instance if available
      if (typeof google !== 'undefined' && google.maps && google.maps.Geocoder) {
        return new Promise((resolve) => {
          const geocoder = new google.maps.Geocoder();
          
          geocoder.geocode({ address: addr }, (results, status) => {
            if (status === 'OK' && results[0]) {
              const location = results[0].geometry.location;
              const lat = location.lat();
              const lng = location.lng();
              
              // Set the hidden fields
              const latInput = document.querySelector(`input[name="${latField}"]`);
              const lngInput = document.querySelector(`input[name="${lngField}"]`);
              
              if (latInput && lngInput) {
                latInput.value = lat.toString();
                lngInput.value = lng.toString();
                
                latInput.dispatchEvent(new Event('input', { bubbles: true }));
                latInput.dispatchEvent(new Event('change', { bubbles: true }));
                lngInput.dispatchEvent(new Event('input', { bubbles: true }));
                lngInput.dispatchEvent(new Event('change', { bubbles: true }));
                
                resolve({ success: true, lat, lng });
              } else {
                resolve({ success: false, reason: 'lat/lng inputs not found' });
              }
            } else {
              resolve({ success: false, reason: `Geocode failed: ${status}` });
            }
          });
          
          // Timeout after 8 seconds (increased from 5)
          setTimeout(() => resolve({ success: false, reason: 'timeout' }), 8000);
        });
      }
      
      return { success: false, reason: 'Google Maps API not available' };
    }, selector, value);
    
    if (geocoded.success) {
      log(`    ✓ Manual geocode successful: ${geocoded.lat}, ${geocoded.lng}`);
    } else {
      log(`    ❌ Manual geocode failed: ${geocoded.reason}`);
      throw new Error(`Failed to populate lat/lng for address: ${value}`);
    }
  } else {
    log(`    ✓ Lat/Lng validated: ${validation.lat}, ${validation.lng}`);
  }
  
  // Clear autocomplete dropdown to free memory
  await page.evaluate(() => {
    const dropdown = document.querySelector('.pac-container');
    if (dropdown) dropdown.remove();
  });
  
  log(`  ✓ Address filled (${Date.now() - startTime}ms)`);
  return true;
}

/**
 * Fill address with retry logic
 */
async function fillAddressWithRetry(page, selector, value, log, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await fillAddressInstant(page, selector, value, log);
      return true;
    } catch (error) {
      log(`  ⚠️ Address fill attempt ${attempt} failed: ${error.message}`);
      
      if (attempt < maxRetries) {
        log(`  🔄 Retrying in 3 seconds...`);
        await wait(3000);
        
        // Check if page is still alive
        try {
          await ensureBrowserAlive(page, log);
        } catch {
          throw new Error('Browser connection lost - cannot retry');
        }
      } else {
        throw error;
      }
    }
  }
}

/**
 * Fill tags/chips input (for PO numbers, delivery numbers)
 */
async function fillTagsInstant(page, selector, values, log) {
  if (!values || values.length === 0) return true;

  const result = await page.evaluate((sel, vals) => {
    try {
      const input = document.querySelector(sel);
      if (!input) {
        return { success: false, reason: 'input not found' };
      }
      
      input.disabled = false;
      input.removeAttribute('disabled');
      input.classList.remove('multipleLoadDisable', 'singleLoadDisable');
      input.style.display = '';

      // Use jQuery tagsinput if available
      if (typeof jQuery !== 'undefined' && jQuery(input).data('tagsinput')) {
        try {
          // Clear existing tags
          const existingTags = jQuery(input).tagsinput('items');
          existingTags.forEach(tag => jQuery(input).tagsinput('remove', tag));
        } catch (e) {}
        
        // Add new tags
        vals.forEach(val => {
          if (val && String(val).trim()) {
            try {
              jQuery(input).tagsinput('add', String(val).trim());
            } catch (e) {}
          }
        });
        
        try {
          jQuery(input).tagsinput('refresh');
        } catch (e) {}
        
        const finalTags = jQuery(input).tagsinput('items');
        input.value = vals.filter(v => v).map(v => String(v).trim()).join(',');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        
        return { success: true, method: 'tagsinput', finalValue: input.value };
      } else {
        // Fallback to direct value set
        const cleanVals = vals.filter(v => v).map(v => String(v).trim());
        input.value = cleanVals.join(',');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        
        return { success: true, method: 'direct', finalValue: input.value };
      }
    } catch (e) {
      return { success: false, reason: e.message };
    }
  }, selector, values.map(String));
  
  await wait(WAITS.afterFieldSet);
  
  if (!result.success) {
    log(`    ⚠️ Failed to set tags: ${result.reason}`);
  } else {
    log(`    ✓ Tags set via ${result.method}: ${result.finalValue}`);
  }
  
  return true;
}

/**
 * Fill date field with timezone adjustment
 */
async function fillDateInstant(page, selector, dateValue) {
  if (!dateValue) return true;
  
  await page.evaluate((sel, val) => {
    const el = document.querySelector(sel);
    if (!el) return;

    try {
      const parts = val.split('/');
      if (parts.length === 3) {
        let month = parseInt(parts[0], 10) - 1;
        let day = parseInt(parts[1], 10);
        let year = parseInt(parts[2], 10);
        
        // Add 1 day to compensate for server timezone
        day = day + 1;
        
        const testDate = new Date(year, month, day);
        if (testDate.getMonth() !== month) {
          month = testDate.getMonth();
          day = testDate.getDate();
          year = testDate.getFullYear();
        }
        
        const adjustedVal = `${String(month + 1).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`;
        const dateObj = new Date(year, month, day, 12, 0, 0, 0);
        
        // Set via datepicker if available
        if (typeof jQuery !== 'undefined') {
          try {
            const $el = jQuery(el);
            if ($el.data('datepicker')) {
              $el.datepicker('setDate', dateObj);
              $el.datepicker('hide');
              $el.datepicker('update');
            }
          } catch (e) {}
        }
        
        el.value = adjustedVal;
        el.setAttribute('value', adjustedVal);
        el.setAttribute('data-date', adjustedVal);
        
        ['input', 'change', 'blur'].forEach(eventType => {
          el.dispatchEvent(new Event(eventType, { bubbles: true }));
        });
      } else {
        el.value = val;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } catch (e) {}
  }, selector, dateValue);
  
  await wait(WAITS.afterFieldSet);
  return true;
}

/**
 * Enable all disabled fields
 */
async function enableAllFields(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.multipleLoadDisable, .singleLoadDisable').forEach(el => {
      el.removeAttribute('disabled');
      el.disabled = false;
      el.readOnly = false;
      el.classList.remove('multipleLoadDisable', 'singleLoadDisable');
    });
    
    const div = document.querySelector('#multipleLoad');
    if (div) {
      div.classList.remove('d-none');
      div.style.display = 'block';
    }
  });
}

/**
 * Fill a complete location set (pickup + delivery) - WITH RETRY
 */
async function fillLocationSet(page, pickup, delivery, pickupIndex, deliveryIndex, log) {
  // Fill pickup address first (needs autocomplete)
  if (pickup) {
    log(`  📦 Pickup [${pickupIndex}]: ${pickup.address.substring(0, 40)}...`);
    await fillAddressWithRetry(page, `input[name="pickup_location[${pickupIndex}]"]`, pickup.address, log);
    
    // Fill tags and date in parallel
    await Promise.all([
      fillTagsInstant(page, `input[name="pickup_number[${pickupIndex}]"]`, pickup.pickUp, log),
      fillDateInstant(page, `input[name="pickup_date[${pickupIndex}]"]`, pickup.date)
    ]);
    
    log(`  ✓ Pickup complete`);
  }

  // Fill delivery address
  if (delivery) {
    log(`  🚚 Delivery [${deliveryIndex}]: ${delivery.address.substring(0, 40)}...`);
    await fillAddressWithRetry(page, `input[name="drop_location[${deliveryIndex}]"]`, delivery.address, log);
    
    await Promise.all([
      fillTagsInstant(page, `input[name="drop_number[${deliveryIndex}]"]`, delivery.dropOff, log),
      fillDateInstant(page, `input[name="dropoff_date[${deliveryIndex}]"]`, delivery.date)
    ]);
    
    log(`  ✓ Delivery complete`);
  }
}

/**
 * Clone location data from one index to another
 */
async function cloneLocationData(page, fromIndex, toIndex, isPickup, log) {
  const locationType = isPickup ? 'pickup' : 'drop';
  const fieldNames = isPickup 
    ? ['pickup_location', 'pickup_lat', 'pickup_long', 'pickup_number', 'pickup_date']
    : ['drop_location', 'drop_lat', 'drop_long', 'drop_number', 'dropoff_date'];
  
  log(`  📋 Cloning ${locationType} from [${fromIndex}] to [${toIndex}]...`);
  
  await page.evaluate((fields, from, to) => {
    fields.forEach(fieldName => {
      const fromField = document.querySelector(`input[name="${fieldName}[${from}]"]`);
      const toField = document.querySelector(`input[name="${fieldName}[${to}]"]`);
      
      if (!fromField || !toField) return;
      
      toField.value = fromField.value;
      
      // Handle tagsinput
      if (fieldName.includes('number') && typeof jQuery !== 'undefined' && jQuery(fromField).data('tagsinput')) {
        const tags = jQuery(fromField).tagsinput('items');
        tags.forEach(tag => {
          try {
            jQuery(toField).tagsinput('add', tag);
          } catch (e) {}
        });
      }
      
      toField.dispatchEvent(new Event('input', { bubbles: true }));
      toField.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }, fieldNames, fromIndex, toIndex);
  
  log(`  ✓ Clone complete`);
}

/**
 * Add new pickup/delivery form and enable fields
 */
async function addNewLocationForm(page, expectedIndex, log) {
  log(`  ➕ Adding new form for index ${expectedIndex}...`);
  
  await page.evaluate((selector) => {
    document.querySelector(selector)?.click();
  }, SELECTORS.addMoreForm);
  
  await wait(WAITS.afterFormAdd);
  await enableAllFields(page);
  await wait(100);
  
  // Verify form was created
  const formExists = await page.evaluate((idx) => {
    const dropAddr = document.querySelector(`input[name="drop_location[${idx}]"]`);
    const pickupAddr = document.querySelector(`input[name="pickup_location[${idx}]"]`);
    return {
      dropExists: !!dropAddr,
      pickupExists: !!pickupAddr,
      dropVisible: dropAddr ? dropAddr.offsetParent !== null : false,
      pickupVisible: pickupAddr ? pickupAddr.offsetParent !== null : false
    };
  }, expectedIndex);
  
  if (!formExists.dropExists || !formExists.pickupExists) {
    log(`  ⚠️ Form fields not found, retrying...`);
    await wait(300);
    await page.evaluate((selector) => {
      document.querySelector(selector)?.click();
    }, SELECTORS.addMoreForm);
    await wait(WAITS.afterFormAdd);
    await enableAllFields(page);
    
    const retry = await page.evaluate((idx) => {
      return {
        dropExists: !!document.querySelector(`input[name="drop_location[${idx}]"]`),
        pickupExists: !!document.querySelector(`input[name="pickup_location[${idx}]"]`)
      };
    }, expectedIndex);
    
    if (!retry.dropExists || !retry.pickupExists) {
      throw new Error(`Failed to create form at index ${expectedIndex}`);
    }
  }
  
  log(`  ✓ Form added`);
}

/**
 * Get the calculated index for pickup/delivery pairs
 * QuikSkope uses: 0, 2, 3, 4, 5, ... (skips 1)
 */
function getLocationIndex(i) {
  return i === 0 ? 0 : i === 1 ? 2 : i + 1;
}

/**
 * Main form fill orchestration
 */
async function fillForm(page, data, log) {
  const formStart = Date.now();
  log("=== FORM FILL START ===");
  
  // Normalize: ensure all locations have fallback numbers
  data.pickups.forEach(p => {
    if (!p.pickUp?.length) p.pickUp = [data.loadNumber];
  });
  
  data.deliveries.forEach(d => {
    if (!d.dropOff?.length) d.dropOff = [data.loadNumber];
  });
  
  log(`Pickups: ${data.pickups.length}, Deliveries: ${data.deliveries.length}`);
  
  // Clear existing location data
  await clearAllLocationFields(page, log);
  
  // ==========================================
  // STEP 1: Basic Info (parallel fill)
  // ==========================================
  log("STEP 1: Basic Info");
  const digitsOnly = data.driver.phone.replace(/\D/g, '');
  const formattedPhone = digitsOnly.length === 10 ? digitsOnly : `1${digitsOnly}`;
  
  await Promise.all([
    fillFieldInstant(page, SELECTORS.loadNumber, data.loadNumber),
    fillFieldInstant(page, SELECTORS.driverName, data.driver.name),
    fillFieldInstant(page, SELECTORS.driverPhone, formattedPhone),
    fillFieldInstant(page, SELECTORS.carrierName, data.company.name),
    fillFieldInstant(page, SELECTORS.carrierMC, data.company.mc),
    fillFieldInstant(page, SELECTORS.carrierDOT, data.company.usdot)
  ]);
  
  log(`✓ Basic info filled`);
  
  // ==========================================
  // STEP 2: Mode Selection
  // ==========================================
  const isMultiple = data.pickups.length > 1 || data.deliveries.length > 1;
  log(`STEP 2: Mode - ${isMultiple ? 'Multiple' : 'Single'}`);
  
  if (isMultiple) {
    await page.evaluate((selector) => {
      document.querySelector(selector)?.click();
    }, SELECTORS.multipleLoadBtn);
    await wait(200);
    await enableAllFields(page);
    log(`✓ Multiple mode enabled`);
  }
  
  // ==========================================
  // STEP 3: Fill Locations
  // ==========================================
  log("STEP 3: Filling locations");
  
  if (!isMultiple) {
    // Single pickup → single delivery
    await fillLocationSet(page, data.pickups[0], data.deliveries[0], 0, 0, log);
  } else {
    // Determine scenario
    const singlePickupMultiDrop = data.pickups.length === 1 && data.deliveries.length > 1;
    const multiPickupSingleDrop = data.pickups.length > 1 && data.deliveries.length === 1;
    
    if (singlePickupMultiDrop) {
      // One pickup, multiple deliveries
      log(`  Mode: 1 Pickup → ${data.deliveries.length} Deliveries`);
      
      // Fill first pickup
      await fillLocationSet(page, data.pickups[0], null, 0, 0, log);
      
      // Fill deliveries incrementally
      for (let i = 0; i < data.deliveries.length; i++) {
        const deliveryIndex = getLocationIndex(i);
        
        if (i > 0) {
          await addNewLocationForm(page, deliveryIndex, log);
          
          // Clone pickup via checkbox
          await page.evaluate((selector) => {
            const checkbox = document.querySelector(selector);
            if (checkbox && !checkbox.checked) {
              checkbox.click();
              checkbox.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }, SELECTORS.clonePickupCheckbox);
          
          await wait(300);
          
          // Verify clone worked, fallback to manual if needed
          const cloneWorked = await page.evaluate((idx) => {
            const pickup0 = document.querySelector(`input[name="pickup_location[0]"]`)?.value || '';
            const pickupN = document.querySelector(`input[name="pickup_location[${idx}]"]`)?.value || '';
            return pickup0 === pickupN && pickupN.length > 0;
          }, deliveryIndex);
          
          if (!cloneWorked) {
            log(`  ⚠️ Checkbox clone failed, manual copy...`);
            await cloneLocationData(page, 0, deliveryIndex, true, log);
          }
        }
        
        await fillLocationSet(page, null, data.deliveries[i], 0, deliveryIndex, log);
      }
      
    } else if (multiPickupSingleDrop) {
      // Multiple pickups, one delivery
      log(`  Mode: ${data.pickups.length} Pickups → 1 Delivery`);
      
      // Fill delivery first (for cloning)
      await fillLocationSet(page, null, data.deliveries[0], 0, 0, log);
      
      // Fill pickups incrementally
      for (let i = 0; i < data.pickups.length; i++) {
        const pickupIndex = getLocationIndex(i);
        
        if (i > 0) {
          await addNewLocationForm(page, pickupIndex, log);
          
          // Clone delivery via checkbox
          await page.evaluate((selector) => {
            const checkbox = document.querySelector(selector);
            if (checkbox && !checkbox.checked) {
              checkbox.click();
              checkbox.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }, SELECTORS.cloneDropCheckbox);
          
          await wait(300);
          
          const cloneWorked = await page.evaluate((idx) => {
            const drop0 = document.querySelector(`input[name="drop_location[0]"]`)?.value || '';
            const dropN = document.querySelector(`input[name="drop_location[${idx}]"]`)?.value || '';
            return drop0 === dropN && dropN.length > 0;
          }, pickupIndex);
          
          if (!cloneWorked) {
            log(`  ⚠️ Checkbox clone failed, manual copy...`);
            await cloneLocationData(page, 0, pickupIndex, false, log);
          }
        }
        
        await fillLocationSet(page, data.pickups[i], null, pickupIndex, 0, log);
      }
      
    } else {
      // Multiple pickups AND multiple deliveries
      log(`  Mode: ${data.pickups.length} Pickups & ${data.deliveries.length} Deliveries`);
      
      const maxCount = Math.max(data.pickups.length, data.deliveries.length);
      
      for (let i = 0; i < maxCount; i++) {
        const pairIndex = getLocationIndex(i);
        
        if (i > 0) {
          await addNewLocationForm(page, pairIndex, log);
        }
        
        const pickup = data.pickups[i] || null;
        const delivery = data.deliveries[i] || null;
        
        if (pickup && delivery) {
          await fillLocationSet(page, pickup, delivery, pairIndex, pairIndex, log);
        } else if (pickup) {
          // Clone last delivery
          const lastDeliveryIndex = await page.evaluate(() => {
            for (let idx = 19; idx >= 0; idx--) {
              const drop = document.querySelector(`input[name="drop_location[${idx}]"]`);
              if (drop && drop.value && drop.value.trim()) return idx;
            }
            return 0;
          });
          
          await cloneLocationData(page, lastDeliveryIndex, pairIndex, false, log);
          await fillLocationSet(page, pickup, null, pairIndex, pairIndex, log);
        } else if (delivery) {
          // Clone last pickup
          const lastPickupIndex = await page.evaluate(() => {
            for (let idx = 19; idx >= 0; idx--) {
              const pickup = document.querySelector(`input[name="pickup_location[${idx}]"]`);
              if (pickup && pickup.value && pickup.value.trim()) return idx;
            }
            return 0;
          });
          
          await cloneLocationData(page, lastPickupIndex, pairIndex, true, log);
          await fillLocationSet(page, null, delivery, pairIndex, pairIndex, log);
        }
      }
    }
  }
  
  log(`✓ All locations filled`);
  
  // ==========================================
  // STEP 4: Save & Confirm
  // ==========================================
  log("STEP 4: Saving");
  
  // Clean up form
  await page.evaluate(() => {
    // Remove error messages
    document.querySelectorAll('.text-danger, .invalid-feedback').forEach(el => el.remove());
    
    // Mark all as valid
    document.querySelectorAll('input').forEach(el => {
      el.style.border = '';
      el.classList.remove('is-invalid');
      el.classList.add('is-valid');
    });
    
    // Remove empty location sets
    for (let i = 0; i < 10; i++) {
      const pickupAddr = document.querySelector(`input[name="pickup_location[${i}]"]`);
      const dropAddr = document.querySelector(`input[name="drop_location[${i}]"]`);
      
      if (!pickupAddr?.value.trim() && !dropAddr?.value.trim()) {
        ['pickup_location', 'pickup_lat', 'pickup_long', 'pickup_number', 'pickup_date',
         'drop_location', 'drop_lat', 'drop_long', 'drop_number', 'dropoff_date'].forEach(fieldName => {
          document.querySelectorAll(`input[name="${fieldName}[${i}]"]`).forEach(f => f.remove());
        });
      }
    }
    
    // Disable form validation
    const form = document.querySelector('form');
    if (form) form.noValidate = true;
  });
  
  // Click save
  try {
    await page.waitForSelector(SELECTORS.saveBtn, { visible: true, timeout: TIMEOUTS.short });
    await page.click(SELECTORS.saveBtn);
    await wait(1500);
    log(`✓ Save clicked`);
  } catch (error) {
    log(`❌ Save error: ${error.message}`);
    return { success: false, error: true, errorMessage: 'Save button not found' };
  }
  
  // Check for toast errors immediately
  const toastError = await checkForToastError(page);
  if (toastError.found) {
    log(`🚨 Toast error: ${toastError.message}`);
    return {
      success: false,
      error: true,
      errorMessage: toastError.message,
      errorType: 'toast_error',
      loadNumber: data.loadNumber
    };
  }
  
  // ==========================================
  // STEP 5: First Confirmation (has QS bug)
  // ==========================================
  log("STEP 5: First confirmation");
  
  // Wait for modal
  let modalReady = false;
  for (let i = 0; i < 20; i++) {
    const state = await page.evaluate((modalSel, btnSel) => {
      const modal = document.querySelector(modalSel);
      const btn = document.querySelector(btnSel);
      const modalVisible = modal ? (
        modal.classList.contains('show') ||
        modal.style.display === 'block' ||
        modal.getAttribute('aria-modal') === 'true' ||
        (modal.offsetParent !== null && window.getComputedStyle(modal).display !== 'none')
      ) : false;
      const buttonReady = btn ? (!btn.disabled && (btn.offsetParent !== null || btn.offsetWidth > 0)) : false;
      return { modalVisible, buttonReady };
    }, SELECTORS.confirmModal, SELECTORS.confirmBtn);

    if (state.modalVisible && state.buttonReady) {
      modalReady = true;
      break;
    }

    await wait(WAITS.modalCheck);
  }
  
  if (!modalReady) {
    // Check for late toast error
    const lateToast = await checkForToastError(page);
    if (lateToast.found) {
      return {
        success: false,
        error: true,
        errorMessage: lateToast.message,
        errorType: 'toast_error',
        loadNumber: data.loadNumber
      };
    }
    throw new Error('Confirm modal did not appear');
  }
  
  // Click confirm (first save - has QS bug)
  await page.evaluate((selector) => {
    const btn = document.querySelector(selector);
    if (btn) {
      btn.disabled = false;
      btn.click();
    }
  }, SELECTORS.confirmBtn);
  
  await Promise.race([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {}),
    wait(3000)
  ]);
  
  log(`✓ First save complete (QS bug present)`);
  
  // Check for toast after first save
  const toastAfterFirst = await checkForToastError(page);
  if (toastAfterFirst.found) {
    return {
      success: false,
      error: true,
      errorMessage: toastAfterFirst.message,
      errorType: 'toast_error',
      loadNumber: data.loadNumber
    };
  }
  
  // ==========================================
  // STEP 6: Second Save (QS bug workaround)
  // ==========================================
  log("STEP 6: Second save (QS workaround)");
  
  // Navigate back to Load Order
  await page.goto("https://quikskope.com/customer/load-order", {
    waitUntil: "domcontentloaded",
    timeout: TIMEOUTS.navigation
  });
  await wait(1000);
  
  // Check if load was already successfully created (appears in the table)
  const loadAlreadyExists = await page.evaluate((loadNum) => {
    // Check if we're on the load order page with the DataTable
    const table = document.querySelector('#loadOrderListTable');
    if (!table) return false;
    
    // Search for the load number in the table
    const rows = table.querySelectorAll('tbody tr');
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      for (const cell of cells) {
        if (cell.textContent.includes(loadNum)) {
          return true;
        }
      }
    }
    return false;
  }, data.loadNumber);
  
  if (loadAlreadyExists) {
    const totalDuration = Date.now() - formStart;
    log(`✓ Load already exists in system - COMPLETE (${totalDuration}ms)`);
    
    return {
      success: true,
      loadNumber: data.loadNumber,
      alreadySaved: true,
      duration: totalDuration
    };
  }
  
  // Click Create Load again
  await page.waitForSelector(SELECTORS.createLoadBtn, { timeout: 5000 });
  await Promise.race([
    page.click(SELECTORS.createLoadBtn).then(() =>
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => {})
    ),
    wait(500).then(() =>
      page.evaluate((selector) => document.querySelector(selector)?.click(), SELECTORS.createLoadBtn)
    )
  ]).catch(() => {});
  
  await wait(WAITS.pageStabilize);
  
  // Verify form still has data
  const formHasData = await page.evaluate(() => {
    const loadNum = document.querySelector('input[name="load_number"]')?.value || '';
    const driverName = document.querySelector('input[name="driver_name"]')?.value || '';
    return loadNum.length > 0 && driverName.length > 0;
  });
  
  if (!formHasData) {
    log('⚠️ Form data lost - but may have already been saved!');
    
    // Double-check if load exists before failing
    await page.goto("https://quikskope.com/customer/load-order", {
      waitUntil: "domcontentloaded",
      timeout: TIMEOUTS.navigation
    });
    await wait(1000);
    
    const loadExistsAfterCheck = await page.evaluate((loadNum) => {
      const table = document.querySelector('#loadOrderListTable');
      if (!table) return false;
      const rows = table.querySelectorAll('tbody tr');
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        for (const cell of cells) {
          if (cell.textContent.includes(loadNum)) {
            return true;
          }
        }
      }
      return false;
    }, data.loadNumber);
    
    if (loadExistsAfterCheck) {
      const totalDuration = Date.now() - formStart;
      log(`✓ Load verified in system - COMPLETE (${totalDuration}ms)`);
      
      return {
        success: true,
        loadNumber: data.loadNumber,
        alreadySaved: true,
        duration: totalDuration
      };
    }
  }
  
  // Click save again
  await page.waitForSelector(SELECTORS.saveBtn, { visible: true, timeout: 3000 });
  await page.click(SELECTORS.saveBtn);
  await wait(1500);
  
  // Check for toast after second save
  const toastAfterSecond = await checkForToastError(page);
  if (toastAfterSecond.found) {
    return {
      success: false,
      error: true,
      errorMessage: toastAfterSecond.message,
      errorType: 'toast_error',
      loadNumber: data.loadNumber
    };
  }
  
  // Wait for second modal
  let secondModalReady = false;
  for (let i = 0; i < 20; i++) {
    const state = await page.evaluate((modalSel, btnSel) => {
      const modal = document.querySelector(modalSel);
      const btn = document.querySelector(btnSel);
      const modalVisible = modal ? (
        modal.classList.contains('show') ||
        modal.style.display === 'block' ||
        modal.getAttribute('aria-modal') === 'true' ||
        (modal.offsetParent !== null && window.getComputedStyle(modal).display !== 'none')
      ) : false;
      const buttonReady = btn ? (!btn.disabled && (btn.offsetParent !== null || btn.offsetWidth > 0)) : false;
      return { modalVisible, buttonReady };
    }, SELECTORS.confirmModal, SELECTORS.confirmBtn);

    if (state.modalVisible && state.buttonReady) {
      secondModalReady = true;
      break;
    }

    await wait(WAITS.modalCheck);
  }
  
  if (!secondModalReady) {
    const toastFinal = await checkForToastError(page);
    if (toastFinal.found) {
      return {
        success: false,
        error: true,
        errorMessage: toastFinal.message,
        errorType: 'toast_error',
        loadNumber: data.loadNumber
      };
    }
    throw new Error('Second confirm modal did not appear');
  }
  
  // Final confirm (this one actually works)
  await page.evaluate((selector) => {
    const btn = document.querySelector(selector);
    if (btn) {
      btn.disabled = false;
      btn.click();
    }
  }, SELECTORS.confirmBtn);
  
  await Promise.race([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 4000 }).catch(() => {}),
    wait(4000)
  ]);
  
  // Final toast check
  const toastAfterConfirm = await checkForToastError(page);
  if (toastAfterConfirm.found) {
    return {
      success: false,
      error: true,
      errorMessage: toastAfterConfirm.message,
      errorType: 'toast_error',
      loadNumber: data.loadNumber
    };
  }
  
  const totalDuration = Date.now() - formStart;
  log(`✓ COMPLETE (${totalDuration}ms)`);
  
  return { success: true };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let browser;
  const start = Date.now();
  const logs = [];
  
  const log = (message) => {
    logs.push({ time: new Date().toISOString(), message });
    console.log(message);
  };
  
  try {
    const QS_USERNAME = process.env.QS_USERNAME;
    const QS_PASSWORD = process.env.QS_PASSWORD;
    const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;
    
    if (!QS_USERNAME || !QS_PASSWORD) {
      throw new Error("Missing credentials");
    }
    
    // Parse incoming data
    const data = parseZapierData(req.body);
    
    log(`Load: ${data.loadNumber}`);
    log(`Driver: ${data.driver.name} (${data.driver.phone})`);
    log(`Company: ${data.company.name} (MC: ${data.company.mc}, DOT: ${data.company.usdot})`);
    log(`Pickups: ${data.pickups.length}, Deliveries: ${data.deliveries.length}`);
    
    // Validate required fields
    if (!data.loadNumber || !data.driver.name || !data.pickups.length || !data.deliveries.length) {
      return res.status(400).json({
        error: 'Missing required fields',
        logs
      });
    }
    
    // Launch browser
    if (BROWSERLESS_TOKEN) {
      browser = await puppeteer.connect({
        browserWSEndpoint: `wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}&stealth&blockAds`,
        defaultViewport: null
      });
      log('Connected to Browserless');
    } else {
      browser = await puppeteer.launch({
        args: chromium.args.concat([
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding'
        ]),
        headless: true,
        executablePath: await chromium.executablePath()
      });
      log('Launched browser');
    }
    
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(TIMEOUTS.navigation);
    await page.setDefaultTimeout(TIMEOUTS.selector);
    
    // Auto-accept dialogs
    page.on('dialog', async dialog => {
      log(`🔔 Alert: "${dialog.message()}"`);
      await dialog.accept();
    });
    
    // Block unnecessary resources
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['document', 'script', 'xhr', 'fetch'].includes(type)) {
        req.continue();
      } else {
        req.abort();
      }
    });
    
    await page.setViewport({ width: 1280, height: 720 });
    
    // ==========================================
    // Login
    // ==========================================
    log("Logging in...");
    await page.goto("https://quikskope.com/platform", {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    const isLoggedIn = await page.evaluate(() => {
      return !!(document.querySelector("nav") || document.body.textContent.includes("logout"));
    }).catch(() => false);

    if (!isLoggedIn) {
      await page.waitForSelector('#adminLoginForm', { timeout: TIMEOUTS.selector });
      await page.evaluate((user, pass) => {
        document.querySelector('input#email').value = user;
        document.querySelector('input#password').value = pass;
        document.querySelector('#loginInBtn').click();
      }, QS_USERNAME, QS_PASSWORD);

      await page.waitForNavigation({
        timeout: 15000,
        waitUntil: "domcontentloaded"
      });
      log("✓ Logged in");
    } else {
      log("✓ Already logged in");
    }

    await wait(WAITS.pageStabilize);

    // ==========================================
    // Navigate to Create Load
    // ==========================================
    log("Navigating to Load Order...");
    await page.goto("https://quikskope.com/customer/load-order", {
      waitUntil: "domcontentloaded",
      timeout: TIMEOUTS.navigation
    });
    
    await wait(2000);
    log("✓ On Load Order page");
    
    log("Clicking Create Load...");
    try {
      await page.waitForSelector(SELECTORS.createLoadBtn, { visible: true, timeout: 3000 });
      
      await Promise.race([
        page.click(SELECTORS.createLoadBtn).then(() =>
          page.waitForNavigation({
            waitUntil: "domcontentloaded",
            timeout: 8000
          }).catch(() => {})
        ),
        wait(500).then(() =>
          page.evaluate((selector) => document.querySelector(selector)?.click(), SELECTORS.createLoadBtn)
        )
      ]).catch(() => {});
      
      log("✓ Create Load clicked");
    } catch (error) {
      log(`⚠️ Button click failed, navigating directly...`);
      await page.goto("https://quikskope.com/customer/create-load", {
        waitUntil: "domcontentloaded",
        timeout: TIMEOUTS.navigation
      });
    }

    await wait(2000);
    
    // ==========================================
    // Fill Form
    // ==========================================
    log("Waiting for form...");
    await page.waitForSelector(SELECTORS.loadNumber, { timeout: 10000 });
    await wait(300);
    log("✓ Form ready");
    
    log("Filling form...");
    const fillResult = await fillForm(page, data, log);

    // Handle errors
    if (!fillResult.success) {
      if (fillResult.error) {
        const duration = Date.now() - start;
        return res.status(200).json({
          success: false,
          error: true,
          loadNumber: data.loadNumber,
          duration,
          message: `Error: ${fillResult.errorMessage}`,
          errorMessage: fillResult.errorMessage,
          errorType: fillResult.errorType,
          logs,
          toastAlert: fillResult.errorMessage
        });
      }
      
      return res.status(500).json({
        error: 'Form fill failed',
        logs
      });
    }

    // Success
    const duration = Date.now() - start;
    log(`✅ SUCCESS - ${duration}ms`);
    
    return res.status(200).json({
      success: true,
      loadNumber: data.loadNumber,
      duration,
      message: `Load ${data.loadNumber} submitted successfully`,
      logs,
      toastAlert: null
    });

  } catch (error) {
    log(`❌ ERROR: ${error.message}`);
    
    return res.status(500).json({
      error: error.message,
      stack: error.stack,
      logs
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