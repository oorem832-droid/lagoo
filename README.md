# Lagoo: setup, hosting and daily use (version 2)

A trusted property catalogue for Abidjan: **rentals, sales and short stays** (Airbnb-style, hotels, furnished residences).

## How your business works on this site

1. **An owner contacts you** (WhatsApp) and pays you to publish their property. This payment happens outside the site.
2. **You publish the listing yourself** from the Administration area: photos, price, details, and the owner's contact (kept private).
3. **A visitor finds the property** and sends a request (name + phone). They never see the owner's number, and they are never asked for money.
4. **You check availability** with the owner. The Administration screen gives you one-tap Call / WhatsApp buttons for both sides, with a ready-written message.
5. **You put them in touch**, and you track your commission on that request.

Owners cannot publish anything themselves. Only your admin account can.

```
immo-abidjan/   (project folder; brand name: Lagoo)
  img/mark.svg        logo (also the browser-tab icon)
  index.html          the page shell
  css/style.css       design
  js/config.js        <- you paste your Supabase values + your WhatsApp number here
  js/app.js           all the site logic (French interface), public site + admin area
  supabase/schema.sql <- you run this once in Supabase
```

---

## Setup

### Step 1: Create the Supabase project (5 min)
1. Go to **supabase.com**, sign up, click **New project**.
2. Name it `immo-abidjan`, set a strong database password and save it.
3. Choose the region **closest to Côte d'Ivoire** in the list. Wait ~2 minutes.

### Step 2: Create the database (2 min)
1. In Supabase open **SQL Editor, then New query**.
2. Copy **all** of `supabase/schema.sql`, paste, click **Run**. You should see "Success".
3. Safe to run again. If you already ran the *first* version of this file, running this one upgrades it automatically (it refuses to touch anything if real listings exist).

### Step 3: Connect the website (2 min)
1. In Supabase: **Project Settings, then API** (or "API Keys"). Copy the **Project URL** and the **anon / publishable key**.
2. Paste both into `js/config.js`.
3. In the same file, put **your WhatsApp number** with the country code and digits only, for example `2250700000000`. It powers the "Nous écrire sur WhatsApp" buttons.

> The anon key is *meant* to be public: the database rules decide who can see or change what. **Never paste the `service_role` / secret key into the website.**

### Step 4: Login and email settings
In Supabase: **Authentication**.
- Keep **email confirmation** on (fewer fake accounts).
- **URL Configuration**: set **Site URL** to your final address and add `http://localhost:8000` under **Redirect URLs** while testing.
- **Before launch, set up custom SMTP** (Authentication, then SMTP Settings) with a service like Resend or Brevo. Supabase's built-in sender is for testing only and is heavily rate-limited, so confirmation emails may not arrive.

### Step 5: Test on your computer
In a terminal, inside the `immo-abidjan` folder:
```
python3 -m http.server 8000
```
Open **http://localhost:8000**.

### Step 6: Make yourself the administrator (once)
1. On the site, click **Connexion, then Créer un compte**, and sign up with your own email (confirm it if asked).
2. In Supabase **SQL Editor**, run this with your email:
```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'YOUR-EMAIL@example.com');
```
3. Reload the site and log in. You now see an **Administration** button. Nobody else gets one, and there is no way to promote yourself from the website.

### Step 7: Put it online (free)
- **Netlify**: go to app.netlify.com/drop and drag the `immo-abidjan` folder onto the page.
- **Cloudflare Pages**: Workers & Pages, Create, Pages, Upload assets. Vercel and GitHub Pages also work.

Then add the address you get to Supabase **Redirect URLs** (Step 4).

### Step 8: Your own domain
1. Buy a domain (Namecheap, Cloudflare Registrar, Gandi...). For a `.ci`, check the registry (nic.ci) for accredited registrars and requirements.
2. In your host, **Domain settings, Add custom domain**, then create the DNS records it shows at your registrar.
3. After DNS updates (minutes to hours), set the Supabase **Site URL** to your new domain.

### Costs and limits: check before launch
Supabase and the hosts above have free tiers, but limits (database size, file storage, users, and **free projects pausing after a period of inactivity**) change. Check **supabase.com/pricing** before going live. Photos are shrunk in the browser (max 1600 px) to save storage.

---

## Look and login

