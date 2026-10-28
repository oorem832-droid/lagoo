# Lagoo : installation, hébergement et utilisation

Un catalogue immobilier de confiance pour Abidjan : **locations, ventes et séjours courts** (type Airbnb, hôtels, résidences meublées).

## Comment fonctionne votre activité sur ce site

1. **Un propriétaire vous contacte** (WhatsApp) et vous paie pour publier son bien. Ce paiement se fait en dehors du site.
2. **Vous publiez l'annonce vous-même** depuis l'espace Administration : photos, prix, détails et contact du propriétaire (qui reste privé).
3. **Un visiteur trouve le bien** et envoie une demande (nom + téléphone). Il ne voit jamais le numéro du propriétaire et on ne lui demande jamais d'argent.
4. **Vous vérifiez la disponibilité** auprès du propriétaire. L'écran Administration vous donne des boutons Appeler / WhatsApp pour les deux côtés, avec un message déjà rédigé.
5. **Vous les mettez en relation** et vous suivez votre commission sur cette demande.

Les propriétaires ne peuvent rien publier eux-mêmes. Seul votre compte administrateur le peut.

```
immo-abidjan/   (dossier du projet ; nom de marque : Lagoo)
  img/mark.svg        logo (aussi l'icône de l'onglet du navigateur)
  index.html          la structure de la page
  css/style.css       le design (couleurs en haut du fichier)
  js/config.js        <- vous collez ici vos valeurs Supabase + votre numéro WhatsApp
  js/app.js           toute la logique du site (interface en français), site public + administration
  supabase/schema.sql <- à exécuter une seule fois dans Supabase
```

---

## Installation

### Étape 1 : créer le projet Supabase (5 min)
1. Allez sur **supabase.com**, créez un compte, cliquez sur **New project**.
2. Nommez-le `lagoo`, choisissez un mot de passe de base de données solide et notez-le.
3. Choisissez la région **la plus proche de la Côte d'Ivoire** dans la liste. Attendez environ 2 minutes.

