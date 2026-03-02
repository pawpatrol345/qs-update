import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Enhanced parseZapierData function with flexible driver name parsing

function parseZapierData(zapierData) {
  // Utility function to parse and normalize driver name
  const parseDriverName = (str) => {
    if (!str) return '';
    
    // Convert to string and trim
    let name = String(str).trim();
    if (!name) return '';
    
    // Remove extra whitespace (multiple spaces to single space)
    name = name.replace(/\s+/g, ' ');
    
    // Handle comma-separated format (e.g., "PETIT, SAMSON" or "petit, samson")
    if (name.includes(',')) {
      const parts = name.split(',').map(part => part.trim()).filter(part => part);
      // Reverse order: "PETIT, SAMSON" becomes "SAMSON PETIT"
      name = parts.reverse().join(' ');
    }
    
    // Normalize to Title Case (First letter uppercase, rest lowercase)
    name = name.split(' ')
      .map(word => {
        if (!word) return '';
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(' ');
    
    return name;
  };

  // Parse array for addresses 
  const parseArr = (str) => {
    if (!str) return [];
    if (Array.isArray(str)) return str.map(n => String(n));
   
    const strVal = String(str).trim();
   
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
      
      if (addresses.length > 0) {
        return addresses;
      }
    }
   
    return [strVal].filter(n => n);
  };
 
  const parseArrMultiple = (str) => {
    if (!str) return [];
    if (Array.isArray(str)) return str.map(n => String(n));
    
    if (typeof str === 'object' && str !== null && !Array.isArray(str)) {
      console.log('📋 Parsing object:', JSON.stringify(str));
      const keys = Object.keys(str).sort((a, b) => parseInt(a) - parseInt(b));
      const values = keys.map(key => String(str[key])).filter(n => n && n.trim());
      console.log('  → Extracted values:', values);
      return values;
    }
    
    return String(str).split(',').map(n => n.trim()).filter(n => n);
  };
 
  // Extract raw driver name from various possible fields
  const rawDriverName = zapierData.driverName || 
                        zapierData.driver_name || 
                        zapierData.driver || 
                        zapierData["8. Data Driver Name"] ||
                        '';
  
  // Parse and normalize the driver name
  const normalizedDriverName = parseDriverName(rawDriverName);
  
  console.log(`📝 Driver Name Parsing:`);
  console.log(`  Raw: "${rawDriverName}"`);
  console.log(`  Normalized: "${normalizedDriverName}"`);
 
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

  const pickupAddrs = parseArr(zapierData.pickUp || zapierData.pickup || zapierData.pickup_address || zapierData["8. Data Pickups Address"]);
  const pickupDates = parseArrMultiple(zapierData.pickUpDate || zapierData.pickup_date || zapierData["8. Data Pickups Date"]);
  const pickupNums = parseArrMultiple(zapierData.pickUpNumber || zapierData.pickup_numbers || zapierData.pickup_number || zapierData["8. Data Pickups Po Numbers"]);

  console.log('📦 Pickup Numbers Parsed:', pickupNums);

  // Remove duplicate addresses
  const uniquePickupAddrs = [];
  const seenPickups = new Set();
 
  pickupAddrs.forEach((addr, i) => {
    const normalizedAddr = addr.trim().toUpperCase().replace(/,\s+USA$/, '');
    if (!seenPickups.has(normalizedAddr)) {
      seenPickups.add(normalizedAddr);
      uniquePickupAddrs.push({ addr, index: i });
    }
  });

  // Assign all pickup numbers
  if (uniquePickupAddrs.length > 0) {
    uniquePickupAddrs.forEach(({ addr, index }, i) => {
      // First pickup gets ALL numbers, rest get fallback
      const nums = i === 0 && pickupNums.length > 0 
        ? pickupNums 
        : [data.loadNumber];
      
      console.log(`  Pickup ${i + 1} assigned numbers:`, nums);
      
      data.pickups.push({
        address: addr.trim().toUpperCase().endsWith(', USA') ? addr : `${addr}, USA`,
        date: pickupDates[index] || pickupDates[0] || '',
        pickUp: nums.filter(n => n)
      });
    });
  }

  const deliveryAddrs = parseArr(zapierData.deliveries || zapierData.delivery || zapierData.delivery_address || zapierData["8. Data Deliveries Address"]);
  const deliveryDates = parseArrMultiple(zapierData.deliveriesDate || zapierData.delivery_date || zapierData["8. Data Deliveries Date"]);
  const deliveryNums = parseArrMultiple(zapierData.dropOffNumber || zapierData.delivery_numbers || zapierData.dropoff_number || zapierData["8. Data Deliveries Del Numbers"]);

  console.log('🚚 Delivery Numbers Parsed:', deliveryNums);

  const uniqueDeliveryAddrs = [];
  const seenDeliveries = new Set();
 
  deliveryAddrs.forEach((addr, i) => {
    const normalizedAddr = addr.trim().toUpperCase().replace(/,\s+USA$/, '');
    if (!seenDeliveries.has(normalizedAddr)) {
      seenDeliveries.add(normalizedAddr);
      uniqueDeliveryAddrs.push({ addr, index: i });
    }
  });

  // Distribute delivery numbers 
  if (uniqueDeliveryAddrs.length > 0) {
    const numsPerDelivery = Math.ceil(deliveryNums.length / uniqueDeliveryAddrs.length);
    console.log(`  Numbers per delivery: ${numsPerDelivery} (${deliveryNums.length} total / ${uniqueDeliveryAddrs.length} deliveries)`);
    
    uniqueDeliveryAddrs.forEach(({ addr, index }, i) => {
      const startIdx = i * numsPerDelivery;
      const endIdx = startIdx + numsPerDelivery;
      let nums = deliveryNums.slice(startIdx, endIdx);
      
      console.log(`  Delivery ${i + 1} assigned numbers [${startIdx}-${endIdx}):`, nums);
      
      // Fallback to load number if empty
      if (!nums || nums.length === 0 || nums.every(n => !n)) {
        nums = [data.loadNumber];
      }
      
      data.deliveries.push({
        address: addr.trim().toUpperCase().endsWith(', USA') ? addr : `${addr}, USA`,
        date: deliveryDates[index] || deliveryDates[0] || '',
        dropOff: nums.filter(n => n)
      });
    });
  }
 
  return data;
}

// form filling functions

// Clear all existing location fields before filling
async function clearAllLocationFields(page, log) {
  log('  🧹 Clearing all existing location fields...');
 
  await page.evaluate(() => {
    for (let i = 0; i < 10; i++) {
      const pickupAddr = document.querySelector(`input[name="pickup_location[${i}]"]`);
      const pickupNum = document.querySelector(`input[name="pickup_number[${i}]"]`);
      const pickupDate = document.querySelector(`input[name="pickup_date[${i}]"]`);
      const pickupLat = document.querySelector(`input[name="pickup_lat[${i}]"]`);
      const pickupLong = document.querySelector(`input[name="pickup_long[${i}]"]`);
     
      if (pickupAddr) pickupAddr.value = '';
      if (pickupNum) {
        if (typeof jQuery !== 'undefined' && jQuery(pickupNum).data('tagsinput')) {
          try {
            const tags = jQuery(pickupNum).tagsinput('items');
            tags.forEach(tag => jQuery(pickupNum).tagsinput('remove', tag));
          } catch (e) {}
        }
        pickupNum.value = '';
      }
      if (pickupDate) pickupDate.value = '';
      if (pickupLat) pickupLat.value = '';
      if (pickupLong) pickupLong.value = '';
    }
   
    for (let i = 0; i < 10; i++) {
      const dropAddr = document.querySelector(`input[name="drop_location[${i}]"]`);
      const dropNum = document.querySelector(`input[name="drop_number[${i}]"]`);
      const dropDate = document.querySelector(`input[name="dropoff_date[${i}]"]`);
      const dropLat = document.querySelector(`input[name="drop_lat[${i}]"]`);
      const dropLong = document.querySelector(`input[name="drop_long[${i}]"]`);
     
      if (dropAddr) dropAddr.value = '';
      if (dropNum) {
        if (typeof jQuery !== 'undefined' && jQuery(dropNum).data('tagsinput')) {
          try {
            const tags = jQuery(dropNum).tagsinput('items');
            tags.forEach(tag => jQuery(dropNum).tagsinput('remove', tag));
          } catch (e) {}
        }
        dropNum.value = '';
      }
      if (dropDate) dropDate.value = '';
      if (dropLat) dropLat.value = '';
      if (dropLong) dropLong.value = '';
    }
  });
 
  log('  ✓ All fields cleared');
}

// field fill - no waits
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

async function fillAddressInstant(page, selector, value, log) {
  const startTime = Date.now();
  log(`  🏠 Filling address: ${selector.substring(0, 40)}...`);
 
  try {
    await page.waitForSelector(selector, { timeout: 1000 });
  } catch (e) {
    log(`  ❌ Field not found: ${selector}`);
    throw new Error(`Field not found: ${selector}`);
  }
 
  await page.evaluate((sel, val) => {
    const el = document.querySelector(sel);
    if (el) {
      el.disabled = false;
      el.removeAttribute('disabled');
      el.classList.remove('multipleLoadDisable', 'singleLoadDisable');
      el.readOnly = false;
      el.focus();
    }
  }, selector, value);

  await page.type(selector, value, { delay: 2 });
  await wait(50);
 
  const hasAutocomplete = await page.evaluate(() => {
    const pac = document.querySelector('.pac-container:not(.pac-container-hidden)');
    const items = pac ? pac.querySelectorAll('.pac-item') : [];
    return { found: items.length > 0, count: items.length };
  });
 
  log(`  📍 Autocomplete: ${hasAutocomplete.found ? `Found ${hasAutocomplete.count} items` : 'None'}`);
 
  // Quick autocomplete selection
  await page.keyboard.press('ArrowDown');
  await wait(20); 
  await page.keyboard.press('Enter');
  await wait(50);
 
  const duration = Date.now() - startTime;
  log(`  ✓ Address filled in ${duration}ms`);
 
  return true;
}

// tag fill 
async function fillTagsInstant(page, selector, values, log) {
  if (!values || values.length === 0) return true;

  const result = await page.evaluate((sel, vals) => {
    try {
      const input = document.querySelector(sel);
      if (!input) {
        console.log(`Tag input not found: ${sel}`);
        return { success: false, reason: 'input not found' };
      }
     
      input.disabled = false;
      input.removeAttribute('disabled');
      input.classList.remove('multipleLoadDisable', 'singleLoadDisable');
      input.style.display = '';

      if (typeof jQuery !== 'undefined' && jQuery(input).data('tagsinput')) {
        try {
          const existingTags = jQuery(input).tagsinput('items');
          existingTags.forEach(tag => jQuery(input).tagsinput('remove', tag));
        } catch (e) {
          console.log('Error clearing existing tags:', e);
        }
       
        // Add new tags
        vals.forEach(val => {
          if (val && String(val).trim()) {
            try {
              jQuery(input).tagsinput('add', String(val).trim());
            } catch (e) {
              console.log('Error adding tag:', val, e);
            }
          }
        });
       
        // Force refresh the tagsinput to sync with hidden input
        try {
          jQuery(input).tagsinput('refresh');
        } catch (e) {}
       
        // Verify tags were added
        const finalTags = jQuery(input).tagsinput('items');
       
        input.value = vals.filter(v => v).map(v => String(v).trim()).join(',');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
       
        console.log(`Set tags for ${sel}: ${vals.join(',')} | Final tags: ${finalTags.join(',')} | Input value: ${input.value}`);
        return { success: true, method: 'tagsinput', finalValue: input.value };
      } else {
        // Fallback to direct value set
        const cleanVals = vals.filter(v => v).map(v => String(v).trim());
        input.value = cleanVals.join(',');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
       
        console.log(`Set tags for ${sel}: ${cleanVals.join(',')} | Final value: ${input.value}`);
        return { success: true, method: 'direct', finalValue: input.value };
      }
    } catch (e) {
      console.error(`Error setting tags for ${sel}:`, e);
      return { success: false, reason: e.message };
    }
  }, selector, values.map(String));
 
  await wait(50); 
 
  // Log the result for debugging
  if (!result.success) {
    log(`    ⚠️ Failed to set tags for ${selector}: ${result.reason}`);
  } else {
    log(`    ✓ Tags set for ${selector} via ${result.method}: ${result.finalValue}`);
  }
 
  return true;
}

// date fill 
async function fillDateInstant(page, selector, dateValue) {
  if (!dateValue) return true;
 
  const result = await page.evaluate((sel, val) => {
    const el = document.querySelector(sel);
    if (!el) return { success: false, reason: 'Element not found' };

    try {
      // date string
      const parts = val.split('/');
      if (parts.length === 3) {
        let month = parseInt(parts[0], 10) - 1; 
        let day = parseInt(parts[1], 10);
        let year = parseInt(parts[2], 10);
       
        day = day + 1;
       
        const testDate = new Date(year, month, day);
        if (testDate.getMonth() !== month) {
          month = testDate.getMonth();
          day = testDate.getDate();
          year = testDate.getFullYear();
        }
       
        // Create the adjusted date string
        const adjustedVal = `${String(month + 1).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`;
       
        console.log(`Date adjustment for ${val}:`, {
          original: val,
          adjusted: adjustedVal,
          reason: 'Adding 1 day to compensate for server timezone shift'
        });
       
        // Create date object for datepicker
        const dateObj = new Date(year, month, day, 12, 0, 0, 0);
       
        if (typeof jQuery !== 'undefined') {
          try {
            const $el = jQuery(el);
            if ($el.data('datepicker')) {
              $el.datepicker('setDate', dateObj);
              $el.datepicker('hide');
              $el.datepicker('update');
            }
          } catch (e) {
            console.log('Datepicker method failed:', e);
          }
        }
     
        el.value = adjustedVal;
        el.setAttribute('value', adjustedVal);
        el.setAttribute('data-date', adjustedVal);
       
        // Trigger all events
        ['input', 'change', 'blur'].forEach(eventType => {
          el.dispatchEvent(new Event(eventType, { bubbles: true }));
        });
       
        const finalValue = el.value;
        console.log(`Date set for ${sel}: original="${val}", adjusted="${adjustedVal}", actual="${finalValue}"`);
       
        return { success: true, finalValue, adjusted: adjustedVal };
      }
     
      // Fallback if parsing fails
      el.value = val;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true, finalValue: val };
     
    } catch (e) {
      return { success: false, reason: e.message };
    }
  }, selector, dateValue);
 
  await wait(50);
 
  return result.success;
}

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

