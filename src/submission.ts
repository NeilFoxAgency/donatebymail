import type { SelectedCharity } from "./pledge";
import { ISO_COUNTRY_CODES } from "./countries";
export type Brand = "Apple" | "Samsung" | "Google" | "Motorola" | "Other";
export type Age = "0-1 year" | "2-3 years" | "4-5 years" | "6+ years";
export type Condition = "Excellent" | "Good" | "Fair" | "Damaged";
export type Storage = "64 GB or less" | "128 GB" | "256 GB" | "512 GB+";
export type ShippingMethod = "label";
export const DONATE_BY_MAIL_ADDRESS = [
  "Donate By Mail",
  "4103 Tropical Isle Blvd, Apt 124",
  "Kissimmee, FL 34741",
] as const;
export const DONATE_BY_MAIL_ADDRESS_TEXT = DONATE_BY_MAIL_ADDRESS.join("\n");
export const MAX_DONATION_DEVICES = 20;
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
  firstName: string;
  middleName: string;
  lastName: string;
  email: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  marketingEmailConsent: boolean;
  marketingConsentAt?: string;
};
export type DonationSubmission = {
  id: string;
  clientSubmissionKey: string;
  createdAt: string;
  donor: DonorDetails;
  shippingMethod: ShippingMethod;
  devices: Device[];
  charity: SelectedCharity;
  campaignSlug?: string;
};
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BRANDS: readonly Brand[] = ["Apple", "Samsung", "Google", "Motorola", "Other"];
const AGES: readonly Age[] = ["0-1 year", "2-3 years", "4-5 years", "6+ years"];
const CONDITIONS: readonly Condition[] = ["Excellent", "Good", "Fair", "Damaged"];
const STORAGE_VALUES: readonly Storage[] = ["64 GB or less", "128 GB", "256 GB", "512 GB+"];
const COUNTRY_CODES = new Set(ISO_COUNTRY_CODES);
const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
]);
const isObject = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);
const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const boundedText = (value: unknown, maximum: number, required = false): value is string =>
  typeof value === "string" && value.length <= maximum && (!required || value.trim().length > 0);
const optionalText = (value: unknown, maximum: number): value is string | undefined =>
  value === undefined || boundedText(value, maximum);