### Étape 2 : créer la base de données (2 min)
1. Dans Supabase, ouvrez **SQL Editor, puis New query**.
2. Copiez **tout** le fichier `supabase/schema.sql`, collez-le, cliquez sur **Run**. Vous devez voir « Success ».
3. On peut le relancer sans risque. Si vous aviez exécuté la *première* version de ce fichier, celle-ci la met à jour automatiquement (elle refuse de toucher à quoi que ce soit s'il existe déjà de vraies annonces).

### Étape 3 : connecter le site (2 min)
1. Dans Supabase : **Project Settings, puis API** (ou « API Keys »). Copiez l'**URL du projet** et la clé **anon / publishable**.
2. Collez les deux dans `js/config.js`.
3. Dans le même fichier, indiquez **votre numéro WhatsApp** avec l'indicatif du pays, uniquement des chiffres, par exemple `2250700000000`. Il alimente les boutons « Nous écrire sur WhatsApp ».

> La clé anon est *faite* pour être publique : ce sont les règles de la base de données qui décident qui peut voir ou modifier quoi. **Ne collez jamais la clé `service_role` / secrète dans le site.**

### Étape 4 : connexion et e-mails
Dans Supabase : **Authentication**.
- Gardez la **confirmation par e-mail** activée (moins de faux comptes).
- **URL Configuration** : indiquez votre adresse finale dans **Site URL** et ajoutez `http://localhost:8000` dans **Redirect URLs** pendant les tests.
- **Avant le lancement, configurez un SMTP personnalisé** (Authentication, puis SMTP Settings) avec un service comme Resend ou Brevo. L'envoi intégré de Supabase sert uniquement aux tests et il est très limité : les e-mails de confirmation risquent de ne pas arriver.

### Étape 5 : tester sur votre ordinateur
Dans un terminal, à l'intérieur du dossier `immo-abidjan` :
```
python3 -m http.server 8000
```
Ouvrez **http://localhost:8000**.

### Étape 6 : devenir administrateur (une seule fois)
1. Sur le site, descendez en bas de page et cliquez sur **Espace équipe**, puis **Créer un compte**, et inscrivez-vous avec votre propre e-mail (confirmez-le si on vous le demande).
2. Dans Supabase **SQL Editor**, exécutez ceci avec votre e-mail :
```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'VOTRE-EMAIL@exemple.com');
```
3. Rechargez le site et connectez-vous (toujours par **Espace équipe**). Vous voyez maintenant le bouton **Administration**. Personne d'autre ne l'a, et il est impossible de se promouvoir administrateur depuis le site.

### Étape 7 : mettre en ligne (gratuit)
- **Netlify** : allez sur app.netlify.com/drop et glissez le dossier `immo-abidjan` sur la page.
- **Cloudflare Pages** : Workers & Pages, Create, Pages, Upload assets. Vercel et GitHub Pages fonctionnent aussi.

Ajoutez ensuite l'adresse obtenue dans les **Redirect URLs** de Supabase (étape 4).

### Étape 8 : votre propre nom de domaine
1. Achetez un domaine (Namecheap, Cloudflare Registrar, Gandi...). Pour un `.ci`, renseignez-vous auprès du registre (nic.ci) sur les bureaux d'enregistrement agréés et les conditions.
2. Chez votre hébergeur, **Domain settings, Add custom domain**, puis créez les enregistrements DNS indiqués chez votre registraire.
3. Une fois les DNS à jour (quelques minutes à quelques heures), mettez votre nouveau domaine dans **Site URL** de Supabase.

### Coûts et limites : à vérifier avant le lancement
Supabase et les hébergeurs ci-dessus ont des offres gratuites, mais les limites (taille de la base, stockage des fichiers, nombre d'utilisateurs, et **mise en pause des projets gratuits après une période d'inactivité**) changent. Consultez **supabase.com/pricing** avant de lancer. Les photos sont réduites dans le navigateur (1600 px maximum) pour économiser le stockage.

---

## Apparence et connexion

Le design est tout blanc, avec l'orange comme petite touche et le vert sur les boutons d'action (« Proposer mon bien », « Envoyer ma demande »). Pour changer les couleurs, modifiez les premières lignes de `css/style.css`. Les visiteurs n'ont aucun bouton de connexion : ils n'ont jamais besoin de compte. **Vous vous connectez par « Espace équipe » en bas de page**, puis le bouton Administration apparaît.

## Utilisation au quotidien (espace Administration)

- **Demandes** : toutes les demandes des visiteurs, les plus récentes d'abord, avec un compteur rouge pour les nouvelles. Pour chaque demande : changez le statut (Nouvelle, Vérification propriétaire, Disponible, Mise en relation faite, Conclue, Perdue), notez votre **commission** et si elle est **payée**, ajoutez des notes privées. En haut : **À encaisser** (ce qu'on vous doit) et **Encaissé** (ce que vous avez reçu).
- **Annonces** : toutes les annonces. Modifier, mettre en pause, supprimer. Chacune a une date **« payée jusqu'au »** : l'annonce disparaît automatiquement du site public après cette date, ce qui vous permet de vendre des périodes de publication (par exemple 1 ou 3 mois) et de renouveler en changeant la date.
- **Propriétaires** : votre carnet d'adresses privé des propriétaires, avec des notes comme les frais convenus.
- **Filtres par région pour les visiteurs** : ils choisissent une **commune** (Cocody, Bingerville, Yopougon...), puis un **quartier** (Angré, Riviera 3...). La liste des quartiers n'affiche que ceux qui ont vraiment des annonces, avec leur nombre, et se partage par lien. Les quartiers sont regroupés selon l'orthographe exacte : **choisissez donc le quartier dans les suggestions** du formulaire (elles suivent la commune choisie) et écrivez-le toujours pareil (« Angré », pas « Angre »).
- **Recherche de la page d'accueil** : le visiteur tape une commune ou un quartier et reçoit des suggestions pendant la frappe (les accents sont ignorés : « adjame » trouve Adjamé), puis peut choisir un budget et un nombre de chambres. La disposition suit le modèle classique des grands portails (carte de recherche avec onglets), sans copier la marque de personne.
- **Curseur de budget pour les visiteurs** : après avoir choisi Louer, Acheter ou Séjours courts, un curseur à deux poignées apparaît (minimum et maximum). Sa plage est calculée à partir des vrais prix de vos annonces, elle est donc toujours adaptée. Un loyer est mensuel, une vente est un prix total, un séjour court est par nuit : le curseur ne fonctionne donc qu'à l'intérieur d'un seul type (sinon 45 000 par nuit et 45 000 000 pour une vente seraient mélangés). Il se partage dans le lien.
- **+ Nouvelle annonce** : un formulaire court. Vous pouvez ajouter le propriétaire sur place. Cochez **« Bien vérifié »** seulement si vous avez vraiment vérifié le bien : cela affiche un badge vert « ✓ Vérifié », en lequel les visiteurs apprendront à avoir confiance.

