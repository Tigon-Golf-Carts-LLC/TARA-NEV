# DNS records for `taranev.com` → GitHub Pages

These are the exact records to create at whatever registrar/DNS host holds
`taranev.com` (GoDaddy, Namecheap, Cloudflare, Google Domains, etc.).

Repository: `Tigon-Golf-Carts-LLC/TARA-NEV`
GitHub Pages hostname: `tigon-golf-carts-llc.github.io`

---

## 1. Delete the old Replit records first

Remove **every** existing `A`, `AAAA`, `ALIAS`/`ANAME`, or `CNAME` record on
the root (`@`) and on `www` that points at Replit. Leaving them in place will
either keep serving the old site or break certificate issuance.

Leave `MX`, `TXT` (SPF/DKIM/DMARC), and any other unrelated records alone —
those are email and verification records, not website records.

---

## 2. Apex domain — `taranev.com`

Create **four `A` records**, all with host/name `@`:

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| A | `@` | `185.199.108.153` | 3600 |
| A | `@` | `185.199.109.153` | 3600 |
| A | `@` | `185.199.110.153` | 3600 |
| A | `@` | `185.199.111.153` | 3600 |

And **four `AAAA` records** (IPv6 — recommended, GitHub serves over IPv6):

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| AAAA | `@` | `2606:50c0:8000::153` | 3600 |
| AAAA | `@` | `2606:50c0:8001::153` | 3600 |
| AAAA | `@` | `2606:50c0:8002::153` | 3600 |
| AAAA | `@` | `2606:50c0:8003::153` | 3600 |

> Some DNS panels write the name as `taranev.com.` or leave it blank instead of
> `@`. All three mean the same thing — use whichever your panel expects.

---

## 3. `www` subdomain

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| CNAME | `www` | `tigon-golf-carts-llc.github.io.` | 3600 |

The value is the **GitHub Pages hostname**, not the repo URL — no
`/TARA-NEV` on the end. The trailing dot is required by some panels
(BIND-style) and rejected by others; use whichever form your panel accepts.

Because the repo's custom domain is set to the apex, GitHub automatically
redirects `www.taranev.com` → `taranev.com`.

---

## If your DNS is on Cloudflare

Create the same records, but set the proxy status to **DNS only** (grey
cloud, not orange) until GitHub has issued the TLS certificate. Leaving the
orange cloud on blocks GitHub's domain validation.

Once the site is live and **Enforce HTTPS** is ticked in the repo settings,
you may re-enable the orange cloud — set SSL/TLS mode to **Full (strict)**.

Cloudflare supports `CNAME` flattening on the apex, so you may instead use a
single record in place of the eight A/AAAA records above:

| Type | Name | Value | Proxy |
| --- | --- | --- | --- |
| CNAME | `@` | `tigon-golf-carts-llc.github.io` | DNS only |

---

## 4. GitHub side

In the repository, **Settings → Pages**:

1. **Source:** `GitHub Actions`
2. **Custom domain:** `taranev.com` → Save
   (this writes/checks the `CNAME` file, which the build already generates)
3. Wait for the "DNS check successful" green tick, then tick **Enforce HTTPS**

The HTTPS certificate is issued automatically by GitHub via Let's Encrypt. It
can take anywhere from a few minutes to ~24 hours after DNS propagates; until
it is issued the **Enforce HTTPS** checkbox stays greyed out.

---

## 5. Verify

```bash
dig +short taranev.com A
# expect the four 185.199.10x.153 addresses

dig +short www.taranev.com CNAME
# expect tigon-golf-carts-llc.github.io.

curl -sI https://taranev.com | head -1
# expect HTTP/2 200
```

---

## Notes

- **Propagation:** typically 15 minutes to a few hours; up to 48 hours in the
  worst case. Lower the TTL on the old records a day *before* switching if you
  want a faster cutover.
- **Do not** point the apex at a single `A` record or at
  `tigon-golf-carts-llc.github.io` with an `A` record — the Pages IPs can
  change, and GitHub requires all four.
- If the repo is ever renamed or moved to another org, the `www` CNAME target
  changes with it (`<new-org>.github.io`).