// entire location set
async function fillLocationSetBatch(page, pickup, delivery, pickupIndex, deliveryIndex, log) {
  // pickup address first (needs autocomplete)
  if (pickup) {
    log(`  📦 Pickup [${pickupIndex}]: ${pickup.address.substring(0, 40)}...`);
    await fillAddressInstant(page, `input[name="pickup_location[${pickupIndex}]"]`, pickup.address, log);
    // tags and date 
    log(`  🏷️  Filling pickup tags (${pickup.pickUp.join(',')}) & date (${pickup.date})...`);
    await Promise.all([
      fillTagsInstant(page, `input[name="pickup_number[${pickupIndex}]"]`, pickup.pickUp, log),
      fillDateInstant(page, `input[name="pickup_date[${pickupIndex}]"]`, pickup.date)
    ]);
    log(`  ✓ Pickup complete`);
  }

  // delivery address 
  if (delivery) {
    log(`  🚚 Delivery [${deliveryIndex}]: ${delivery.address.substring(0, 40)}...`);
    await fillAddressInstant(page, `input[name="drop_location[${deliveryIndex}]"]`, delivery.address, log);

    log(`  🏷️  Filling delivery tags (${delivery.dropOff.join(',')}) & date (${delivery.date})...`);
   
    await Promise.all([
      fillTagsInstant(page, `input[name="drop_number[${deliveryIndex}]"]`, delivery.dropOff, log),
      fillDateInstant(page, `input[name="dropoff_date[${deliveryIndex}]"]`, delivery.date)
    ]);
   
    // Verify delivery number was actually set
    const verifyResult = await page.evaluate((idx) => {
      const input = document.querySelector(`input[name="drop_number[${idx}]"]`);
      return input ? input.value : 'NOT FOUND';
    }, deliveryIndex);
    log(`  ✓ Delivery complete (verified drop_number value: ${verifyResult})`);
  }
}

