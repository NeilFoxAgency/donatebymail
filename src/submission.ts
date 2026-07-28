import type { SelectedCharity } from "./pledge";
export type Brand = "Apple" | "Samsung" | "Google" | "Motorola" | "Other";
export type Age = "0-1 year" | "2-3 years" | "4-5 years" | "6+ years";
export type Condition = "Excellent" | "Good" | "Fair" | "Damaged";
export type Storage = "64 GB or less" | "128 GB" | "256 GB" | "512 GB+";
export type ShippingMethod = "label" | "kit";
export const DONATE_BY_MAIL_ADDRESS = [
  "Donate By Mail",
  "4103 Tropical Isle Blvd, Apt 124",
  "Kissimmee, FL 34741",
] as const;
export const DONATE_BY_MAIL_ADDRESS_TEXT = DONATE_BY_MAIL_ADDRESS.join("\n");
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
const isObject = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);
export function validateDonationSubmission(
  value: unknown,
): value is DonationSubmission {
  if (!isObject(value) || !isObject(value.donor) || !isObject(value.charity))
    return false;
  const donor = value.donor,
    charity = value.charity;
  if (
    typeof value.id !== "string" ||
    !value.id.startsWith("DBM-") ||
    typeof value.createdAt !== "string" ||
    Number.isNaN(Date.parse(value.createdAt)) ||
    !Array.isArray(value.devices) ||
    value.devices.length < 1 ||
    value.devices.length > 20 ||
    (value.shippingMethod !== "label" && value.shippingMethod !== "kit")
  )
    return false;
  if (value.campaignSlug !== undefined &&
      (typeof value.campaignSlug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.campaignSlug)))
    return false;
  if (
    typeof donor.firstName !== "string" ||
    !donor.firstName.trim() ||
    typeof donor.middleName !== "string" ||
    typeof donor.lastName !== "string" ||
    !donor.lastName.trim() ||
    typeof donor.email !== "string" ||
    !EMAIL.test(donor.email) ||
    typeof donor.address1 !== "string" ||
    !donor.address1.trim() ||
    typeof donor.city !== "string" ||
    !donor.city.trim() ||
    typeof donor.country !== "string" ||
    !/^[A-Z]{2}$/.test(donor.country) ||
    typeof donor.state !== "string" ||
    typeof donor.zip !== "string" ||
    (donor.country === "US" &&
      (donor.state.length !== 2 || !/^\d{5}(?:-\d{4})?$/.test(donor.zip))) ||
    typeof donor.marketingEmailConsent !== "boolean" ||
    (donor.marketingConsentAt !== undefined &&
      (typeof donor.marketingConsentAt !== "string" ||
        Number.isNaN(Date.parse(donor.marketingConsentAt))))
  )
    return false;
  if (
    typeof charity.pledgeId !== "string" ||
    !UUID.test(charity.pledgeId) ||
    typeof charity.name !== "string" ||
    !charity.name.trim()
  )
    return false;
  return value.devices.every(
    (device) =>
      isObject(device) &&
      typeof device.id === "string" &&
      typeof device.brand === "string" &&
      typeof device.age === "string" &&
      typeof device.condition === "string" &&
      typeof device.storage === "string" &&
      typeof device.powersOn === "boolean" &&
      typeof device.unlocked === "boolean",
  );
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
