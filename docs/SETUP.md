# Publishing ZeroMB

## Domain: zeromb or 0mb?

Both work. A DNS label may start with a digit (RFC 1123), so `0mb.vkrishna04.me` is a valid hostname and GitHub Pages accepts it. `zeromb.vkrishna04.me` is easier to read aloud and type correctly, so the `docs/CNAME` file uses that. To switch, change the single line in `docs/CNAME` and the DNS record below.

## DNS

Add one record at whoever hosts DNS for `vkrishna04.me`:

| Type  | Name   | Value                    |
|-------|--------|--------------------------|
| CNAME | zeromb | `<github-user>.github.io` |

If the domain is on Cloudflare, set the record to "DNS only" (grey cloud) until GitHub has issued the HTTPS certificate, then it can be proxied.

## GitHub Pages

1. Push this folder to a GitHub repo.
2. Repo Settings, Pages, Source: "Deploy from a branch", branch `main`, folder `/docs`.
3. Custom domain: `zeromb.vkrishna04.me`, then tick "Enforce HTTPS" once it is available.

## APK download

Upload the built `.apk` as a GitHub Release asset. The site's download button points to
`https://github.com/<github-user>/<repo>/releases/latest`.

## Release steps

1. `eas build -p android --profile preview`
2. Download the `.apk` from the EAS link.
3. `gh release create v1.0.0 ZeroMB.apk --title "ZeroMB 1.0.0"`