## Protéger votre réputation et vos revenus

- **Ne prenez jamais d'argent aux visiteurs et ne laissez personne d'autre publier.** Le site le dit sur la page d'accueil et sur chaque annonce. Cette promesse est toute votre marque : tenez-la.
- **Ne communiquez le contact du propriétaire qu'après sa confirmation de disponibilité** (étape 4 ci-dessus). C'est ainsi que vous restez l'intermédiaire indispensable.
- **Convenez de vos frais avec le propriétaire par écrit avant de mettre quiconque en relation.** Un message WhatsApp suffit : ce que vous facturez et quand c'est dû (à la signature, à l'emménagement, ou par réservation). Notez-le dans les notes du propriétaire. Sans accord préalable, il est difficile de réclamer son dû après une mise en relation.
- **Vérifiez la réglementation locale.** Faire l'intermédiaire en immobilier peut exiger une licence ou un enregistrement en Côte d'Ivoire. Je ne suis pas juriste : demandez conseil à un professionnel local et faites relire les mentions légales et la politique de confidentialité localement avant le lancement.
- Si votre façon de procéder diffère des trois messages de confiance de la page d'accueil, modifiez ce texte dans `js/app.js` (cherchez « Annonces publiées par notre équipe »).

---

## Ce qui a été testé

- **Base de données** : `schema.sql` a été exécuté sur un vrai PostgreSQL 16 (avec des équivalents pour les parties connexion et stockage de Supabase), y compris sa relance, la mise à jour depuis la première version et le refus d'écraser de vraies données. Les règles de sécurité ont été attaquées avec différents utilisateurs : les visiteurs ne peuvent pas lire les demandes ni les contacts des propriétaires, ne peuvent pas fixer leur propre statut ou commission, ne peuvent pas usurper un autre utilisateur, et ne peuvent ni publier ni téléverser ; un inconnu ne peut pas se faire administrateur ; les annonces expirées ou en pause disparaissent et ne reçoivent plus de demandes ; les téléphones des propriétaires et les notes internes ne figurent pas dans la vue publique.
- **Site web** : les vrais `index.html` et `js/app.js` ont été chargés dans un navigateur simulé avec une fausse base de données et passés par 96 vérifications (navigation et recherche des visiteurs, filtres par région, curseur de budget, recherche de la page d'accueil, formulaire de demande avec piège anti-spam, protection de l'administration, suivi des demandes, éditeur d'annonces avec photos, propriétaires). J'ai aussi cassé volontairement le code deux fois pour confirmer que les vérifications détectent de vrais bogues.
- **Non testé** : le site n'a pas encore tourné dans un vrai navigateur avec un vrai projet Supabase. Prévoyez donc un premier essai (étapes 5 et 6), y compris l'envoi de photos depuis un téléphone. Dites-moi ce qui ne va pas.

## Pas encore inclus (bonnes prochaines étapes)

- **Alerte à l'arrivée d'une nouvelle demande** (un e-mail ou un message WhatsApp pour vous). Aujourd'hui vous voyez le compteur rouge en ouvrant l'Administration : consultez-la souvent. Je peux ajouter une alerte par e-mail.
- **Paiement automatique des frais de publication** (Orange Money / MTN / Wave via un agrégateur). Aujourd'hui vous enregistrez les paiements vous-même avec la date « payée jusqu'au ».
- Un bouton « signaler cette annonce », un captcha si du spam apparaît, une vue carte, un bouton de langue anglaise.
