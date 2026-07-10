// Same 44-country list used by mobile at app/(auth)/country.tsx — keep these
// in sync. Country selection must be identical across platforms since it's a
// one-time, permanently-locked choice and admin must always see it correctly.

export interface Country {
  id: string
  name: string
}

export const COUNTRIES: Country[] = [
  { id: 'AF', name: 'Afghanistan' },
  { id: 'DZ', name: 'Algeria' },
  { id: 'AO', name: 'Angola' },
  { id: 'BF', name: 'Burkina Faso' },
  { id: 'BI', name: 'Burundi' },
  { id: 'CM', name: 'Cameroon' },
  { id: 'TD', name: 'Chad' },
  { id: 'KM', name: 'Comoros' },
  { id: 'CD', name: 'Congo (DRC)' },
  { id: 'DJ', name: 'Djibouti' },
  { id: 'EG', name: 'Egypt' },
  { id: 'ER', name: 'Eritrea' },
  { id: 'ET', name: 'Ethiopia' },
  { id: 'GH', name: 'Ghana' },
  { id: 'GN', name: 'Guinea' },
  { id: 'CI', name: 'Ivory Coast' },
  { id: 'KE', name: 'Kenya' },
  { id: 'LR', name: 'Liberia' },
  { id: 'LY', name: 'Libya' },
  { id: 'MG', name: 'Madagascar' },
  { id: 'MW', name: 'Malawi' },
  { id: 'ML', name: 'Mali' },
  { id: 'MR', name: 'Mauritania' },
  { id: 'MA', name: 'Morocco' },
  { id: 'MZ', name: 'Mozambique' },
  { id: 'NA', name: 'Namibia' },
  { id: 'NE', name: 'Niger' },
  { id: 'NG', name: 'Nigeria' },
  { id: 'RW', name: 'Rwanda' },
  { id: 'SA', name: 'Saudi Arabia' },
  { id: 'SN', name: 'Senegal' },
  { id: 'SL', name: 'Sierra Leone' },
  { id: 'SO', name: 'Somalia' },
  { id: 'ZA', name: 'South Africa' },
  { id: 'SS', name: 'South Sudan' },
  { id: 'SD', name: 'Sudan' },
  { id: 'TZ', name: 'Tanzania' },
  { id: 'TN', name: 'Tunisia' },
  { id: 'UG', name: 'Uganda' },
  { id: 'AE', name: 'United Arab Emirates' },
  { id: 'GB', name: 'United Kingdom' },
  { id: 'US', name: 'United States' },
  { id: 'YE', name: 'Yemen' },
  { id: 'ZM', name: 'Zambia' },
  { id: 'ZW', name: 'Zimbabwe' },
].sort((a, b) => a.name.localeCompare(b.name))
