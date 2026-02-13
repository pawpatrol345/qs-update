# QuikSkope Load Automation

Automated load order submission system for QuikSkope freight management platform. Processes load data from external sources (Zapier, QuoteFactory) and automatically fills and submits load order forms.

## Features

- **Automated Login**: Secure credential-based authentication for QuikSkope platform
- **Load Data Parsing**: Intelligent parsing of pickup/delivery addresses, dates, and reference numbers
- **Form Filling**: Automated completion of single and multiple pickup/delivery forms
- **Autocomplete Handling**: Automatic Google Places autocomplete selection for addresses
- **Tag Management**: Support for jQuery tag inputs for PO numbers and delivery numbers
- **Date Handling**: Automatic date adjustment and formatting for date picker fields
- **Error Recovery**: Robust error handling with form creation retries and field verification
- **Comprehensive Logging**: Detailed operation logs with timestamps for debugging
- **Quote Factory Integration**: Extract load data directly from QuoteFactory quotes

## Project Structure

```
├── api/
│   ├── quikSkope-webhook.js        # Main QuikSkope form submission handler
│   └── quoteFactory-webhook.js     # QuoteFactory load extraction handler
├── package.json            # Project dependencies and scripts
├── package-lock.json       # Locked dependency versions for reproducible builds
├── .env.local              # Local environment variables
├── vercel.json             # Vercel deployment config
├── package.json            # Project dependencies
└── README.md               # This file
```

## Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd load-automation-cloud
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env.local` file in the project root:
```env
# QuikSkope Credentials
QS_USERNAME=your-quikskope-email@example.com
QS_PASSWORD=your-quikskope-password

# Quote Factory Credentials
QF_USERNAME=your-quotefactory-email@example.com
QF_PASSWORD=your-quotefactory-password

# Browserless.io (for cloud deployment)
BROWSERLESS_TOKEN=your-browserless-token

# Local development (optional)
NODE_ENV=development
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `QS_USERNAME` | QuikSkope login email | ✓ |
| `QS_PASSWORD` | QuikSkope login password | ✓ |
| `QF_USERNAME` | QuoteFactory login email | For QF integration |
| `QF_PASSWORD` | QuoteFactory login password | For QF integration |
| `BROWSERLESS_TOKEN` | Browserless.io API token | For cloud deployment |

### Getting Browserless Token

