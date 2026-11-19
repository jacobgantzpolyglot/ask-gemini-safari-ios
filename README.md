# Ask Gemini for iOS Safari (Unsigned IPA)

Brings Chrome's **"Ask Gemini"** experience to **iOS Safari**, triggered from a tiny, unobtrusive **top-left ✨ mini button** and powered directly by your **signed-in Gemini subscription (`gemini.google.com`)** — no API key needed.

## Features
- **Mini Top-Left ✨ Button:** Only `28×28 px` (customizable to `24 px` or `34 px`), frosted glass, vertically draggable along the left edge so it never gets in the way of websites.
- **Chrome-Style Ask Gemini Sheet:** Dark rounded composer with Gemini's signature rainbow glow border, automatic current-page context chip (`Favicon + Title ×`), floating quick-action pills (*Summarize page*, *Create FAQ about this topic*, *Key takeaways*), and iOS keyboard-aware positioning (`visualViewport`).
- **Uses Your Gemini Subscription (No API Key):** Bridges directly to your signed-in `gemini.google.com` Safari session. Streams responses inline when a Gemini tab is awake in Safari, or wakes `gemini.google.com/app` automatically with a 1-tap **`← Back to [Page]`** pill.

## How to Sideload the Unsigned `.ipa`
1. Install `AskGemini-Safari-iOS-unsigned.ipa` using your preferred sideloader:
   - **SideStore / AltStore:** When prompted during installation, **select "Keep App Extensions"** (required so iOS registers the embedded `.appex` Safari Web Extension; uses 1 additional App ID). *Note: Do not install inside LiveContainer, as LiveContainer cannot register Safari App Extensions with iOS.*
   - **Feather / ESign / Sideloadly / TrollStore:** Install normally with extensions preserved.
2. Open the **Ask Gemini** app once on your Home Screen.
3. Go to **iOS Settings → Apps → Safari → Extensions → Ask Gemini**:
   - Turn on **Allow Extension**
   - Set **gemini.google.com** and **Other Websites** to **Allow**
4. Open **https://gemini.google.com** in Safari once and sign in to your Google account with your Gemini subscription.
5. Visit any website in Safari and tap the **mini ✨ button in the top-left**!
