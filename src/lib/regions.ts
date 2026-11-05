export interface Country {
  code: string;
  name: string;
  flag: string;
  dial: string;
  /** National significant number length(s). */
  digits: number[];
  regionLabel: string;
  regions: string[];
}

export const COUNTRIES: Country[] = [
  {
    code: 'US', name: 'United States', flag: '🇺🇸', dial: '+1', digits: [10], regionLabel: 'State',
    regions: ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming', 'District of Columbia'],
  },
  {
    code: 'CA', name: 'Canada', flag: '🇨🇦', dial: '+1', digits: [10], regionLabel: 'Province',
    regions: ['Alberta', 'British Columbia', 'Manitoba', 'New Brunswick', 'Newfoundland and Labrador', 'Nova Scotia', 'Ontario', 'Prince Edward Island', 'Quebec', 'Saskatchewan', 'Northwest Territories', 'Nunavut', 'Yukon'],
  },
  {
    code: 'GB', name: 'United Kingdom', flag: '🇬🇧', dial: '+44', digits: [10], regionLabel: 'Nation',
    regions: ['England', 'Scotland', 'Wales', 'Northern Ireland'],
  },
  {
    code: 'AU', name: 'Australia', flag: '🇦🇺', dial: '+61', digits: [9], regionLabel: 'State',
    regions: ['New South Wales', 'Victoria', 'Queensland', 'Western Australia', 'South Australia', 'Tasmania', 'Australian Capital Territory', 'Northern Territory'],
  },
  {
    code: 'IN', name: 'India', flag: '🇮🇳', dial: '+91', digits: [10], regionLabel: 'State',
    regions: ['Delhi', 'Gujarat', 'Karnataka', 'Kerala', 'Maharashtra', 'Punjab', 'Rajasthan', 'Tamil Nadu', 'Telangana', 'Uttar Pradesh', 'West Bengal'],
  },
];

export const countryByCode = (code: string) => COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[0];

export function formatPhone(country: Country, digits: string): string {
  if (country.dial === '+1') {
    const d = digits.slice(0, 10);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return digits.replace(/(\d{4})(\d{3})?(\d+)?/, (_, a, b, c) => [a, b, c].filter(Boolean).join(' '));
}

export function maskPhone(e164: string): string {
  return e164.replace(/\d(?=\d{4})/g, '•');
}