The design is plain white with orange as a small accent and green on action buttons (buttons that act: "Proposer mon bien", "Envoyer ma demande"). To change them, edit the first lines of `css/style.css`. Visitors see no login button: they never need an account. **You log in through "Espace équipe" in the footer**, then the Administration button appears.

## Daily use (Administration area)

- **Demandes**: every visitor request, newest first, with a red counter for new ones. Per request: change the status (Nouvelle, Vérification propriétaire, Disponible, Mise en relation faite, Conclue, Perdue), record your **commission** and whether it is **paid**, add private notes. The top shows **À encaisser** (owed to you) and **Encaissé** (received).
- **Annonces**: all listings. Edit, pause, delete. Each has a **"payée jusqu'au"** date: the listing disappears from the public site automatically after it, so you can sell listing periods (for example 1 or 3 months) and renew by changing the date.
- **Propriétaires**: your private address book of owners, with notes such as the fee you agreed.
- **Region filters for visitors**: they pick a **commune** (Cocody, Bingerville, Yopougon...), then a **quartier** (Angré, Riviera 3...). The quartier list shows only quartiers that really have listings, with a count, and is shareable as a link. It groups by exact spelling, so **choose the quartier from the suggestions** in the form (they follow the commune you pick) and write it the same way every time ("Angré", not "Angre").
- **Home page search**: a visitor types a commune or quartier and gets suggestions as they type (accents ignored: "adjame" finds Adjamé), then can pick a budget and bedrooms. The layout follows the familiar big-portal pattern (search card with tabs) without copying anyone's branding.
- **Budget slider for visitors**: after choosing Location, Vente or Séjour court, a two-handle slider appears (min and max). Its range is built from the real prices in your listings, so it always fits. Rent is per month, sale is a total, short stay is per night, so the slider only works inside one type (otherwise 45 000 per night and 45 000 000 for a sale would be mixed up). It is shareable in the link.
- **+ Nouvelle annonce**: a short form. You can add the owner on the spot. Tick **"Bien vérifié"** only when you really checked the property: it shows a green "✓ Vérifié" badge, which is what visitors will learn to trust.

## Protecting your reputation and your income

- **Never take money from visitors, and never let anyone else publish.** The site says this on the home page and on every listing. That promise is your whole brand, so keep it true.
- **Release owner contacts only after the owner confirms availability** (step 4 above). That is how you stay the necessary middleman.
- **Agree your fee with the owner in writing before you introduce anyone.** A WhatsApp message is enough: what you charge, and when it is due (on signing, on move-in, or per booking). Record it in the owner's notes. Without a prior agreement, collecting after an introduction is hard.
- **Check the local rules.** Acting as an intermediary in property may require a licence or registration in Côte d'Ivoire. I am not a lawyer, so ask a local professional, and have Terms and Privacy pages reviewed locally before launch.
- If your process differs from the three trust messages on the home page, edit that text in `js/app.js` (search for "Annonces publiées par notre équipe").

---

## What was tested

- **Database**: `schema.sql` was run on a real PostgreSQL 16 (with stand-ins for Supabase's login and storage parts), including re-running it, upgrading from the first version, and refusing to overwrite real data. Security rules were attacked as different users: visitors cannot read requests or owner contacts, cannot set their own status or commission, cannot spoof another user, and cannot publish or upload; strangers cannot make themselves admin; expired and paused listings disappear and stop receiving requests; owner phone numbers and internal notes are not in the public view.
- **Website**: the real `index.html` and `js/app.js` were loaded in a simulated browser against a fake database and walked through 96 checks (including the region filters and the budget slider) (visitor browsing and search, request form with spam trap, admin guard, request tracker, listing editor with photos, owners). I also broke the code on purpose twice to confirm the checks catch real bugs.
- **Not tested**: it has not yet been run in a real browser against a live Supabase project, so expect a short first test pass (Steps 5 and 6), including photo upload from a phone. Tell me what looks off.

## Not included yet (good next steps)

- **Alert when a new request arrives** (an email or WhatsApp to you). Today you see the red counter when you open Administration, so check it often. I can add an email alert.
- **Automatic payment of listing fees** (Orange Money / MTN / Wave through an aggregator). Today you record payments yourself with the "payée jusqu'au" date.
- A "report this listing" button, a captcha if spam appears, a map view, an English toggle.
