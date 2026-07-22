// ─────────────────────────────────────────────────────────────────────────────
// Invoice configuration — company constants, HSN/SAC mapping, GST state codes.
// These are legal/company-fixed values that don't belong in the database.
// Override any of them via env vars in production.
// ─────────────────────────────────────────────────────────────────────────────

const COMPANY = {
  legalName: process.env.INVOICE_COMPANY || 'Plantura Care Private Limited',
  brand: process.env.INVOICE_BRAND || 'GharKaMali',
  brandTagline: process.env.INVOICE_BRAND_TAGLINE || 'Plants. People. Purpose.',
  cin: process.env.INVOICE_CIN || 'U72900DL2023PTC425123',
  gstin: process.env.INVOICE_GSTIN || '09AAQCP7633P1ZD',
  addressLines: (process.env.INVOICE_ADDRESS_LINES || 'B-112, Sector-64, Noida,|Gautam Buddha Nagar,|Uttar Pradesh - 201301, India').split('|'),
  phone: process.env.INVOICE_PHONE || '+91 98712 34567',
  email: process.env.INVOICE_EMAIL || 'hello@gharkamali.com',
  website: process.env.INVOICE_WEBSITE || 'www.gharkamali.com',
};

const BANK = {
  name: process.env.INVOICE_BANK_NAME || 'HDFC Bank Limited',
  accountName: process.env.INVOICE_BANK_AC_NAME || 'Plantura Care Private Limited',
  accountNumber: process.env.INVOICE_BANK_AC_NO || '50200012345678',
  ifsc: process.env.INVOICE_BANK_IFSC || 'HDFC0001234',
  upi: process.env.INVOICE_UPI || 'gharkamali@okhdfcbank',
};

const TERMS = (process.env.INVOICE_TERMS || [
  'Payment is non-refundable once the service is completed.',
  'Monthly maintenance plans are valid for the mentioned period only.',
  'Extra visits or additional plants will be charged separately.',
  'Goods once sold will not be taken back.',
].join('|')).split('|');

const FOOTER_BADGES = [
  'WE CARE FOR YOUR PLANTS',
  'EXPERT GARDENERS',
  'QUALITY PRODUCTS',
  'ON-TIME SERVICE',
];

// ── HSN / SAC codes ──────────────────────────────────────────────────────────
// Services use a SAC; goods use an HSN. Products are mapped by category name
// (lowercased, substring match) since the Product model has no hsn_code column.
const SERVICE_SAC = '998597';          // Gardening / landscaping services
const DEFAULT_PRODUCT_HSN = '3926';    // Generic plastic articles fallback

const HSN_BY_CATEGORY = [
  { match: ['plastic pot', 'plastic'], hsn: '3926', unit: 'Nos' },
  { match: ['ceramic', 'clay pot', 'terracotta'], hsn: '6912', unit: 'Nos' },
  { match: ['compost', 'vermicompost', 'fertilizer', 'manure'], hsn: '31010099', unit: 'Pack' },
  { match: ['seed'], hsn: '1209', unit: 'Pack' },
  { match: ['plant', 'sapling', 'live'], hsn: '0602', unit: 'Nos' },
  { match: ['tool', 'pruner', 'cutter', 'shear'], hsn: '8201', unit: 'Nos' },
  { match: ['soil', 'cocopeat', 'peat'], hsn: '2703', unit: 'Pack' },
  { match: ['pesticide', 'insecticide'], hsn: '3808', unit: 'Pack' },
];

// Resolve HSN + unit for a product using its category and/or name.
function hsnForProduct(productName = '', categoryName = '') {
  const hay = `${categoryName} ${productName}`.toLowerCase();
  for (const row of HSN_BY_CATEGORY) {
    if (row.match.some((m) => hay.includes(m))) return { hsn: row.hsn, unit: row.unit };
  }
  return { hsn: DEFAULT_PRODUCT_HSN, unit: 'Nos' };
}

// ── GST state codes (Place of Supply) ────────────────────────────────────────
const STATE_CODES = {
  'jammu and kashmir': '01', 'himachal pradesh': '02', 'punjab': '03', 'chandigarh': '04',
  'uttarakhand': '05', 'haryana': '06', 'delhi': '07', 'rajasthan': '08',
  'uttar pradesh': '09', 'bihar': '10', 'sikkim': '11', 'arunachal pradesh': '12',
  'nagaland': '13', 'manipur': '14', 'mizoram': '15', 'tripura': '16',
  'meghalaya': '17', 'assam': '18', 'west bengal': '19', 'jharkhand': '20',
  'odisha': '21', 'chhattisgarh': '22', 'madhya pradesh': '23', 'gujarat': '24',
  'maharashtra': '27', 'karnataka': '29', 'goa': '30', 'kerala': '32',
  'tamil nadu': '33', 'puducherry': '34', 'telangana': '36', 'andhra pradesh': '37',
};

const HOME_STATE = (process.env.INVOICE_HOME_STATE || 'uttar pradesh').toLowerCase();

// "Uttar Pradesh (09)" — falls back to the raw state when unknown.
function placeOfSupply(state) {
  const s = String(state || '').trim();
  if (!s) return `${title(HOME_STATE)} (${STATE_CODES[HOME_STATE]})`;
  const code = STATE_CODES[s.toLowerCase()];
  return code ? `${title(s)} (${code})` : title(s);
}

const title = (s) => String(s).replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

// ── Amount in words (Indian numbering) ───────────────────────────────────────
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n) {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? '-' + ONES[n % 10] : ''}`;
}

function threeDigits(n) {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', rest ? twoDigits(rest) : ''].filter(Boolean).join(' ');
}

// 3855.02 -> "Three Thousand Eight Hundred Fifty-Five Rupees and Two Paise Only"
function amountInWords(amount) {
  const num = Math.abs(Number(amount) || 0);
  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);

  if (rupees === 0 && paise === 0) return 'Zero Rupees Only';

  const parts = [];
  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const hundred = rupees % 1000;

  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${threeDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${threeDigits(thousand)} Thousand`);
  if (hundred) parts.push(threeDigits(hundred));

  let words = parts.filter(Boolean).join(' ').trim();
  words = words ? `${words} Rupees` : 'Zero Rupees';
  if (paise) words += ` and ${twoDigits(paise)} Paise`;
  return `${words} Only`;
}

// ── Financial-year invoice numbering ─────────────────────────────────────────
// Indian FY runs Apr 1 → Mar 31. April 2025 → "25-26".
function financialYear(date = new Date()) {
  const d = new Date(date);
  const y = d.getFullYear();
  const startYear = d.getMonth() >= 3 ? y : y - 1; // month 3 = April
  return `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
}

// GKM/25-26/000123
function formatInvoiceNumber(seq, date = new Date(), prefix = process.env.INVOICE_PREFIX || 'GKM') {
  return `${prefix}/${financialYear(date)}/${String(seq).padStart(6, '0')}`;
}

module.exports = {
  COMPANY, BANK, TERMS, FOOTER_BADGES,
  SERVICE_SAC, DEFAULT_PRODUCT_HSN, hsnForProduct,
  STATE_CODES, placeOfSupply, title,
  amountInWords, financialYear, formatInvoiceNumber,
};
