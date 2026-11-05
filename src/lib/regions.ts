export interface Country {
  code: string;
  name: string;
  flag: string;
  regionLabel: string;
  regions: string[];
}

export const COUNTRIES: Country[] = [
  {
    code: 'US', name: 'United States', flag: '🇺🇸', regionLabel: 'State',
    regions: ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming', 'District of Columbia'],
  },
  {
    code: 'CA', name: 'Canada', flag: '🇨🇦', regionLabel: 'Province',
    regions: ['Alberta', 'British Columbia', 'Manitoba', 'New Brunswick', 'Newfoundland and Labrador', 'Nova Scotia', 'Ontario', 'Prince Edward Island', 'Quebec', 'Saskatchewan', 'Northwest Territories', 'Nunavut', 'Yukon'],
  },
  {
    code: 'GB', name: 'United Kingdom', flag: '🇬🇧', regionLabel: 'Nation',
    regions: ['England', 'Scotland', 'Wales', 'Northern Ireland'],
  },
  {
    code: 'AU', name: 'Australia', flag: '🇦🇺', regionLabel: 'State',
    regions: ['New South Wales', 'Victoria', 'Queensland', 'Western Australia', 'South Australia', 'Tasmania', 'Australian Capital Territory', 'Northern Territory'],
  },
  {
    code: 'IN', name: 'India', flag: '🇮🇳', regionLabel: 'State',
    regions: ['Delhi', 'Gujarat', 'Karnataka', 'Kerala', 'Maharashtra', 'Punjab', 'Rajasthan', 'Tamil Nadu', 'Telangana', 'Uttar Pradesh', 'West Bengal'],
  },
];

export const countryByCode = (code: string) => COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[0];
