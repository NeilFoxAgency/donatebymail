import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildBetaAdministratorNotification,
  buildAdministratorNotification,
  buildDonorConfirmation,
  validateDonationSubmission,
  type DonationSubmission,
} from "./submission";
const submission: DonationSubmission = {
  id: "DBM-20260722-ABCDE",
  clientSubmissionKey: "71000000-0000-4000-8000-000000000001",
  createdAt: "2026-07-22T03:00:00.000Z",
  donor: {
    firstName: "Sample",
    middleName: "Middle",
    lastName: "Donor",
    email: "donor@example.com",
    address1: "123 Main Street",
    address2: "",
    city: "Kissimmee",
    state: "FL",
    zip: "34741",
    country: "US",
    marketingEmailConsent: true,
    marketingConsentAt: "2026-07-22T02:59:00.000Z",
  },
  shippingMethod: "label",
  devices: [
    {
      id: "phone-1",
      brand: "Apple",
      model: "iPhone 13",
      age: "2-3 years",
      condition: "Good",
      storage: "128 GB",
      powersOn: true,
      unlocked: true,
    },
  ],
  charity: {
    pledgeId: "ec0b21fc-2671-431e-8a81-783b7a9626c9",
    name: "Example Charity",
    ein: "12-3456789",
    city: "Orlando",
    state: "FL",
    country: "US",
  },
};
describe("submission and notification", () => {
  it("keeps routine beta administrator notifications free of donor mailing PII", () => {
    const message = buildBetaAdministratorNotification(submission, "https://beta.donatebymail.org/staff");
    expect(message).not.toContain(submission.donor.email);
    expect(message).not.toContain(submission.donor.address1);
    expect(message).toContain(submission.id);
  });
  it("rejects no charity", () => {
    const { charity: _charity, ...value } = submission;
    expect(validateDonationSubmission(value)).toBe(false);
  });
  it("requires a Pledge UUID", () =>
    expect(
      validateDonationSubmission({
        ...submission,
        charity: { name: "Typed charity", pledgeId: "" },
      }),
    ).toBe(false));
  it("includes name and UUID", () => {
    expect(validateDonationSubmission(submission)).toBe(true);
    expect(submission.charity).toMatchObject({
      name: "Example Charity",
      pledgeId: "ec0b21fc-2671-431e-8a81-783b7a9626c9",
    });
  });
  it("accepts international addresses without a U.S. state or ZIP", () => {
    expect(
      validateDonationSubmission({
        ...submission,
        donor: {
          ...submission.donor,
          address1: "1 Queen Street",
          city: "Auckland",
          state: "",
          zip: "1010",
          country: "NZ",
        },
      }),
    ).toBe(true);
  });
  it("requires the new split name, country, and consent record", () => {
    expect(
      validateDonationSubmission({
        ...submission,
        donor: { ...submission.donor, firstName: "" },
      }),
    ).toBe(false);
    expect(
      validateDonationSubmission({
        ...submission,
        donor: { ...submission.donor, marketingEmailConsent: undefined },
      }),
    ).toBe(false);
  });
  it("formats the admin notice", () => {
    const notice = buildAdministratorNotification(submission);
    expect(notice).toContain("Selected Charity");
    expect(notice).toContain("Name: Example Charity");
    expect(notice).toContain("Pledge ID: ec0b21fc-2671-431e-8a81-783b7a9626c9");
    expect(notice).toContain("Location: Orlando, FL, US");
    expect(notice).toContain("Donor-paid shipping with printable address label");
    expect(notice).toContain("4103 Tropical Isle Blvd, Apt 124");
    expect(notice).toContain("Name: Sample Middle Donor");
    expect(notice).toContain("Address: 123 Main Street, Kissimmee, FL 34741, US");
    expect(notice).toContain(
      "Occasional email updates: Opted in at 2026-07-22T02:59:00.000Z",
    );
    expect(notice).not.toMatch(/prepaid|mail-in kit/i);
  });
  it("formats an honest donor confirmation", () => {
    const confirmation = buildDonorConfirmation(submission);
    expect(confirmation).toContain("Hello Sample,");
    expect(confirmation).toContain("Donation ID: DBM-20260722-ABCDE");
    expect(confirmation).toContain("Selected charity: Example Charity");
    expect(confirmation).toContain("Occasional email updates: Opted in");
    expect(confirmation).toContain(
      "physically receives and verifies the phones",
    );
    expect(confirmation).toContain("purchase postage directly");
    expect(confirmation).toContain("Donate By Mail\n4103 Tropical Isle Blvd, Apt 124\nKissimmee, FL 34741");
    expect(confirmation).not.toMatch(/prepaid|mail-in kit/i);
    expect(confirmation).not.toContain("tax receipt");
  });
  it("keeps the secret key out of frontend files", () => {
    const frontend = [
      readFileSync("src/App.tsx", "utf8"),
      readFileSync("src/pledge.ts", "utf8"),
      readFileSync("donate-phone.html", "utf8"),
    ].join("\n");
    expect(frontend).not.toContain("PLEDGE_API_KEY");
    expect(frontend).not.toMatch(/Authorization:\s*Bearer/i);
  });
});
