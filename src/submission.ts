import type { SelectedCharity } from './pledge';

export type Brand = 'Apple' | 'Samsung' | 'Google' | 'Motorola' | 'Other';
export type Age = '0-1 year' | '2-3 years' | '4-5 years' | '6+ years';
export type Condition = 'Excellent' | 'Good' | 'Fair' | 'Damaged';
export type Storage = '64 GB or less' | '128 GB' | '256 GB' | '512 GB+';
export type ShippingMethod = 'label' | 'kit';

export type Device = {
  id: string;
  brand: Brand;
  model: string;
  age: Age;
  condition: Condition;
  storage: Storage;
  powersOn: boolean;
  unlocked: boolean;
};

export type DonorDetails = {
  name: string;
  email: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
};

export type DonationSubmission = {
  id: string;
  createdAt: string;
  donor: DonorDetails;
  shippingMethod: ShippingMethod;
  devices: Device[];
  charity: SelectedCharity;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function validateDonationSubmission(value: unknown): value is DonationSubmission {
  if (!isObject(value)) return false;
  const donor = value.donor;
  const charity = value.charity;
  if (!isObject(donor) || !isObject(charity)) return false;
  if (typeof value.id !== 'string' || !value.id.startsWith('DBM-')) return false;
  if (typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt))) return false;
  if (!Array.isArray(value.devices) || value.devices.length < 1 || value.devices.length > 20) return false;
  if (value.shippingMethod !== 'label' && value.shippingMethod !== 'kit') return false;
  if (typeof donor.name !== 'string' || donor.name.trim().length < 2) return false;
  if (typeof donor.email !== 'string' || !EMAIL_PATTERN.test(donor.email)) return false;
  if (typeof donor.address1 !== 'string' || !donor.address1.trim()) return false;
  if (typeof donor.city !== 'string' || !donor.city.trim()) return false;
  if (typeof donor.state !== 'string' || donor.state.length !== 2) return false;
  if (typeof donor.zip !== 'string' || !/^\d{5}(?:-\d{4})?$/.test(donor.zip)) return false;
  if (typeof charity.pledgeId !== 'string' || !UUID_PATTERN.test(charity.pledgeId)) return false;
  if (typeof charity.name !== 'string' || !charity.name.trim()) return false;
  return value.devices.every((device) => {
    if (!isObject(device)) return false;
    return typeof device.id === 'string' &&
      typeof device.brand === 'string' &&
      typeof device.age === 'string' &&
      typeof device.condition === 'string' &&
      typeof device.storage === 'string' &&
      typeof device.powersOn === 'boolean' &&
      typeof device.unlocked === 'boolean';
  });
}

export function charityLocation(charity: SelectedCharity): string {
  return [charity.city, charity.state, charity.country].filter(Boolean).join(', ') || 'Not provided';
}

export function describeDevice(device: Device, index: number): string {
  return `${index + 1}. ${device.brand}${device.model.trim() ? ` ${device.model.trim()}` : ''} smartphone, ${device.age} old, ${device.condition.toLowerCase()} condition, ${device.storage}, ${device.powersOn ? 'powers on' : 'does not power on'}, ${device.unlocked ? 'reported unlocked' : 'carrier lock unknown or active'}`;
}

export function buildAdministratorNotification(record: DonationSubmission): string {
  const devices = record.devices.map(describeDevice).join('\n');
  return [
    'New Donate by Mail phone-donation packet',
    '',
    `Donation ID: ${record.id}`,
    `Created: ${record.createdAt}`,
    '',
    'Selected Charity',
    `Name: ${record.charity.name}`,
    `Pledge ID: ${record.charity.pledgeId}`,
    `EIN: ${record.charity.ein || 'Not provided'}`,
    `Location: ${charityLocation(record.charity)}`,
    `Website: ${record.charity.websiteUrl || 'Not provided'}`,
    '',
    'Donor',
    `Name: ${record.donor.name}`,
    `Email: ${record.donor.email}`,
    `Address: ${record.donor.address1}${record.donor.address2 ? `, ${record.donor.address2}` : ''}, ${record.donor.city}, ${record.donor.state} ${record.donor.zip}`,
    '',
    'Mailing choice',
    record.shippingMethod === 'label' ? 'Printable prepaid label' : 'Mail-in kit requested',
    '',
    'Phones',
    devices,
    '',
    'This notification records a charity selection only. No money was sent through Pledge.',
  ].join('\n');
}
