const origin = process.env.BETA_ORIGIN || "https://beta.donatebymail.org";
const clientId = process.env.CF_ACCESS_CLIENT_ID;
const clientSecret = process.env.CF_ACCESS_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Cloudflare Access service-token environment is required.");
  process.exit(2);
}
const response = await fetch(origin, { redirect: "manual", headers: {
  "CF-Access-Client-Id": clientId,
  "CF-Access-Client-Secret": clientSecret,
}});
if (!response.ok) {
  console.error(`Beta smoke failed with HTTP ${response.status}.`);
  process.exit(1);
}
if (!(await response.text()).includes("Donate by Mail")) {
  console.error("Beta smoke did not receive the expected application.");
  process.exit(1);
}
console.log("Beta Access smoke passed.");