const optionalUrl = (value: unknown): value is string | undefined => {
  if (value === undefined) return true;
  if (typeof value !== "string" || value.length > 1000 || !/^https:\/\/[^\s<>"']+$/i.test(value)) return false;
  try {
    const url = new URL(value);
    return !url.username && !url.password;
  } catch {
    return false;
  }
};
const oneOf = <T extends string>(value: unknown, values: readonly T[]): value is T =>
  typeof value === "string" && values.includes(value as T);
export function validateDonationSubmission(
  value: unknown,
): value is DonationSubmission {
  if (!isObject(value) || !isObject(value.donor) || !isObject(value.charity))
    return false;
  const donor = value.donor,
    charity = value.charity;
  if (!hasOnlyKeys(value, ["id", "clientSubmissionKey", "createdAt", "donor", "shippingMethod", "devices", "charity", "campaignSlug"])
    || !hasOnlyKeys(donor, ["firstName", "middleName", "lastName", "email", "address1", "address2", "city", "state", "zip", "country", "marketingEmailConsent", "marketingConsentAt"])
    || !hasOnlyKeys(charity, ["pledgeId", "name", "ein", "city", "state", "country", "logoUrl", "websiteUrl"]))
    return false;
  if (
    !boundedText(value.id, 80, true) ||
    !value.id.startsWith("DBM-") ||
    typeof value.clientSubmissionKey !== "string" ||
    !UUID.test(value.clientSubmissionKey) ||
    !boundedText(value.createdAt, 80, true) ||
    Number.isNaN(Date.parse(value.createdAt)) ||
    !Array.isArray(value.devices) ||
    value.devices.length < 1 ||
    value.devices.length > MAX_DONATION_DEVICES ||
    value.shippingMethod !== "label"
  )
    return false;
  if (value.campaignSlug !== undefined &&
      (!boundedText(value.campaignSlug, 120, true) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.campaignSlug)))
    return false;
  if (
    !boundedText(donor.firstName, 120, true) ||
    !boundedText(donor.middleName, 120) ||
    !boundedText(donor.lastName, 120, true) ||
    !boundedText(donor.email, 320, true) ||
    !EMAIL.test(donor.email) ||
    !boundedText(donor.address1, 240, true) ||
    !boundedText(donor.address2, 240) ||
    !boundedText(donor.city, 160, true) ||
    !boundedText(donor.country, 2, true) ||
    !/^[A-Z]{2}$/.test(donor.country) ||
    !COUNTRY_CODES.has(donor.country) ||
    !boundedText(donor.state, 160) ||
    !boundedText(donor.zip, 32) ||
    (donor.country === "US" &&
      (donor.state.length !== 2 || !US_STATE_CODES.has(donor.state) || !/^\d{5}(?:-\d{4})?$/.test(donor.zip))) ||
    typeof donor.marketingEmailConsent !== "boolean" ||
    (donor.marketingConsentAt !== undefined &&
      (typeof donor.marketingConsentAt !== "string" || donor.marketingConsentAt.length > 80 ||
        Number.isNaN(Date.parse(donor.marketingConsentAt))))
  )
    return false;
  if (
    !boundedText(charity.name, 240, true) ||
    typeof charity.pledgeId !== "string" ||
    !UUID.test(charity.pledgeId) ||
    !optionalText(charity.ein, 32) ||
    !optionalText(charity.city, 160) ||
    !optionalText(charity.state, 160) ||
    !optionalText(charity.country, 2) ||
    !optionalUrl(charity.websiteUrl) ||
    !optionalUrl(charity.logoUrl)
  )
    return false;
  const deviceIds = new Set<string>();
  return value.devices.every((device) => {
    if (!isObject(device) || !hasOnlyKeys(device, ["id", "brand", "model", "age", "condition", "storage", "powersOn", "unlocked"])
      || !boundedText(device.id, 120, true) || deviceIds.has(device.id)
      || !oneOf(device.brand, BRANDS) || !boundedText(device.model, 160)
      || !oneOf(device.age, AGES) || !oneOf(device.condition, CONDITIONS)
      || !oneOf(device.storage, STORAGE_VALUES)
      || typeof device.powersOn !== "boolean" || typeof device.unlocked !== "boolean") return false;
    deviceIds.add(device.id);
    return true;
  });
}
export const charityLocation = (charity: SelectedCharity) =>
  [charity.city, charity.state, charity.country].filter(Boolean).join(", ") ||
  "Not provided";
export const donorFullName = (donor: DonorDetails) =>
  [donor.firstName, donor.middleName, donor.lastName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
export const donorAddress = (donor: DonorDetails) =>
  `${donor.address1}${donor.address2 ? `, ${donor.address2}` : ""}, ${donor.city}${donor.state ? `, ${donor.state}` : ""}${donor.zip ? ` ${donor.zip}` : ""}, ${donor.country}`;
export const describeDevice = (device: Device, index: number) =>
  `${index + 1}. ${device.brand}${device.model.trim() ? ` ${device.model.trim()}` : ""} smartphone, ${device.age} old, ${device.condition.toLowerCase()} condition, ${device.storage}, ${device.powersOn ? "powers on" : "does not power on"}, ${device.unlocked ? "reported unlocked" : "carrier lock unknown or active"}`;
export function buildAdministratorNotification(record: DonationSubmission) {
  return [
    "New Donate by Mail phone-donation packet",
    "",
    `Donation ID: ${record.id}`,
    `Created: ${record.createdAt}`,
    "",
    "Selected Charity",
    `Name: ${record.charity.name}`,
    `Pledge ID: ${record.charity.pledgeId}`,
    `EIN: ${record.charity.ein || "Not provided"}`,
    `Location: ${charityLocation(record.charity)}`,
    `Website: ${record.charity.websiteUrl || "Not provided"}`,
    "",
    "Donor",
    `Name: ${donorFullName(record.donor)}`,
    `Email: ${record.donor.email}`,
    `Address: ${donorAddress(record.donor)}`,
    `Occasional email updates: ${record.donor.marketingEmailConsent ? `Opted in at ${record.donor.marketingConsentAt || record.createdAt}` : "Not opted in"}`,
    "",
    "Mailing plan",
    "Donor-paid shipping with printable address label",
    `Ship to:\n${DONATE_BY_MAIL_ADDRESS_TEXT}`,
    "",
    "Phones",
    record.devices.map(describeDevice).join("\n"),
    "",
    "This notification records a charity selection only. No money was sent through Pledge.",
  ].join("\n");
}

export function buildRedactedAdministratorNotification(record: DonationSubmission, staffUrl: string) {
  return [
    "New Donate by Mail phone donation",
    "",
    `Donation ID: ${record.id}`,
    `Selected charity: ${record.charity.name}`,
    `Device count: ${record.devices.length}`,
    "Status: submitted",
    `Open the authenticated staff workspace: ${staffUrl}`,
  ].join("\n");
}

// Kept as a compatibility export for the beta fixture contract. The message
// itself is environment-neutral because the same redacted notification is
// used by the production outbox after the production cutover.
export const buildBetaAdministratorNotification = buildRedactedAdministratorNotification;

export function buildDonorConfirmation(record: DonationSubmission): string {
  return [
    `Hello ${record.donor.firstName.trim()},`,
    "",
    "Your Donate by Mail donation packet has been created.",
    "",
    `Donation ID: ${record.id}`,
    `Selected charity: ${record.charity.name}`,
    `Occasional email updates: ${record.donor.marketingEmailConsent ? "Opted in" : "Not opted in"}`,
    "Mailing plan: Use your own sturdy packaging and purchase postage directly from your chosen carrier.",
    "",
    "Ship your package to:",
    DONATE_BY_MAIL_ADDRESS_TEXT,
    "",
    "Phones listed in your packet:",
    record.devices.map(describeDevice).join("\n"),
    "",
    "Before mailing, back up anything you want to keep, sign out of accounts, remove activation locks and SIM cards when possible, and do not include passwords or passcodes. Keep your donation ID with the package.",
    "",
    "This message confirms creation of your donation packet. A charitable acknowledgment is issued only after Donate by Mail physically receives and verifies the phones.",
    "",
    "Questions? Reply to this email or contact tre@donatebymail.org.",
    "",
    "Donate by Mail",
    "U.S. 501(c)(3) public charity · EIN 92-1515120",
  ].join("\n");
}
