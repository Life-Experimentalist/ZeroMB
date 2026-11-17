# ZeroMB

Recharge a mobile data pack when you have 0 MB of data left.

ZeroMB is a small offline Android app for Indian prepaid users on Jio, Airtel, Vi and BSNL. It does not talk to the internet and holds no money. It opens your phone's normal dialer with the NPCI UPI 123PAY number and the key presses for a recharge already typed in. You press call and enter your UPI PIN by voice menu.

Site: https://zeromb.vkrishna04.me (once DNS is set up, see `docs/SETUP.md`)

## How it works

1. You save your 10-digit number and pick your operator.
2. You tap a data pack, or type any pack price.
3. The app opens the dialer with a string like `08045163666,,,2,,,1,,,9XXXXXXXXX#,,,22#`. Commas are short pauses, so the menu digits are sent for you.
4. You press the green call button. When the voice asks, type your UPI PIN on the keypad.

The rupee amount is the plan ID in Indian recharge systems, so adding a custom pack only needs its exact price. If the price is not a real pack for your operator, the recharge is rejected and the UPI payment is refunded.

## Permissions and licences

None. The app uses `tel:` links, which hand the number to the system dialer, so it needs no `CALL_PHONE` permission. It stores your number, operator and pack list on the phone only (AsyncStorage). It holds no funds and runs no wallet, so it is not a payment app. The payment happens between your phone and NPCI.

## Run it

```bash
npm install
npx expo start
```

Open Expo Go on your phone and scan the QR code. Phone and computer must be on the same Wi-Fi.

## Build an APK

```bash
npm install -g eas-cli
eas login
eas build -p android --profile preview
```

EAS prints a download link for the `.apk` when it finishes. Copy it to your phone and install it (allow "install unknown apps" for your browser or file manager).

## Things to check before relying on it

- The 123PAY menu digits (`2`, `1`, number, amount) are unverified. If the first call lands on the wrong menu, change the sequence under "advanced: dial sequence" in the app. Each comma is about a two second pause.
- Pack prices and the USSD backup codes (`*567*3#`, `*111*6#`, `*124*2#`) change over time. Confirm with your operator.
- Some dialer apps ignore pause commas. If yours does, dial `080 4516 3666` by hand and use the keypad.
- The first time, call 123PAY once from the app and say your bank name so NPCI knows which account to use.

## Disclaimer

This is an unofficial hobby tool. It is not affiliated with NPCI, Jio, Airtel, Vi or BSNL. It does not see your UPI PIN or bank details. You are responsible for checking each call before you enter a PIN. Use it at your own risk.

## Licence

See `LICENSE`.
