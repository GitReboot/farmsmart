/** Languages the growing plan can be written in (focus on Sub-Saharan Africa). */
export const LANGUAGES: Record<string, string> = {
  en: 'English',
  fr: 'French',
  pt: 'Portuguese',
  sw: 'Swahili',
  am: 'Amharic',
  om: 'Oromo',
  so: 'Somali',
  ha: 'Hausa',
  yo: 'Yoruba',
  ig: 'Igbo',
  wo: 'Wolof',
  ak: 'Twi (Akan)',
  rw: 'Kinyarwanda',
  lg: 'Luganda',
  ny: 'Chichewa',
  sn: 'Shona',
  zu: 'Zulu',
  xh: 'Xhosa',
};

export const LANGUAGE_CODES = Object.keys(LANGUAGES) as [string, ...string[]];
