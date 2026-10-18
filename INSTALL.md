# Install HAULS (no store needed)

Works in Chrome, Edge, Brave and other Chromium browsers on a computer.

1. Download **hauls-share.zip** and **SHA256SUMS.txt** from the [latest release](../../releases/latest).
2. Check the download (optional, recommended). The value printed must equal the `hauls-share.zip` line in `SHA256SUMS.txt`:
   - macOS: `shasum -a 256 hauls-share.zip`
   - Linux: `sha256sum hauls-share.zip`
   - Windows (Command Prompt): `certutil -hashfile hauls-share.zip SHA256`

   If it differs, delete the file and download again from the official release page only.
3. Unzip it into a folder you will keep (for example `Documents/HAULS`). Do not delete the folder later.
4. Open `chrome://extensions` (Edge: `edge://extensions`, Brave: `brave://extensions`). Type it into the address bar; it is the browser's page that lists your extensions.
5. Turn on **Developer mode**, the switch at the top right of that page. Browsers call extensions that do not come from their store "developer" extensions.
6. Click **Load unpacked** and choose the unzipped folder (the one that contains `manifest.json`).
7. Click the puzzle icon in the toolbar and **pin** HAULS.

Open a product on Amazon.in, Flipkart or Myntra: a small HAULS tab appears on the right edge. Click it, or click the toolbar icon, to open the panel with price history, verdict, grocery prices and your watchlist. Click again to close it. HAULS has no separate home page; everything is in this panel and in Settings. On a page where the panel cannot run (such as a new tab), the toolbar icon opens Settings.

**Updating:** download the newer zip, check it the same way, unzip it over the same folder, then click the reload icon on the HAULS card in `chrome://extensions`.

**Notes**
- The browser may show a "disable developer mode extensions" notice on startup: keep HAULS enabled.
- Google sign-in is optional. It keeps your watchlist across devices and lets you turn on price alert emails, which our server sends only when a price reaches your alert price. Each account has its own watchlist on this computer; items you delete are blanked on our server immediately and purged within 24 hours of your account's next sync or sign-in, or by the server-side purge if the maintainer has scheduled it.
- Price checks and alerts work while the browser is open.
- Phones are not supported yet.
- Found a security problem? See [SECURITY.md](SECURITY.md).
