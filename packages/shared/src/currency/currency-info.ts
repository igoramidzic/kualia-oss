export interface CurrencyInfo {
  code: string;
  name: string;
  symbol: string;
  flagEmoji?: string;
}

export const CURRENCY_INFO: Record<string, CurrencyInfo> = {
  // Major currencies
  USD: { code: 'USD', name: 'United States Dollar', symbol: '$', flagEmoji: '🇺🇸' },
  EUR: { code: 'EUR', name: 'Euro', symbol: '€', flagEmoji: '🇪🇺' },
  GBP: { code: 'GBP', name: 'British Pound', symbol: '£', flagEmoji: '🇬🇧' },
  CAD: { code: 'CAD', name: 'Canadian Dollar', symbol: '$', flagEmoji: '🇨🇦' },
  AUD: { code: 'AUD', name: 'Australian Dollar', symbol: '$', flagEmoji: '🇦🇺' },

  // Popular currencies
  JPY: { code: 'JPY', name: 'Japanese Yen', symbol: '¥', flagEmoji: '🇯🇵' },
  CHF: { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', flagEmoji: '🇨🇭' },
  CNY: { code: 'CNY', name: 'Chinese Yuan', symbol: 'CN¥', flagEmoji: '🇨🇳' },
  SEK: { code: 'SEK', name: 'Swedish Krona', symbol: 'SEK', flagEmoji: '🇸🇪' },
  NZD: { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$', flagEmoji: '🇳🇿' },
  MXN: { code: 'MXN', name: 'Mexican Peso', symbol: '$', flagEmoji: '🇲🇽' },
  SGD: { code: 'SGD', name: 'Singapore Dollar', symbol: '$SG', flagEmoji: '🇸🇬' },
  HKD: { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$', flagEmoji: '🇭🇰' },
  NOK: { code: 'NOK', name: 'Norwegian Krone', symbol: 'NOK', flagEmoji: '🇳🇴' },
  KRW: { code: 'KRW', name: 'South Korean Won', symbol: '₩', flagEmoji: '🇰🇷' },

  // Other currencies
  AED: { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ.‏', flagEmoji: '🇦🇪' },
  AFN: { code: 'AFN', name: 'Afghan Afghani', symbol: 'AFN', flagEmoji: '🇦🇫' },
  ALL: { code: 'ALL', name: 'Albanian Lek', symbol: 'ALL', flagEmoji: '🇦🇱' },
  AMD: { code: 'AMD', name: 'Armenian Dram', symbol: '֏', flagEmoji: '🇦🇲' },
  ANG: { code: 'ANG', name: 'Netherlands Antillean Guilder', symbol: 'ANG' },
  AOA: { code: 'AOA', name: 'Angolan Kwanza', symbol: 'AOA', flagEmoji: '🇦🇴' },
  ARS: { code: 'ARS', name: 'Argentine Peso', symbol: '$AR', flagEmoji: '🇦🇷' },
  AWG: { code: 'AWG', name: 'Aruban Florin', symbol: 'AWG', flagEmoji: '🇦🇼' },
  AZN: { code: 'AZN', name: 'Azerbaijani Manat', symbol: 'AZN', flagEmoji: '🇦🇿' },
  BAM: { code: 'BAM', name: 'Bosnia-Herzegovina Convertible Mark', symbol: 'BAM', flagEmoji: '🇧🇦' },
  BBD: { code: 'BBD', name: 'Barbadian Dollar', symbol: 'BBD', flagEmoji: '🇧🇧' },
  BDT: { code: 'BDT', name: 'Bangladeshi Taka', symbol: 'BDT', flagEmoji: '🇧🇩' },
  BGN: { code: 'BGN', name: 'Bulgarian Lev', symbol: 'BGN', flagEmoji: '🇧🇬' },
  BHD: { code: 'BHD', name: 'Bahraini Dinar', symbol: 'د.ب.‏', flagEmoji: '🇧🇭' },
  BIF: { code: 'BIF', name: 'Burundian Franc', symbol: 'BIF', flagEmoji: '🇧🇮' },
  BMD: { code: 'BMD', name: 'Bermudian Dollar', symbol: '$BM', flagEmoji: '🇧🇲' },
  BND: { code: 'BND', name: 'Brunei Dollar', symbol: '$BN', flagEmoji: '🇧🇳' },
  BOB: { code: 'BOB', name: 'Bolivian Boliviano', symbol: 'BOB', flagEmoji: '🇧🇴' },
  BRL: { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', flagEmoji: '🇧🇷' },
  BSD: { code: 'BSD', name: 'Bahamian Dollar', symbol: 'BSD', flagEmoji: '🇧🇸' },
  BTN: { code: 'BTN', name: 'Bhutanese Ngultrum', symbol: 'BTN', flagEmoji: '🇧🇹' },
  BWP: { code: 'BWP', name: 'Botswana Pula', symbol: 'BWP', flagEmoji: '🇧🇼' },
  BYN: { code: 'BYN', name: 'Belarusian Ruble', symbol: 'BYN', flagEmoji: '🇧🇾' },
  BZD: { code: 'BZD', name: 'Belize Dollar', symbol: '$BZ', flagEmoji: '🇧🇿' },
  CDF: { code: 'CDF', name: 'Congolese Franc', symbol: 'CDF', flagEmoji: '🇨🇩' },
  CLP: { code: 'CLP', name: 'Chilean Peso', symbol: '$CL', flagEmoji: '🇨🇱' },
  COP: { code: 'COP', name: 'Colombian Peso', symbol: '$CO', flagEmoji: '🇨🇴' },
  CRC: { code: 'CRC', name: 'Costa Rican Colón', symbol: 'CRC', flagEmoji: '🇨🇷' },
  CUP: { code: 'CUP', name: 'Cuban Peso', symbol: 'CUP', flagEmoji: '🇨🇺' },
  CVE: { code: 'CVE', name: 'Cape Verdean Escudo', symbol: 'CVE', flagEmoji: '🇨🇻' },
  CZK: { code: 'CZK', name: 'Czech Koruna', symbol: 'CZK', flagEmoji: '🇨🇿' },
  DJF: { code: 'DJF', name: 'Djiboutian Franc', symbol: 'DJF', flagEmoji: '🇩🇯' },
  DKK: { code: 'DKK', name: 'Danish Krone', symbol: 'DKK', flagEmoji: '🇩🇰' },
  DOP: { code: 'DOP', name: 'Dominican Peso', symbol: 'DOP', flagEmoji: '🇩🇴' },
  DZD: { code: 'DZD', name: 'Algerian Dinar', symbol: 'د.ج.‏', flagEmoji: '🇩🇿' },
  EGP: { code: 'EGP', name: 'Egyptian Pound', symbol: 'ج.م.‏', flagEmoji: '🇪🇬' },
  ERN: { code: 'ERN', name: 'Eritrean Nakfa', symbol: 'ERN', flagEmoji: '🇪🇷' },
  ETB: { code: 'ETB', name: 'Ethiopian Birr', symbol: 'ETB', flagEmoji: '🇪🇹' },
  FJD: { code: 'FJD', name: 'Fijian Dollar', symbol: '$FJ', flagEmoji: '🇫🇯' },
  FKP: { code: 'FKP', name: 'Falkland Islands Pound', symbol: '£FK', flagEmoji: '🇫🇰' },
  GEL: { code: 'GEL', name: 'Georgian Lari', symbol: 'GEL', flagEmoji: '🇬🇪' },
  GHS: { code: 'GHS', name: 'Ghanaian Cedi', symbol: 'GHS', flagEmoji: '🇬🇭' },
  GIP: { code: 'GIP', name: 'Gibraltar Pound', symbol: '£GI', flagEmoji: '🇬🇮' },
  GMD: { code: 'GMD', name: 'Gambian Dalasi', symbol: 'GMD', flagEmoji: '🇬🇲' },
  GNF: { code: 'GNF', name: 'Guinean Franc', symbol: 'GNF', flagEmoji: '🇬🇳' },
  GTQ: { code: 'GTQ', name: 'Guatemalan Quetzal', symbol: 'GTQ', flagEmoji: '🇬🇹' },
  GYD: { code: 'GYD', name: 'Guyanese Dollar', symbol: 'GYD', flagEmoji: '🇬🇾' },
  HNL: { code: 'HNL', name: 'Honduran Lempira', symbol: 'HNL', flagEmoji: '🇭🇳' },
  HRK: { code: 'HRK', name: 'Croatian Kuna', symbol: 'HRK', flagEmoji: '🇭🇷' },
  HTG: { code: 'HTG', name: 'Haitian Gourde', symbol: 'HTG', flagEmoji: '🇭🇹' },
  HUF: { code: 'HUF', name: 'Hungarian Forint', symbol: 'HUF', flagEmoji: '🇭🇺' },
  IDR: { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'IDR', flagEmoji: '🇮🇩' },
  ILS: { code: 'ILS', name: 'Israeli New Shekel', symbol: '₪', flagEmoji: '🇮🇱' },
  INR: { code: 'INR', name: 'Indian Rupee', symbol: '₹', flagEmoji: '🇮🇳' },
  IQD: { code: 'IQD', name: 'Iraqi Dinar', symbol: 'د.ع.‏', flagEmoji: '🇮🇶' },
  IRR: { code: 'IRR', name: 'Iranian Rial', symbol: 'ر.إ.', flagEmoji: '🇮🇷' },
  ISK: { code: 'ISK', name: 'Icelandic Króna', symbol: 'ISK', flagEmoji: '🇮🇸' },
  JMD: { code: 'JMD', name: 'Jamaican Dollar', symbol: 'JMD', flagEmoji: '🇯🇲' },
  JOD: { code: 'JOD', name: 'Jordanian Dinar', symbol: 'د.أ.‏', flagEmoji: '🇯🇴' },
  KES: { code: 'KES', name: 'Kenyan Shilling', symbol: 'KES', flagEmoji: '🇰🇪' },
  KGS: { code: 'KGS', name: 'Kyrgyzstani Som', symbol: 'KGS', flagEmoji: '🇰🇬' },
  KHR: { code: 'KHR', name: 'Cambodian Riel', symbol: 'KHR', flagEmoji: '🇰🇭' },
  KMF: { code: 'KMF', name: 'Comorian Franc', symbol: 'KMF', flagEmoji: '🇰🇲' },
  KPW: { code: 'KPW', name: 'North Korean Won', symbol: 'KPW', flagEmoji: '🇰🇵' },
  KWD: { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'د.ك.‏', flagEmoji: '🇰🇼' },
  KYD: { code: 'KYD', name: 'Cayman Islands Dollar', symbol: 'KYD', flagEmoji: '🇰🇾' },
  KZT: { code: 'KZT', name: 'Kazakhstani Tenge', symbol: 'KZT', flagEmoji: '🇰🇿' },
  LAK: { code: 'LAK', name: 'Lao Kip', symbol: 'LAK', flagEmoji: '🇱🇦' },
  LBP: { code: 'LBP', name: 'Lebanese Pound', symbol: '£LB', flagEmoji: '🇱🇧' },
  LKR: { code: 'LKR', name: 'Sri Lankan Rupee', symbol: 'LKR', flagEmoji: '🇱🇰' },
  LRD: { code: 'LRD', name: 'Liberian Dollar', symbol: 'LRD', flagEmoji: '🇱🇷' },
  LSL: { code: 'LSL', name: 'Lesotho Loti', symbol: 'LSL', flagEmoji: '🇱🇸' },
  LYD: { code: 'LYD', name: 'Libyan Dinar', symbol: 'د.ل.‏', flagEmoji: '🇱🇾' },
  MAD: { code: 'MAD', name: 'Moroccan Dirham', symbol: 'د.م.‏', flagEmoji: '🇲🇦' },
  MDL: { code: 'MDL', name: 'Moldovan Leu', symbol: 'MDL', flagEmoji: '🇲🇩' },
  MGA: { code: 'MGA', name: 'Malagasy Ariary', symbol: 'MGA', flagEmoji: '🇲🇬' },
  MKD: { code: 'MKD', name: 'Macedonian Denar', symbol: 'MKD', flagEmoji: '🇲🇰' },
  MMK: { code: 'MMK', name: 'Myanmar Kyat', symbol: 'MMK', flagEmoji: '🇲🇲' },
  MNT: { code: 'MNT', name: 'Mongolian Tugrik', symbol: 'MNT', flagEmoji: '🇲🇳' },
  MOP: { code: 'MOP', name: 'Macanese Pataca', symbol: 'MOP', flagEmoji: '🇲🇴' },
  MRU: { code: 'MRU', name: 'Mauritanian Ouguiya', symbol: 'أ.م.', flagEmoji: '🇲🇷' },
  MUR: { code: 'MUR', name: 'Mauritian Rupee', symbol: 'MUR', flagEmoji: '🇲🇺' },
  MVR: { code: 'MVR', name: 'Maldivian Rufiyaa', symbol: 'MVR', flagEmoji: '🇲🇻' },
  MWK: { code: 'MWK', name: 'Malawian Kwacha', symbol: 'MWK', flagEmoji: '🇲🇼' },
  MYR: { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'MYR', flagEmoji: '🇲🇾' },
  MZN: { code: 'MZN', name: 'Mozambican Metical', symbol: 'MZN', flagEmoji: '🇲🇿' },
  NAD: { code: 'NAD', name: 'Namibian Dollar', symbol: '$NA', flagEmoji: '🇳🇦' },
  NGN: { code: 'NGN', name: 'Nigerian Naira', symbol: 'NGN', flagEmoji: '🇳🇬' },
  NIO: { code: 'NIO', name: 'Nicaraguan Córdoba', symbol: 'NIO', flagEmoji: '🇳🇮' },
  NPR: { code: 'NPR', name: 'Nepalese Rupee', symbol: 'NPR', flagEmoji: '🇳🇵' },
  OMR: { code: 'OMR', name: 'Omani Rial', symbol: 'ر.ع.‏', flagEmoji: '🇴🇲' },
  PAB: { code: 'PAB', name: 'Panamanian Balboa', symbol: 'PAB', flagEmoji: '🇵🇦' },
  PEN: { code: 'PEN', name: 'Peruvian Sol', symbol: 'PEN', flagEmoji: '🇵🇪' },
  PGK: { code: 'PGK', name: 'Papua New Guinean Kina', symbol: 'PGK', flagEmoji: '🇵🇬' },
  PHP: { code: 'PHP', name: 'Philippine Peso', symbol: '₱', flagEmoji: '🇵🇭' },
  PKR: { code: 'PKR', name: 'Pakistani Rupee', symbol: 'PKR', flagEmoji: '🇵🇰' },
  PLN: { code: 'PLN', name: 'Polish Złoty', symbol: 'PLN', flagEmoji: '🇵🇱' },
  PYG: { code: 'PYG', name: 'Paraguayan Guarani', symbol: 'PYG', flagEmoji: '🇵🇾' },
  QAR: { code: 'QAR', name: 'Qatari Riyal', symbol: 'ر.ق.‏', flagEmoji: '🇶🇦' },
  RON: { code: 'RON', name: 'Romanian Leu', symbol: 'RON', flagEmoji: '🇷🇴' },
  RSD: { code: 'RSD', name: 'Serbian Dinar', symbol: 'RSD', flagEmoji: '🇷🇸' },
  RUB: { code: 'RUB', name: 'Russian Ruble', symbol: '₽', flagEmoji: '🇷🇺' },
  RWF: { code: 'RWF', name: 'Rwandan Franc', symbol: 'RWF', flagEmoji: '🇷🇼' },
  SAR: { code: 'SAR', name: 'Saudi Riyal', symbol: 'ر.س.‏', flagEmoji: '🇸🇦' },
  SBD: { code: 'SBD', name: 'Solomon Islands Dollar', symbol: '$SB', flagEmoji: '🇸🇧' },
  SCR: { code: 'SCR', name: 'Seychellois Rupee', symbol: 'SCR', flagEmoji: '🇸🇨' },
  SDG: { code: 'SDG', name: 'Sudanese Pound', symbol: 'ج.س.', flagEmoji: '🇸🇩' },
  SHP: { code: 'SHP', name: 'Saint Helena Pound', symbol: 'SHP', flagEmoji: '🇸🇭' },
  SLE: { code: 'SLE', name: 'Sierra Leonean Leone', symbol: 'SLE', flagEmoji: '🇸🇱' },
  SLL: { code: 'SLL', name: 'Sierra Leonean Leone (old)', symbol: 'SLL', flagEmoji: '🇸🇱' },
  SOS: { code: 'SOS', name: 'Somali Shilling', symbol: 'SOS', flagEmoji: '🇸🇴' },
  SRD: { code: 'SRD', name: 'Surinamese Dollar', symbol: '$SR', flagEmoji: '🇸🇷' },
  SSP: { code: 'SSP', name: 'South Sudanese Pound', symbol: 'SSP', flagEmoji: '🇸🇸' },
  STN: { code: 'STN', name: 'São Tomé and Príncipe Dobra', symbol: 'STN', flagEmoji: '🇸🇹' },
  SYP: { code: 'SYP', name: 'Syrian Pound', symbol: 'ل.س.‏', flagEmoji: '🇸🇾' },
  SZL: { code: 'SZL', name: 'Swazi Lilangeni', symbol: 'SZL', flagEmoji: '🇸🇿' },
  THB: { code: 'THB', name: 'Thai Baht', symbol: '฿', flagEmoji: '🇹🇭' },
  TJS: { code: 'TJS', name: 'Tajikistani Somoni', symbol: 'TJS', flagEmoji: '🇹🇯' },
  TMT: { code: 'TMT', name: 'Turkmenistani Manat', symbol: 'ТМТ', flagEmoji: '🇹🇲' },
  TND: { code: 'TND', name: 'Tunisian Dinar', symbol: 'د.ت.‏', flagEmoji: '🇹🇳' },
  TOP: { code: 'TOP', name: 'Tongan Paʻanga', symbol: 'TOP', flagEmoji: '🇹🇴' },
  TRY: { code: 'TRY', name: 'Turkish Lira', symbol: 'TRY', flagEmoji: '🇹🇷' },
  TTD: { code: 'TTD', name: 'Trinidad and Tobago Dollar', symbol: '$TT', flagEmoji: '🇹🇹' },
  TWD: { code: 'TWD', name: 'New Taiwan Dollar', symbol: 'NT$', flagEmoji: '🇹🇼' },
  TZS: { code: 'TZS', name: 'Tanzanian Shilling', symbol: 'TZS', flagEmoji: '🇹🇿' },
  UAH: { code: 'UAH', name: 'Ukrainian Hryvnia', symbol: '₴', flagEmoji: '🇺🇦' },
  UGX: { code: 'UGX', name: 'Ugandan Shilling', symbol: 'UGX', flagEmoji: '🇺🇬' },
  UYU: { code: 'UYU', name: 'Uruguayan Peso', symbol: '$UY', flagEmoji: '🇺🇾' },
  UZS: { code: 'UZS', name: 'Uzbekistani Som', symbol: 'UZS', flagEmoji: '🇺🇿' },
  VES: { code: 'VES', name: 'Venezuelan Bolívar', symbol: 'VES', flagEmoji: '🇻🇪' },
  VND: { code: 'VND', name: 'Vietnamese Đồng', symbol: '₫', flagEmoji: '🇻🇳' },
  VUV: { code: 'VUV', name: 'Vanuatu Vatu', symbol: 'VUV', flagEmoji: '🇻🇺' },
  WST: { code: 'WST', name: 'Samoan Tala', symbol: '$WS', flagEmoji: '🇼🇸' },
  XAF: { code: 'XAF', name: 'Central African CFA Franc', symbol: 'FCFA', flagEmoji: '🇨🇲' },
  XCD: { code: 'XCD', name: 'East Caribbean Dollar', symbol: 'EC$' },
  XOF: { code: 'XOF', name: 'West African CFA Franc', symbol: 'F CFA' },
  XPF: { code: 'XPF', name: 'CFP Franc', symbol: 'CFPF' },
  YER: { code: 'YER', name: 'Yemeni Rial', symbol: 'ر.ي.‏', flagEmoji: '🇾🇪' },
  ZAR: { code: 'ZAR', name: 'South African Rand', symbol: 'ZAR', flagEmoji: '🇿🇦' },
  ZMW: { code: 'ZMW', name: 'Zambian Kwacha', symbol: 'ZMW', flagEmoji: '🇿🇲' },
  ZWG: { code: 'ZWG', name: 'Zimbabwean Dollar', symbol: 'ZWG', flagEmoji: '🇿🇼' },
};

// Get all currency codes sorted alphabetically
export const CURRENCY_CODES = Object.keys(CURRENCY_INFO).sort();

// Get common currencies that should appear at the top of lists
export const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'CNY'];

// Get currency info by code
export function getCurrencyInfo(code: string): CurrencyInfo | undefined {
  return CURRENCY_INFO[code.toUpperCase()];
}

// Get all currencies sorted with common ones first
export function getAllCurrencies(): CurrencyInfo[] {
  const commonCurrencyInfos = COMMON_CURRENCIES.map((code) => CURRENCY_INFO[code]).filter(Boolean);
  const otherCurrencies = Object.values(CURRENCY_INFO)
    .filter((currency) => !COMMON_CURRENCIES.includes(currency.code))
    .sort((a, b) => a.name.localeCompare(b.name));

  return [...commonCurrencyInfos, ...otherCurrencies];
}

// Search currencies by code or name
export function searchCurrencies(query: string): CurrencyInfo[] {
  const lowerQuery = query.toLowerCase();
  return Object.values(CURRENCY_INFO).filter(
    (currency) => currency.code.toLowerCase().includes(lowerQuery) || currency.name.toLowerCase().includes(lowerQuery)
  );
}
