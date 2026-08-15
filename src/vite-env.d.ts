/// <reference types="vite/client" />
interface ImportMetaEnv{readonly VITE_PLEDGE_PARTNER_KEY?:string;readonly VITE_PLEDGE_ENV?:'production'|'sandbox';readonly VITE_TURNSTILE_SITE_KEY?:string;readonly VITE_GA4_MEASUREMENT_ID?:string;readonly VITE_CONTACT_EMAIL?:string}interface ImportMeta{readonly env:ImportMetaEnv}
