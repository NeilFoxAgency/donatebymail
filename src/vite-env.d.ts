/// <reference types="vite/client" />
interface ImportMetaEnv{readonly VITE_PLEDGE_PARTNER_KEY?:string;readonly VITE_PLEDGE_ENV?:'production'|'sandbox'}interface ImportMeta{readonly env:ImportMetaEnv}