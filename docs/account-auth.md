# Beta account and authentication model

The beta has one public entry point at `/login`. The shared site navigation
shows `Log in` when no BFF session is present and `My Account` when the
server-side session context reports an authenticated user. The lightweight
session endpoint exposes only role/context labels; it never returns Supabase
access or refresh tokens.

## Donors

Selecting donor login or account creation sends a passwordless Supabase magic
link. A donor may create an identity without claiming any prior donation. A
historical donation is visible only after the donor presents its
donation-specific claim capability and the verified email matches the private
contact record. Changing a profile display name never rewrites the address or
name snapshot stored on an existing donation.

## Partners and staff

Partner login is invitation-only. The public partner card links new
organizations to the existing nonprofit onboarding page; it does not create a
partner organization or membership. The Worker requests `shouldCreateUser:
false` for partner magic links, activates only a matching, active invitation,
and the database derives organization membership from its own records.

Staff login remains an allowlisted, beta-only route. There is no public staff
account-creation path. Staff and partner membership checks are repeated after
the PKCE callback and on protected API calls.

When an authenticated identity has more than one available context, `/login`
renders a server-derived chooser for donor, partner organization, and staff
operations destinations. Logout revokes the upstream Supabase session and
clears the encrypted host-only BFF cookie.

## Profile data

The first profile surface contains verified email, an optional display name,
and session/logout controls. Reusable address fields are intentionally absent
from this beta so that profile changes cannot silently alter donation-contact
snapshots.
