/** Sub-Saharan African countries (ISO 3166-1 alpha-2) with common name variants. */
export const SSA_COUNTRIES: Record<string, string[]> = {
  AO: ['Angola'],
  BJ: ['Benin'],
  BW: ['Botswana'],
  BF: ['Burkina Faso'],
  BI: ['Burundi'],
  CV: ['Cabo Verde', 'Cape Verde'],
  CM: ['Cameroon'],
  CF: ['Central African Republic', 'CAR'],
  TD: ['Chad'],
  KM: ['Comoros'],
  CD: ['Democratic Republic of the Congo', 'DR Congo', 'DRC', 'Congo-Kinshasa'],
  CG: ['Republic of the Congo', 'Congo', 'Congo-Brazzaville'],
  CI: ["Côte d'Ivoire", "Cote d'Ivoire", 'Ivory Coast'],
  DJ: ['Djibouti'],
  GQ: ['Equatorial Guinea'],
  ER: ['Eritrea'],
  SZ: ['Eswatini', 'Swaziland'],
  ET: ['Ethiopia'],
  GA: ['Gabon'],
  GM: ['Gambia', 'The Gambia'],
  GH: ['Ghana'],
  GN: ['Guinea'],
  GW: ['Guinea-Bissau'],
  KE: ['Kenya'],
  LS: ['Lesotho'],
  LR: ['Liberia'],
  MG: ['Madagascar'],
  MW: ['Malawi'],
  ML: ['Mali'],
  MR: ['Mauritania'],
  MU: ['Mauritius'],
  MZ: ['Mozambique'],
  NA: ['Namibia'],
  NE: ['Niger'],
  NG: ['Nigeria'],
  RW: ['Rwanda'],
  ST: ['São Tomé and Príncipe', 'Sao Tome and Principe'],
  SN: ['Senegal'],
  SC: ['Seychelles'],
  SL: ['Sierra Leone'],
  SO: ['Somalia'],
  ZA: ['South Africa'],
  SS: ['South Sudan'],
  SD: ['Sudan'],
  TZ: ['Tanzania', 'United Republic of Tanzania'],
  TG: ['Togo'],
  UG: ['Uganda'],
  ZM: ['Zambia'],
  ZW: ['Zimbabwe'],
};

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');

const lookup = new Map<string, string>();
for (const [code, names] of Object.entries(SSA_COUNTRIES)) {
  lookup.set(norm(code), code);
  for (const n of names) lookup.set(norm(n), code);
}

/** Resolve a country name or ISO code to an SSA ISO code, or null if not in the region. */
export function toSsaCountryCode(country: string): string | null {
  return lookup.get(norm(country)) ?? null;
}

export const isSsaCountryCode = (code: string | undefined) => !!code && code.toUpperCase() in SSA_COUNTRIES;