1. Sign up at [browserless.io](https://www.browserless.io/)
2. Navigate to your dashboard
3. Copy your API token
4. Add to `.env.local` or Vercel secrets

## API Endpoints

### QuikSkope Load Submission

**POST** `/api/quikSkope-webhook`

Submits a load order to QuikSkope with parsed pickup/delivery information.

**Request Body:**
```json
{
  "loadNumber": "123456",
  "driverName": "John Doe",
  "driverNumber": "555-1234",
  "pickUp": "123 Main St, New York, NY 10001, USA",
  "pickUpDate": "01/15/2025",
  "pickUpNumber": "PO-001",
  "deliveries": "456 Oak Ave, Boston, MA 02101, USA",
  "deliveriesDate": "01/16/2025",
  "dropOffNumber": "DEL-001",
  "companyName": "Example Logistics",
  "DotNumber": "1234567",
  "McNumber": "123456"
}
```

**Supported Field Names:**
- `loadNumber`, `load_number`, `8. Load Reference`
- `driverName`, `driver_name`, `driver`, `8. Data Driver Name`
- `driverNumber`, `driver_number`, `driver_phone`, `8. Data Driver Phone`
- `pickUp`, `pickup`, `pickup_address`, `8. Data Pickups Address`
- `pickUpDate`, `pickup_date`, `8. Data Pickups Date`
- `pickUpNumber`, `pickup_numbers`, `pickup_number`, `8. Data Pickups Po Numbers`
- `deliveries`, `delivery`, `delivery_address`, `8. Data Deliveries Address`
- `deliveriesDate`, `delivery_date`, `8. Data Deliveries Date`
- `dropOffNumber`, `delivery_numbers`, `dropoff_number`, `8. Data Deliveries Del Numbers`
- `companyName`, `company_name`, `company`, `8. Data Company Name`
- `DotNumber`, `dot_number`, `usdot`, `8. Data Company Usdot`
- `McNumber`, `mc_number`, `mc`, `8. Data Company Mc Number`

**Response:**
```json
{
  "success": true,
  "loadNumber": "123456",
  "duration": 12500,
  "message": "Load 123456 submitted successfully",
  "logs": [
    { "time": "2025-01-08T10:30:00.000Z", "message": "✓ Logged in" },
    ...
  ]
}
```

### QuoteFactory Load Extraction

**POST** `/api/quoteFactory-webhook`

Extracts load details from a QuoteFactory quote.

**Request Body:**
```json
{
  "ref": "QF-315567"
}
```

Or **GET**: `/api/quoteFactory-webhook?ref=QF-315567`

**Response:**
```json
{
  "success": true,
  "loadReference": "QF-315567",
  "data": {
    "pickups": [
      {
        "address": "123 Main St, New York, NY 10001, USA",
        "date": "01/15/2025",
        "pickupNumbers": ["PO-001"]
      }
    ],
    "deliveries": [
      {
        "address": "456 Oak Ave, Boston, MA 02101, USA",
        "date": "01/16/2025",
        "deliveryNumbers": ["DEL-001"]
      }
    ],
    "driver": {
      "name": "John Doe",
      "phone": "555-1234"
    },
    "company": {
      "name": "Example Logistics",
      "usdot": "1234567",
      "mcNumber": "123456"
    }
  },
  "timestamp": "2025-01-08T10:30:00.000Z"
}
```

## Local Development

### Run Locally with Vercel

```bash
npm run dev
```

This starts the Vercel dev server at `http://localhost:3000`

### Test QuikSkope Submission

```bash
npm test
```

Or create a test file:
```javascript
import fetch from 'node-fetch';

const testData = {
  loadNumber: '999888',
  driverName: 'Test Driver',
  driverNumber: '555-0000',
  pickUp: '123 Main St, New York, NY 10001, USA',
  pickUpDate: '01/20/2025',
  pickUpNumber: 'TEST-001',
  deliveries: '456 Oak Ave, Boston, MA 02101, USA',
  deliveriesDate: '01/21/2025',
  dropOffNumber: 'TEST-DEL-001',
  companyName: 'Test Company',
  DotNumber: '9999999',
  McNumber: '999999'
};

const response = await fetch('http://localhost:3000/api/quikSkope-webhook', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(testData)
});

console.log(await response.json());
```

## Data Parsing

### Address Parsing
- Handles single and multiple addresses
- Automatically detects USA addresses
- Splits addresses by state/ZIP patterns
- Removes duplicates
- Ensures ", USA" suffix for consistency

### Multiple Addresses Format
```
"123 Main St, New York, NY 10001, USA | 456 Oak Ave, Boston, MA 02101, USA"
```

### Date Format
Accepts: `MM/DD/YYYY`
Example: `01/15/2025`

### PO/Delivery Numbers
Can be comma-separated or array format:
```json
"PO-001, PO-002, PO-003"
// OR
["PO-001", "PO-002", "PO-003"]
```

## Form Submission Modes

### Single Load Mode
- One pickup location
- One delivery location
- Direct submission

### Multiple Load Mode
Automatically triggered when:
- Multiple pickups to single delivery
- Single pickup to multiple deliveries
- Multiple pickups to multiple deliveries

#### Mode-Specific Features:
- Automatic form duplication
- Pickup address cloning to all forms
- Delivery address cloning to all forms
- Intelligent number distribution
- Form creation verification with retry logic

## Error Handling

### Common Issues

**"Missing required fields"**
- Check that loadNumber, driver name, pickup address, and delivery address are provided
- Verify address format includes city, state, ZIP, USA

**"Form fields not found"**
- Automatic retry built in
- If persists, browser may not have loaded the form correctly
- Check Vercel logs for timeout errors

**"Rate limit exceeded (429)"**
- Browserless.io usage limit reached
- Wait 5 minutes and retry
- Check account at https://www.browserless.io/account

**Login failures**
- Verify QS_USERNAME and QS_PASSWORD are correct
- Check if account requires MFA (not currently supported)
- Ensure credentials have access to the sandbox/production environment

## Browser Configuration

The automation uses:
- **Puppeteer Core**: Headless Chrome automation
- **Chromium**: Lightweight browser binary
- **Browserless.io**: Cloud-based browser for serverless deployment

### Features:
- Request interception (blocks images, fonts, stylesheets)
- Stealth mode for authentication
- Ad blocking
- Custom viewport (1280x720)
- 12-second default navigation timeout

## Deployment

### Deploy to Vercel

1. Connect your GitHub repository to Vercel
2. Set environment variables in Vercel dashboard:
   - `QS_USERNAME`
   - `QS_PASSWORD`
   - `QF_USERNAME`
   - `QF_PASSWORD`
   - `BROWSERLESS_TOKEN`

3. Deploy:
```bash
npm run deploy
```

### Vercel Configuration

See `vercel.json` for deployment settings:
- Node.js runtime
- 60-second function timeout
- Environment variable configuration

## Logging

All operations are logged with timestamps for debugging:

```javascript
{
  "time": "2025-01-08T10:30:00.000Z",
  "message": "✓ Logged in successfully"
}
```

Response includes full operation logs:
```json
{
  "logs": [
    { "time": "...", "message": "Parsing data..." },
    { "time": "...", "message": "✓ Basic info filled" },
    { "time": "...", "message": "✓ Location filled" },
    { "time": "...", "message": "✅ Form saved" }
  ]
}
```

## Troubleshooting

### Debug Mode
View the `logs` array in API response for detailed operation trace.

### Enable Console Logging
The scripts log to console during execution. Check:
- Local: `npm run dev` output
- Vercel: Function logs in Vercel dashboard

### Test Connectivity
```bash
curl -X POST http://localhost:3000/api/quikSkope-webhook \
  -H "Content-Type: application/json" \
  -d '{"loadNumber":"test","driverName":"test",...}'
```

### Browser Issues
- Verify Browserless token is valid
- Check Browserless dashboard for rate limits
- Ensure network connectivity

## Performance

Typical submission times:
- Single load: 8-12 seconds
- Multiple pickups/deliveries: 15-25 seconds
- Form filling: 2-5 seconds per location

## Security

⚠️ **Important Security Notes:**
- Credentials stored in environment variables, never in code
- Use `.env.local` for local development (not committed to git)
- For Vercel, set secrets in dashboard (not in vercel.json)
- Passwords transmitted via HTTPS only
- Never share tokens or credentials

## Support & Contributing

For issues, questions, or contributions:
1. Check logs for detailed error messages
2. Verify all environment variables are set
3. Test with sample data first
4. Review code comments for implementation details

## License

MIT - See LICENSE file

---

**Last Updated:** January 2025
**Version:** 1.0.0
**Author:** Ed Mangino
