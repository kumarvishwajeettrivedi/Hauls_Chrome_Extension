// TEMPLATE. `npm run build:config` writes the real extension/config.js (git-ignored) from your .env. Public values only (the anon key is safe to ship; RLS protects data).
const HAULS_CONFIG = {
  "SUPABASE_URL": "https://xesmxpwcmbimhngdufje.supabase.co",
  "SUPABASE_ANON_KEY": "",
  "GOOGLE_CLIENT_ID": ""
};
if (typeof module !== "undefined") module.exports = HAULS_CONFIG;