/**
 * Check for toast error messages on the page.
 * Returns { found: false } when no toast, or { found: true, message: '...' }.
 */
async function checkForToastError(page) {
  return await page.evaluate(() => {
    const selectors = [
      '.toast-error',
      'div.toast-error',
      '.toastr.toast-error',
      '#toast-container .toast-error',
      '.alert-danger',
      '.toast[class*="error"]'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;

      // Try dedicated message child first
      const messageEl = el.querySelector('.toast-message, .toast-body, p');
      let message = messageEl?.textContent?.trim() || '';

      if (!message) {
        // Strip "Close ×" noise from raw text
        message = el.textContent
          .replace(/\bClose\b/gi, '')
          .replace(/×/g, '')
          .trim();
      }

      if (!message && el.dataset?.message) {
        message = el.dataset.message;
      }

      if (message) {
        return { found: true, message, selector: sel };
      }
    }

    return { found: false };
  });
}

// main form fill function
async function fillForm(page, data, log) {
  const formStart = Date.now();
  console.log("=== FORM FILL (ULTRA-OPTIMIZED) ===");
  log("=== FORM FILL START ===");
 
  // Normalize data
  data.pickups.forEach(p => {
    if (!p.pickUp?.length) p.pickUp = [data.loadNumber];
  });
 
  data.deliveries.forEach(d => {
    if (!d.dropOff?.length) d.dropOff = [data.loadNumber];
  });
 
  log(`After normalization:`);
  log(`  Pickups: ${data.pickups.length}, Deliveries: ${data.deliveries.length}`);
  data.deliveries.forEach((d, i) => {
    log(`    D${i + 1} dropOff numbers: ${d.dropOff.join(',')}`);
  });
 
  // Clear all old location first
  await clearAllLocationFields(page, log);
 
  // Basic Info 
  const step1Start = Date.now();
  console.log("📄 Basic Info");
  log("STEP 1: Basic Info");
  const digitsOnly = data.driver.phone.replace(/\D/g, '');
  const formattedPhone = digitsOnly.length === 10 ? digitsOnly : `1${digitsOnly}`;
 
  await Promise.all([
    fillFieldInstant(page, 'input[name="load_number"]', data.loadNumber),
    fillFieldInstant(page, 'input[name="driver_name"]', data.driver.name),
    fillFieldInstant(page, 'input#adminProfileDailingCode[name="phone_number"]', formattedPhone),
    fillFieldInstant(page, 'input[name="carrier_name"]', data.company.name),
    fillFieldInstant(page, 'input[name="carrier_mc_number"]', data.company.mc),
    fillFieldInstant(page, 'input[name="carrier_dot_number"]', data.company.usdot)
  ]);
 
  await wait(50); 
  log(`✓ Basic info filled (${Date.now() - step1Start}ms)`);
 
  // Mode Selection
  const step2Start = Date.now();
  const isMultiple = data.pickups.length > 1 || data.deliveries.length > 1;
  console.log(`🔘 Mode: ${isMultiple ? 'Multiple' : 'Single'}`);
  log(`STEP 2: Mode - ${isMultiple ? 'Multiple' : 'Single'}`);
 
  if (isMultiple) {
    log('  Clicking multiple load button...');
    await page.evaluate(() => document.querySelector('#multipleLoadButton')?.click());
    await wait(200); 
    log('  Enabling fields...');
    await enableAllFields(page);
    await wait(50); 
    log(`✓ Mode setup complete (${Date.now() - step2Start}ms)`);
  }
 
  // Fill locations
  const step3Start = Date.now();
  console.log("📍 Locations");
  log("STEP 3: Filling locations");
  log(`  Pickups: ${data.pickups.length}, Deliveries: ${data.deliveries.length}`);
 
  if (isMultiple) {
    // Determine the scenario
    const singlePickupMultiDrop = data.pickups.length === 1 && data.deliveries.length > 1;
    const multiPickupSingleDrop = data.pickups.length > 1 && data.deliveries.length === 1;
    const multiPickupMultiDrop = data.pickups.length > 1 && data.deliveries.length > 1;
   
    log(`  Mode: ${singlePickupMultiDrop ? '1 Pickup → Multiple Drops' : multiPickupSingleDrop ? 'Multiple Pickups → 1 Drop' : multiPickupMultiDrop ? 'Multiple Pickups → Multiple Drops' : 'Unknown'}`);
   
    if (singlePickupMultiDrop) {
      // Special case: 1 pickup with multiple deliveries
      log(`  Single pickup with ${data.deliveries.length} deliveries`);
     
      // Fill the single pickup first
      const pickup = data.pickups[0];
      log(`--- Pickup [0] START ---`);
      await fillLocationSetBatch(page, pickup, null, 0, 0, log);
      log(`--- Pickup [0] DONE ---`);
     
      // Fill each delivery incrementally with correct indices
      for (let i = 0; i < data.deliveries.length; i++) {
        const setStart = Date.now();
       
        let deliveryIndex;
        if (i === 0) {
          deliveryIndex = 0;
        } else if (i === 1) {
          deliveryIndex = 2;
        } else {
          deliveryIndex = i + 1;
        }
       
        log(`--- Delivery #${i + 1} (index ${deliveryIndex}) START ---`);
       
        if (i > 0) {
          log('  Adding new drop form...');
          await page.evaluate(() => document.querySelector('#addMorePickupDropForm')?.click());
          await wait(300); 
          await enableAllFields(page);
          await wait(100); 
         
          // Verify the form was actually created
          const formExists = await page.evaluate((delivIdx) => {
            const dropAddr = document.querySelector(`input[name="drop_location[${delivIdx}]"]`);
            const pickupAddr = document.querySelector(`input[name="pickup_location[${delivIdx}]"]`);
            return {
              dropExists: !!dropAddr,
              pickupExists: !!pickupAddr,
              dropVisible: dropAddr ? dropAddr.offsetParent !== null : false,
              pickupVisible: pickupAddr ? pickupAddr.offsetParent !== null : false
            };
          }, deliveryIndex);
         
          log(`  Form verification: drop=${formExists.dropExists}/${formExists.dropVisible}, pickup=${formExists.pickupExists}/${formExists.pickupVisible}`);
         
          if (!formExists.dropExists || !formExists.pickupExists) {
            log(`  ⚠️ WARNING: Form fields not found at index ${deliveryIndex}! Trying again...`);
            await wait(300); 
            await page.evaluate(() => document.querySelector('#addMorePickupDropForm')?.click());
            await wait(300); 
            await enableAllFields(page);
            await wait(100); 
           
            const retry = await page.evaluate((delivIdx) => {
              const dropAddr = document.querySelector(`input[name="drop_location[${delivIdx}]"]`);
              const pickupAddr = document.querySelector(`input[name="pickup_location[${delivIdx}]"]`);
              return {
                dropExists: !!dropAddr,
                pickupExists: !!pickupAddr
              };
            }, deliveryIndex);
           
            if (!retry.dropExists || !retry.pickupExists) {
              log(`  ❌ ERROR: Still cannot find form fields at index ${deliveryIndex} after retry`);
              throw new Error(`Failed to create form at index ${deliveryIndex}`);
            }
            log(`  ✓ Form created successfully on retry`);
          }
         
          // Click the checkbox to clone the first pickup to all new pickups
          log('  Clicking checkbox to clone pickup address...');
          const cloneResult = await page.evaluate((delivIdx) => {
            const checkbox = document.querySelector('#addpickcheck');
            if (checkbox && !checkbox.checked) {
              checkbox.click();
              checkbox.dispatchEvent(new Event('change', { bubbles: true }));
            }
           
            return new Promise(resolve => {
              setTimeout(() => {
                const pickup0 = document.querySelector(`input[name="pickup_location[0]"]`)?.value || '';
                const pickupN = document.querySelector(`input[name="pickup_location[${delivIdx}]"]`)?.value || '';
               
                resolve({
                  checkboxFound: !!checkbox,
                  checkboxChecked: checkbox ? checkbox.checked : false,
                  pickup0Value: pickup0.substring(0, 50),
                  pickupNValue: pickupN.substring(0, 50),
                  cloneWorked: pickup0 === pickupN && pickupN.length > 0
                });
              }, 300); 
            });
          }, deliveryIndex);
         
          log(`  Checkbox: ${cloneResult.checkboxFound ? (cloneResult.checkboxChecked ? 'CHECKED ✓' : 'NOT CHECKED ✗') : 'NOT FOUND'}`);
          log(`  Clone result: ${cloneResult.cloneWorked ? 'SUCCESS ✓' : 'FAILED ✗'}`);
          log(`    pickup[0]: "${cloneResult.pickup0Value}"`);
          log(`    pickup[${deliveryIndex}]: "${cloneResult.pickupNValue}"`);
         
          if (!cloneResult.cloneWorked) {
            log('  ⚠️ WARNING: Checkbox cloning did not work! Manually copying pickup data...');
            await page.evaluate((idx) => {
              const pickup0Addr = document.querySelector(`input[name="pickup_location[0]"]`);
              const pickup0Num = document.querySelector(`input[name="pickup_number[0]"]`);
              const pickup0Date = document.querySelector(`input[name="pickup_date[0]"]`);
              const pickup0Lat = document.querySelector(`input[name="pickup_lat[0]"]`);
              const pickup0Long = document.querySelector(`input[name="pickup_long[0]"]`);
             
              const pickupAddr = document.querySelector(`input[name="pickup_location[${idx}]"]`);
              const pickupNum = document.querySelector(`input[name="pickup_number[${idx}]"]`);
              const pickupDate = document.querySelector(`input[name="pickup_date[${idx}]"]`);
              const pickupLat = document.querySelector(`input[name="pickup_lat[${idx}]"]`);
              const pickupLong = document.querySelector(`input[name="pickup_long[${idx}]"]`);
             
              if (pickup0Addr && pickupAddr) {
                pickupAddr.value = pickup0Addr.value;
                pickupAddr.dispatchEvent(new Event('input', { bubbles: true }));
                pickupAddr.dispatchEvent(new Event('change', { bubbles: true }));
              }
              if (pickup0Lat && pickupLat) pickupLat.value = pickup0Lat.value;
              if (pickup0Long && pickupLong) pickupLong.value = pickup0Long.value;
              if (pickup0Date && pickupDate) {
                pickupDate.value = pickup0Date.value;
                pickupDate.dispatchEvent(new Event('input', { bubbles: true }));
                pickupDate.dispatchEvent(new Event('change', { bubbles: true }));
              }
             
              if (pickup0Num && pickupNum) {
                if (typeof jQuery !== 'undefined' && jQuery(pickup0Num).data('tagsinput')) {
                  const tags = jQuery(pickup0Num).tagsinput('items');
                  tags.forEach(tag => {
                    try {
                      jQuery(pickupNum).tagsinput('add', tag);
                    } catch (e) {}
                  });
                }
                pickupNum.value = pickup0Num.value;
                pickupNum.dispatchEvent(new Event('input', { bubbles: true }));
                pickupNum.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }, deliveryIndex);
            log('  ✓ Manual copy complete');
            
            const verifyResult = await page.evaluate((idx) => {
              const pickupAddr = document.querySelector(`input[name="pickup_location[${idx}]"]`);
              const pickupNum = document.querySelector(`input[name="pickup_number[${idx}]"]`);
              return {
                address: pickupAddr ? pickupAddr.value.substring(0, 50) : 'NOT FOUND',
                number: pickupNum ? pickupNum.value : 'NOT FOUND'
              };
            }, deliveryIndex);
            log(`  Verify manual copy: addr="${verifyResult.address}", num="${verifyResult.number}"`);
          }
         
          log('  Form added and enabled');
        }
       
        await fillLocationSetBatch(page, null, data.deliveries[i], 0, deliveryIndex, log);
        log(`--- Delivery #${i + 1} DONE (${Date.now() - setStart}ms) ---`);
      }
     
    } else if (multiPickupSingleDrop) {
      // Special case: Multiple pickups with 1 delivery
      log(`  ${data.pickups.length} pickups with single delivery`);
     
      // Fill the single delivery at [0] FIRST
      const delivery = data.deliveries[0];
      log(`--- Delivery [0] START (filling first for cloning) ---`);
      await fillLocationSetBatch(page, null, delivery, 0, 0, log);
      log(`--- Delivery [0] DONE ---`);
     
      // Now fill pickups incrementally
      for (let i = 0; i < data.pickups.length; i++) {
        const setStart = Date.now();
       
        let pickupIndex;
        if (i === 0) {
          pickupIndex = 0;
        } else if (i === 1) {
          pickupIndex = 2;
        } else {
          pickupIndex = i + 1;
        }
       
        log(`--- Pickup #${i + 1} (index ${pickupIndex}) START ---`);
       
        if (i > 0) {
          log('  Adding new pickup form...');
          await page.evaluate(() => document.querySelector('#addMorePickupDropForm')?.click());
          await wait(300); 
          await enableAllFields(page);
          await wait(100); 
         
          const formExists = await page.evaluate((pickupIdx) => {
            const dropAddr = document.querySelector(`input[name="drop_location[${pickupIdx}]"]`);
            const pickupAddr = document.querySelector(`input[name="pickup_location[${pickupIdx}]"]`);
            return {
              dropExists: !!dropAddr,
              pickupExists: !!pickupAddr,
              dropVisible: dropAddr ? dropAddr.offsetParent !== null : false,
              pickupVisible: pickupAddr ? pickupAddr.offsetParent !== null : false
            };
          }, pickupIndex);
         
          log(`  Form verification: drop=${formExists.dropExists}/${formExists.dropVisible}, pickup=${formExists.pickupExists}/${formExists.pickupVisible}`);
         
          if (!formExists.dropExists || !formExists.pickupExists) {
            log(`  ⚠️ WARNING: Form fields not found at index ${pickupIndex}! Trying again...`);
            await wait(300);  
            await page.evaluate(() => document.querySelector('#addMorePickupDropForm')?.click());
            await wait(300); 
            await enableAllFields(page);
            await wait(100); 
           
            const retry = await page.evaluate((pickupIdx) => {
              const dropAddr = document.querySelector(`input[name="drop_location[${pickupIdx}]"]`);
              const pickupAddr = document.querySelector(`input[name="pickup_location[${pickupIdx}]"]`);
              return {
                dropExists: !!dropAddr,
                pickupExists: !!pickupAddr
              };
            }, pickupIndex);
           
            if (!retry.dropExists || !retry.pickupExists) {
              log(`  ❌ ERROR: Still cannot find form fields at index ${pickupIndex} after retry`);
              throw new Error(`Failed to create form at index ${pickupIndex}`);
            }
            log(`  ✓ Form created successfully on retry`);
          }
         
          // Click the checkbox to clone the first delivery
          log('  Clicking checkbox to clone delivery address...');
          const cloneResult = await page.evaluate((pickupIdx) => {
            const checkbox = document.querySelector('#addpickcheck1');
            if (checkbox && !checkbox.checked) {
              checkbox.click();
              checkbox.dispatchEvent(new Event('change', { bubbles: true }));
            }
           
            return new Promise(resolve => {
              setTimeout(() => {
                const drop0 = document.querySelector(`input[name="drop_location[0]"]`)?.value || '';
                const dropN = document.querySelector(`input[name="drop_location[${pickupIdx}]"]`)?.value || '';
               
                resolve({
                  checkboxFound: !!checkbox,
                  checkboxChecked: checkbox ? checkbox.checked : false,
                  drop0Value: drop0.substring(0, 50),
                  dropNValue: dropN.substring(0, 50),
                  cloneWorked: drop0 === dropN && dropN.length > 0
                });
              }, 300); 
            });
          }, pickupIndex);
         
          log(`  Checkbox: ${cloneResult.checkboxFound ? (cloneResult.checkboxChecked ? 'CHECKED ✓' : 'NOT CHECKED ✗') : 'NOT FOUND'}`);
          log(`  Clone result: ${cloneResult.cloneWorked ? 'SUCCESS ✓' : 'FAILED ✗'}`);
          log(`    drop[0]: "${cloneResult.drop0Value}"`);
          log(`    drop[${pickupIndex}]: "${cloneResult.dropNValue}"`);
         
          if (!cloneResult.cloneWorked) {
            log('  ⚠️ WARNING: Checkbox cloning did not work! Manually copying delivery data...');
            await page.evaluate((idx) => {
              const drop0Addr = document.querySelector(`input[name="drop_location[0]"]`);
              const drop0Num = document.querySelector(`input[name="drop_number[0]"]`);
              const drop0Date = document.querySelector(`input[name="dropoff_date[0]"]`);
              const drop0Lat = document.querySelector(`input[name="drop_lat[0]"]`);
              const drop0Long = document.querySelector(`input[name="drop_long[0]"]`);
             
              const dropAddr = document.querySelector(`input[name="drop_location[${idx}]"]`);
              const dropNum = document.querySelector(`input[name="drop_number[${idx}]"]`);
              const dropDate = document.querySelector(`input[name="dropoff_date[${idx}]"]`);
              const dropLat = document.querySelector(`input[name="drop_lat[${idx}]"]`);
              const dropLong = document.querySelector(`input[name="drop_long[${idx}]"]`);
             
              if (drop0Addr && dropAddr) {
                dropAddr.value = drop0Addr.value;
                dropAddr.dispatchEvent(new Event('input', { bubbles: true }));
                dropAddr.dispatchEvent(new Event('change', { bubbles: true }));
              }
              if (drop0Lat && dropLat) dropLat.value = drop0Lat.value;
              if (drop0Long && dropLong) dropLong.value = drop0Long.value;
              if (drop0Date && dropDate) {
                dropDate.value = drop0Date.value;
                dropDate.dispatchEvent(new Event('input', { bubbles: true }));
                dropDate.dispatchEvent(new Event('change', { bubbles: true }));
              }
             
              if (drop0Num && dropNum) {
                if (typeof jQuery !== 'undefined' && jQuery(drop0Num).data('tagsinput')) {
                  const tags = jQuery(drop0Num).tagsinput('items');
                  tags.forEach(tag => {
                    try {
                      jQuery(dropNum).tagsinput('add', tag);
                    } catch (e) {}
                  });
                }
                dropNum.value = drop0Num.value;
                dropNum.dispatchEvent(new Event('input', { bubbles: true }));
                dropNum.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }, pickupIndex);
            log('  ✓ Manual copy complete');
            
            const verifyResult = await page.evaluate((idx) => {
              const dropAddr = document.querySelector(`input[name="drop_location[${idx}]"]`);
              const dropNum = document.querySelector(`input[name="drop_number[${idx}]"]`);
              return {
                address: dropAddr ? dropAddr.value.substring(0, 50) : 'NOT FOUND',
                number: dropNum ? dropNum.value : 'NOT FOUND'
              };
            }, pickupIndex);
            log(`  Verify manual copy: addr="${verifyResult.address}", num="${verifyResult.number}"`);
          }
         
          log('  Form added and enabled');
        }
       
        await fillLocationSetBatch(page, data.pickups[i], null, pickupIndex, 0, log);
        log(`--- Pickup #${i + 1} DONE (${Date.now() - setStart}ms) ---`);
      }
    } else if (multiPickupMultiDrop) {

      // Multiple pickups AND multiple deliveries
      log(`  ${data.pickups.length} pickups with ${data.deliveries.length} deliveries`);
     
      const maxCount = Math.max(data.pickups.length, data.deliveries.length);
     
      for (let i = 0; i < maxCount; i++) {
        const setStart = Date.now();
       
        let pairIndex;
        if (i === 0) {
          pairIndex = 0;
        } else if (i === 1) {
          pairIndex = 2;
        } else {
          pairIndex = i + 1;
        }
       
        log(`--- Pair #${i + 1} (index ${pairIndex}) START ---`);
       
        if (i > 0) {
          log('  Adding new pickup/drop form...');
          await page.evaluate(() => document.querySelector('#addMorePickupDropForm')?.click());
          await wait(300); 
          await enableAllFields(page);
          await wait(100); 
         
          const formExists = await page.evaluate((pairIdx) => {
            const dropAddr = document.querySelector(`input[name="drop_location[${pairIdx}]"]`);
            const pickupAddr = document.querySelector(`input[name="pickup_location[${pairIdx}]"]`);
            return {
              dropExists: !!dropAddr,
              pickupExists: !!pickupAddr,
              dropVisible: dropAddr ? dropAddr.offsetParent !== null : false,
              pickupVisible: pickupAddr ? pickupAddr.offsetParent !== null : false
            };
          }, pairIndex);
         
          log(`  Form verification: drop=${formExists.dropExists}/${formExists.dropVisible}, pickup=${formExists.pickupExists}/${formExists.pickupVisible}`);
         
          if (!formExists.dropExists || !formExists.pickupExists) {
            log(`  ⚠️ WARNING: Form fields not found at index ${pairIndex}! Trying again...`);
            await wait(300);  
            await page.evaluate(() => document.querySelector('#addMorePickupDropForm')?.click());
            await wait(300); 
            await enableAllFields(page);
            await wait(100); 
           
            const retry = await page.evaluate((pairIdx) => {
              const dropAddr = document.querySelector(`input[name="drop_location[${pairIdx}]"]`);
              const pickupAddr = document.querySelector(`input[name="pickup_location[${pairIdx}]"]`);
              return {
                dropExists: !!dropAddr,
                pickupExists: !!pickupAddr
              };
            }, pairIndex);
           
            if (!retry.dropExists || !retry.pickupExists) {
              log(`  ❌ ERROR: Still cannot find form fields at index ${pairIndex} after retry`);
              throw new Error(`Failed to create form at index ${pairIndex}`);
            }
            log(`  ✓ Form created successfully on retry`);
          }
         
          log('  Form added and enabled');
        }
       
        const pickup = data.pickups[i] || null;
        const delivery = data.deliveries[i] || null;
       
        if (pickup && delivery) {
          await fillLocationSetBatch(page, pickup, delivery, pairIndex, pairIndex, log);
        } else if (pickup) {
          log(`  ⚠️ No delivery for pickup #${i + 1}, cloning last delivery...`);
         
          const lastDeliveryIndex = await page.evaluate(() => {
            for (let idx = 19; idx >= 0; idx--) {
              const drop = document.querySelector(`input[name="drop_location[${idx}]"]`);
              if (drop && drop.value && drop.value.trim()) {
                return idx;
              }
            }
            return 0;
          });
         
          log(`  Cloning from delivery index ${lastDeliveryIndex} to ${pairIndex}`);
          
          await page.evaluate((fromIdx, toIdx) => {
            const dropAddr = document.querySelector(`input[name="drop_location[${fromIdx}]"]`);
            const dropNum = document.querySelector(`input[name="drop_number[${fromIdx}]"]`);
            const dropDate = document.querySelector(`input[name="dropoff_date[${fromIdx}]"]`);
            const dropLat = document.querySelector(`input[name="drop_lat[${fromIdx}]"]`);
            const dropLong = document.querySelector(`input[name="drop_long[${fromIdx}]"]`);
           
            const toDropAddr = document.querySelector(`input[name="drop_location[${toIdx}]"]`);
            const toDropNum = document.querySelector(`input[name="drop_number[${toIdx}]"]`);
            const toDropDate = document.querySelector(`input[name="dropoff_date[${toIdx}]"]`);
            const toDropLat = document.querySelector(`input[name="drop_lat[${toIdx}]"]`);
            const toDropLong = document.querySelector(`input[name="drop_long[${toIdx}]"]`);
           
            if (dropAddr && toDropAddr) {
              toDropAddr.value = dropAddr.value;
              toDropAddr.dispatchEvent(new Event('input', { bubbles: true }));
              toDropAddr.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (dropLat && toDropLat) toDropLat.value = dropLat.value;
            if (dropLong && toDropLong) toDropLong.value = dropLong.value;
            if (dropDate && toDropDate) {
              toDropDate.value = dropDate.value;
              toDropDate.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (dropNum && toDropNum) {
              if (typeof jQuery !== 'undefined' && jQuery(dropNum).data('tagsinput')) {
                const tags = jQuery(dropNum).tagsinput('items');
                tags.forEach(tag => {
                  try {
                    jQuery(toDropNum).tagsinput('add', tag);
                  } catch (e) {}
                });
              }
              toDropNum.value = dropNum.value;
              toDropNum.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }, lastDeliveryIndex, pairIndex);
          
          await fillLocationSetBatch(page, pickup, null, pairIndex, pairIndex, log);
        } else if (delivery) {
          log(`  ⚠️ No pickup for delivery #${i + 1}, cloning last pickup...`);
         
          const lastPickupIndex = await page.evaluate(() => {
            for (let idx = 19; idx >= 0; idx--) {
              const pickup = document.querySelector(`input[name="pickup_location[${idx}]"]`);
              if (pickup && pickup.value && pickup.value.trim()) {
                return idx;
              }
            }
            return 0;
          });
         
          log(`  Cloning from pickup index ${lastPickupIndex} to ${pairIndex}`);
          
          await page.evaluate((fromIdx, toIdx) => {
            const pickupAddr = document.querySelector(`input[name="pickup_location[${fromIdx}]"]`);
            const pickupNum = document.querySelector(`input[name="pickup_number[${fromIdx}]"]`);
            const pickupDate = document.querySelector(`input[name="pickup_date[${fromIdx}]"]`);
            const pickupLat = document.querySelector(`input[name="pickup_lat[${fromIdx}]"]`);
            const pickupLong = document.querySelector(`input[name="pickup_long[${fromIdx}]"]`);
           
            const toPickupAddr = document.querySelector(`input[name="pickup_location[${toIdx}]"]`);
            const toPickupNum = document.querySelector(`input[name="pickup_number[${toIdx}]"]`);
            const toPickupDate = document.querySelector(`input[name="pickup_date[${toIdx}]"]`);
            const toPickupLat = document.querySelector(`input[name="pickup_lat[${toIdx}]"]`);
            const toPickupLong = document.querySelector(`input[name="pickup_long[${toIdx}]"]`);
           
            if (pickupAddr && toPickupAddr) {
              toPickupAddr.value = pickupAddr.value;
              toPickupAddr.dispatchEvent(new Event('input', { bubbles: true }));
              toPickupAddr.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (pickupLat && toPickupLat) toPickupLat.value = pickupLat.value;
            if (pickupLong && toPickupLong) toPickupLong.value = pickupLong.value;
            if (pickupDate && toPickupDate) {
              toPickupDate.value = pickupDate.value;
              toPickupDate.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (pickupNum && toPickupNum) {
              if (typeof jQuery !== 'undefined' && jQuery(pickupNum).data('tagsinput')) {
                const tags = jQuery(pickupNum).tagsinput('items');
                tags.forEach(tag => {
                  try {
                    jQuery(toPickupNum).tagsinput('add', tag);
                  } catch (e) {}
                });
              }
              toPickupNum.value = pickupNum.value;
              toPickupNum.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }, lastPickupIndex, pairIndex);
          
          await fillLocationSetBatch(page, null, delivery, pairIndex, pairIndex, log);
        }
       
        log(`--- Pair #${i + 1} DONE (${Date.now() - setStart}ms) ---`);
      }
    }
  } else {
    log('  Single location mode');
    await fillLocationSetBatch(page, data.pickups[0], data.deliveries[0], 0, 0, log);
  }
 
  log(`✓ All locations filled (${Date.now() - step3Start}ms)`);
  console.log("=== FILL DONE ===");
  await wait(30); 
 
  // Save form
  const step4Start = Date.now();
  console.log("💾 Saving...");
  log("STEP 4: Saving form");

  // Clean up empty fields and duplicates
  const cleanupResult = await page.evaluate(() => {
    const removed = { emptyFields: 0, duplicates: 0 };
   
    document.querySelectorAll('.text-danger, .invalid-feedback').forEach(el => el.remove());
    document.querySelectorAll('input').forEach(el => {
      el.style.border = '';
      el.classList.remove('is-invalid');
      el.classList.add('is-valid');
    });
   
    for (let i = 0; i < 10; i++) {
      const pickupAddr = document.querySelector(`input[name="pickup_location[${i}]"]`);
      const dropAddr = document.querySelector(`input[name="drop_location[${i}]"]`);
     
      const pickupHasValue = pickupAddr && pickupAddr.value.trim();
      const dropHasValue = dropAddr && dropAddr.value.trim();
     
      if (!pickupHasValue && !dropHasValue) {
        ['pickup_location', 'pickup_lat', 'pickup_long', 'pickup_number', 'pickup_date',
         'drop_location', 'drop_lat', 'drop_long', 'drop_number', 'dropoff_date'].forEach(fieldName => {
          const fields = document.querySelectorAll(`input[name="${fieldName}[${i}]"]`);
          fields.forEach(field => {
            field.remove();
            removed.emptyFields++;
          });
        });
      } else {
        ['pickup_location', 'pickup_lat', 'pickup_long', 'pickup_number', 'pickup_date',
         'drop_location', 'drop_lat', 'drop_long', 'drop_number', 'dropoff_date'].forEach(fieldName => {
          const fields = document.querySelectorAll(`input[name="${fieldName}[${i}]"]`);
          if (fields.length > 1) {
            fields.forEach((field, idx) => {
              if (idx > 0) {
                field.remove();
                removed.duplicates++;
              }
            });
          }
        });
      }
    }
   
    const form = document.querySelector('form');
    if (form) form.noValidate = true;
   
    return removed;
  });
 
  log(`  Cleanup: removed ${cleanupResult.emptyFields} empty fields, ${cleanupResult.duplicates} duplicates`);

  try {
    log('  Waiting for save button...');
    await page.waitForSelector('#saveAndContinuePreviewLoad', { visible: true, timeout: 1000 });
    log('  Save button found, clicking...');
   
    await page.click('#saveAndContinuePreviewLoad');
    await wait(500);

    // Check for toast error immediately after save
    const toastAfterSave = await checkForToastError(page);
    if (toastAfterSave.found) {
      log(`🚨 Toast error after save: ${toastAfterSave.message}`);
      return { success: false, toastError: toastAfterSave.message, errorType: 'toast_error' };
    }

    log(`✓ Save button clicked (${Date.now() - step4Start}ms)`);
    console.log("✅ Saved - waiting for modal");

  } catch (error) {
    log(`❌ Save error: ${error.message}`);
    console.log(`⚠️ Save error: ${error.message}`);
    return { success: false, toastError: error.message, errorType: 'save_error' };
  }
   
  // Sav confirmation
  const step5Start = Date.now();
  console.log("✅ Confirming...");
  log("STEP 5: Confirming load");

  try {
    log('⏳ Waiting for confirm modal...');
    let modalReady = false;
    
    for (let i = 0; i < 6; i++) {
      const state = await page.evaluate(() => {
        const modal = document.querySelector('#viewLoadReceiptModel');
        const btn = document.querySelector('#confirmLoadData');
        return {
          modalVisible: modal ? (modal.classList.contains('show') || modal.style.display === 'block') : false,
          buttonReady: btn ? (!btn.disabled && btn.offsetParent !== null) : false
        };
      });
      
      if (state.modalVisible && state.buttonReady) {
        log('✅ Modal ready!');
        modalReady = true;
        break;
      }
      
      await wait(100);
    }

    if (!modalReady) {
      log('❌ Modal timeout - checking for errors');

      // Check for toast error before inspecting validation elements
      const toastOnTimeout = await checkForToastError(page);
      if (toastOnTimeout.found) {
        log(`🚨 Toast error: ${toastOnTimeout.message}`);
        return { success: false, toastError: toastOnTimeout.message, errorType: 'toast_error' };
      }

      const errors = await page.evaluate(() => {
        const errorElements = document.querySelectorAll('.text-danger, .invalid-feedback, .alert-danger');
        return Array.from(errorElements).map(el => el.textContent.trim()).filter(t => t);
      });

      if (errors.length > 0) {
        log(`Validation errors: ${JSON.stringify(errors)}`);
        throw new Error(`Form validation failed: ${errors.join(', ')}`);
      }

      log('⚠️ No modal but no errors - form saved successfully in Step 4');
      const totalDuration = Date.now() - formStart;
      log(`=== FORM FILL COMPLETE (Total: ${totalDuration}ms) ===`);
      return { success: true };
    }

    log('  Clicking confirm button...');
    await page.evaluate(() => {
      const btn = document.querySelector('#confirmLoadData');
      if (btn) {
        btn.disabled = false;
        btn.click();
      }
    });

    await Promise.race([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 2000 }).catch(() => {}),
      wait(2000)
    ]);

    // Check for toast error after confirm
    const toastAfterConfirm = await checkForToastError(page);
    if (toastAfterConfirm.found) {
      log(`🚨 Toast error after confirm: ${toastAfterConfirm.message}`);
      return { success: false, toastError: toastAfterConfirm.message, errorType: 'toast_error' };
    }

    const finalUrl = page.url();
    log(`✓ Confirm complete (${Date.now() - step5Start}ms) - URL: ${finalUrl}`);
    console.log("✅ Load confirmed!");

    const totalDuration = Date.now() - formStart;
    log(`=== FORM FILL COMPLETE (Total: ${totalDuration}ms) ===`);
    return { success: true };

  } catch (error) {
    // Validation/toast errors must propagate as failures
    if (
      error.message.includes('Form validation failed') ||
      error.message.includes('validation') ||
      error.message.includes('already been taken') ||
      error.message.includes('already engaged')
    ) {
      log(`❌ Validation error: ${error.message}`);
      const totalDuration = Date.now() - formStart;
      log(`=== FORM FILL FAILED (Total: ${totalDuration}ms) ===`);
      return { success: false, toastError: error.message, errorType: 'validation_error' };
    }
    // Only assume success for navigation/CDP errors after confirm click
    log(`⚠️ Confirm navigation error: ${error.message} - assuming form was saved`);
    const totalDuration = Date.now() - formStart;
    log(`=== FORM FILL COMPLETE (Total: ${totalDuration}ms) ===`);
    return { success: true };
  }
}

//main handler
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
   
    const data = parseZapierData(req.body);
   
    log(`Parsed data:`);
    log(`  Load: ${data.loadNumber}`);
    log(`  Driver: ${data.driver.name} (${data.driver.phone})`);
    log(`  Company: ${data.company.name} (MC: ${data.company.mc}, DOT: ${data.company.usdot})`);
    log(`  Pickups: ${data.pickups.length}`);
    data.pickups.forEach((p, i) => {
      log(`    P${i + 1}: ${p.address} | Date: ${p.date} | PO: ${p.pickUp.join(',')}`);
    });
    log(`  Deliveries: ${data.deliveries.length}`);
    data.deliveries.forEach((d, i) => {
      log(`    D${i + 1}: ${d.address} | Date: ${d.date} | Del#: ${d.dropOff.join(',')}`);
    });
   
    if (!data.loadNumber || !data.driver.name || !data.pickups.length || !data.deliveries.length) {
      return res.status(400).json({
        error: 'Missing required fields',
        logs
      });
    }
    log(`Load: ${data.loadNumber} | P:${data.pickups.length} D:${data.deliveries.length}`);
   
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
    await page.setDefaultNavigationTimeout(12000); 
    await page.setDefaultTimeout(8000); 
   
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (type === 'document' || type === 'script' || type === 'xhr' || type === 'fetch') {
        req.continue();
      } else {
        req.abort();
      }
    });
   
    await page.setViewport({ width: 1280, height: 720 });
   
    log("Logging in...");
    await page.goto("https://quikskope.com/platform", {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    const logged = await page.evaluate(() => {
      return !!(document.querySelector("nav") || document.body.textContent.includes("logout"));
    }).catch(() => false);

    if (!logged) {
      await page.waitForSelector('#adminLoginForm', { timeout: 8000 }); 
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

    log("Navigating to Load Order page...");
    await page.goto("https://quikskope.com/customer/load-order", {
      waitUntil: "domcontentloaded",
      timeout: 12000
    });
   
    await wait(1500);  
    log("✓ On Load Order page");
   
    log("Clicking Create Load button...");
    await page.waitForSelector('a#createLoadByForm', { timeout: 4000 }); 
   
    // click logic
    await Promise.race([
      page.click('a#createLoadByForm').then(() =>
        page.waitForNavigation({
          waitUntil: "domcontentloaded",
          timeout: 8000 
        }).catch(() => {})
      ),
      wait(500).then(() =>
        page.evaluate(() => document.querySelector('a#createLoadByForm')?.click())
      )
    ]).catch(() => {});
   
    await wait(1500); 
    log("✓ Clicked Create Load button");

    log("Waiting for load form...");
    await page.waitForSelector('input[name="load_number"]', { timeout: 8000 }); 
    await wait(300); 
    log("✓ Load form is ready");
   
    log("Starting form fill...");
    const fillResult = await fillForm(page, data, log);

    if (!fillResult.success) {
      const errorMsg = fillResult.toastError || fillResult.errorMessage || 'Form fill failed';
      log(`❌ Form fill failed: ${errorMsg}`);
      return res.status(200).json({
        success: false,
        error: true,
        errorMessage: errorMsg,
        errorType: fillResult.errorType || 'fill_error',
        toastAlert: fillResult.toastError || null,
        logs
      });
    }

    await wait(800); 
   
    const finalUrl = page.url();
    log(`Final URL: ${finalUrl}`);
   
    const duration = Date.now() - start;
    log(`✅ SUCCESS - Total time: ${duration}ms`);
   
    return res.status(200).json({
      success: true,
      loadNumber: data.loadNumber,
      duration,
      message: `Load ${data.loadNumber} submitted successfully`,
      logs
    });

  } catch (error) {
    log(`❌ ERROR: ${error.message}`);
    log(`Stack: ${error.stack}`);
   
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