# Rencontre Congo 🧡💙❤️

Application de rencontre simple, pensée pour la communauté congolaise (RDC & Congo-Brazzaville).

## Fonctionnalités
- Inscription / connexion par numéro de téléphone (RDC ou Congo-Brazzaville) + mot de passe, **avec vérification du numéro par code SMS**
- Profil avec photo, âge, genre, ville, pays, langues parlées (Lingala, Swahili, Kikongo, Tshiluba, Français, Anglais), bio
- Découverte de profils façon "carte", avec filtre par ville et par langue
- Like / Passer, avec détection automatique du match mutuel
- Messagerie simple entre personnes qui ont matché
- **3 packs** : Standard (gratuit), Premium et VIP — voir `lib/plans.js`
- **Paiement Mobile Money** (Orange Money, Airtel Money, M-Pesa, carte) via CinetPay — voir section dédiée
- **Appels vocaux et vidéo** entre matchs (réservés Premium/VIP) via WebRTC
- **Signalement et blocage de profils**, accessibles depuis la découverte et le chat
- **Installable sur iOS et Android** (PWA) — pas besoin de passer par l'App Store ou le Play Store

## Prérequis
- [Node.js](https://nodejs.org/) version 20 ou plus récente (télécharge la version "LTS")

## Installation

```bash
npm install
npm start
```

Puis ouvre **http://localhost:3000** dans ton navigateur.

## Configuration (.env)
Copie `.env.example` en `.env` et remplis les valeurs (voir les commentaires dans le fichier). `DATABASE_URL` est **obligatoire** (voir section Base de données ci-dessous). Sans le reste, l'app tourne quand même en **mode démo** :
- Sans clés CinetPay → changer de pack est instantané et gratuit (pratique pour présenter l'app)
- Sans `TURN_URL` → les appels utilisent uniquement des serveurs STUN gratuits (voir limite ci-dessous)

## Base de données (PostgreSQL)
Toutes les données (comptes, profils, likes, matchs, messages, commandes) sont stockées dans PostgreSQL — plus de fichier `data.json`. Ça gère correctement plusieurs personnes qui utilisent l'app en même temps (un simple fichier ne le pouvait pas de façon fiable).

- Les tables sont créées automatiquement au démarrage (`lib/db.js`, fonction `initSchema()`) — pas d'outil de migration séparé à ce stade.
- **En local** : crée une base sur [dashboard.render.com](https://dashboard.render.com) → New → PostgreSQL (ou toute autre instance Postgres), copie son "External Database URL" dans `DATABASE_URL` (`.env`).
- **En production (Render)** : `render.yaml` déclare la base et relie automatiquement `DATABASE_URL` au service web via `fromDatabase` — rien à copier-coller à la main, et la connexion passe par le réseau privé de Render (beaucoup plus rapide qu'une connexion externe).
- Toute la logique base de données passe par `lib/store.js` (fonctions async) — le reste du code (routes, vues) n'a pas besoin de savoir que c'est PostgreSQL.

## Paiement Mobile Money (CinetPay)
1. Crée un compte sur [cinetpay.com](https://cinetpay.com) (KYC entreprise requis)
2. Renseigne `CINETPAY_API_KEY` et `CINETPAY_SITE_ID` dans `.env`
3. **Teste un vrai paiement en mode test CinetPay avant de passer en argent réel** — l'intégration (`lib/cinetpay.js`) est basée sur la documentation publique de CinetPay, pas sur un compte réel testé pendant le développement
4. Ajuste les montants dans `lib/plans.js` (`amount`, en `CINETPAY_CURRENCY`)

Le flux : achat de pack → redirection vers la page de paiement CinetPay → webhook (`/paiement/notifier`) + double-vérification du statut avant de créditer le compte (jamais confiance aveugle dans un webhook, recommandation officielle CinetPay).

## Vérification du numéro par SMS (Twilio Verify)
1. Crée un compte sur [twilio.com](https://twilio.com)
2. Récupère `Account SID` et `Auth Token` depuis la Console Twilio
3. Crée un **Verify Service** (Console → Verify → Services → Create) pour obtenir le `Service SID` (commence par `VA`)
4. Renseigne `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` dans `.env`

Twilio supporte officiellement l'envoi de SMS vers la RDC (+243) et le Congo-Brazzaville (+242). Un compte Twilio en version d'essai ("trial") ne peut envoyer des SMS qu'à des numéros pré-vérifiés dans sa console — passe en compte payant avant un vrai lancement.

Le flux : inscription (numéro + mot de passe) → code à 6 chiffres envoyé par SMS via Twilio Verify → saisie du code sur `/verify-phone` → le compte n'est **créé en base qu'après validation du code** (`lib/sms.js` + route `/verify-phone` dans `server.js`). Twilio gère lui-même l'expiration du code et la limite de tentatives — rien à stocker de notre côté.

Sans compte Twilio configuré, l'app reste en **mode démo** : le code est généré côté serveur et affiché directement sur la page de vérification au lieu d'être envoyé par SMS.

## Signalement et blocage de profils
Accessibles depuis une carte de découverte (`/browse`) ou le menu « ⋮ » d'une conversation (`/chat/:matchId`) :

- **Bloquer** (`/bloquer/:userId`) coupe tout de suite les deux sens : la personne bloquée disparaît de ta découverte, de « qui m'a liké » et de tes matchs, et inversement — même chose si c'est elle qui te bloque. Une conversation déjà commencée devient inaccessible (le match reste en base, juste caché). Réversible à tout moment depuis **Comptes bloqués** (lien en bas de la page Profil, `/parametres/blocages`).
- **Signaler** (`/signaler/:userId`) enregistre un motif (faux profil, harcèlement, arnaque, contenu choquant, autre) + des précisions optionnelles en base (table `reports`). La case « Bloquer aussi cette personne » est cochée par défaut. Il n'y a pas encore d'interface d'administration pour consulter les signalements — ça se fait pour l'instant en interrogeant directement la table `reports` en base.

Le gating est fait côté serveur à tous les niveaux (recherche de profils, chat, et jusqu'à la signalisation WebSocket des appels) — pas seulement caché dans l'interface.

## Appels vocaux et vidéo (Premium/VIP)
Implémentés en WebRTC pur (pas de service tiers de visioconférence) :
- Signalisation via WebSocket (`lib/signaling.js`) — relaie les messages entre les deux personnes d'un match (offres/réponses SDP, candidats ICE), ne transporte jamais le son/l'image
- Gating serveur : seul un compte Premium/VIP peut **lancer** un appel (vérifié côté serveur, pas juste caché dans l'interface) ; recevoir un appel est possible avec n'importe quel pack
- `lib/iceServers.js` fournit les serveurs STUN/TURN au navigateur

⚠️ **Limite importante** : sans serveur TURN, les appels fonctionnent bien en Wifi mais peuvent échouer sur certains réseaux mobiles/4G (fréquent avec le CGNAT utilisé par beaucoup d'opérateurs). Pour fiabiliser, ajoute un serveur TURN (Twilio Network Traversal Service, Xirsys, ou un coturn auto-hébergé) via 3 variables d'environnement — aucun changement de code nécessaire :
```
TURN_URL=turn:ton-serveur:3478
TURN_USERNAME=...
TURN_CREDENTIAL=...
```

Grâce à la navigation SPA (voir ci-dessous), un appel en cours **survit** à un changement de page — plus besoin de rester bloqué sur un seul écran pendant un appel.

## Navigation "SPA légère" (`public/js/router.js`)
Le site reste un site multi-pages classique côté serveur (chaque route EJS produit toujours une page HTML complète et valide — fonctionne même sans JavaScript, un lien direct ou un F5 marchent toujours). `router.js` intercepte les clics sur les liens et les envois de formulaires internes, va chercher la page cible en arrière-plan (`fetch`), puis ne remplace que `<div id="app-content">` au lieu de recharger toute la page.

Pourquoi cette approche plutôt qu'une réécriture complète en React/Vue :
- Aucun changement d'architecture serveur, aucun outil de build à maintenir — plus simple à reprendre pour quelqu'un qui découvre le projet
- Fonctionne en dégradé gracieux si JS est indisponible (chaque page reste une vraie page)
- Résout le vrai problème (les appels coupés en changeant de page) sans le risque d'une réécriture complète

Points d'attention si tu ajoutes une nouvelle page :
- Le contenu propre à la page doit être dans `<div id="app-content">` (ou `<main id="app-content">`) — c'est la seule zone que le routeur remplace
- `<body data-logged-in="...">` doit refléter `currentUserId` — c'est ce qui permet au routeur de savoir s'il faut couper une connexion d'appel après une navigation (ex: après déconnexion)
- Un formulaire qui peut rediriger vers un autre site (ex: paiement CinetPay) doit avoir l'attribut `data-full-reload` pour ne pas être intercepté
- Un script de page qui doit être nettoyé en quittant la page (ex: un `setInterval`) doit s'enregistrer via `window.__pageCleanup = () => { ... }` (voir `public/js/chat.js`)

## Version mobile (PWA — installable sur iOS et Android)
Pas d'app native, pas d'App Store/Play Store, pas de compte développeur à créer : l'app se transforme en icône sur l'écran d'accueil via "Ajouter à l'écran d'accueil" du navigateur.

**Sur iPhone (Safari)** : ouvrir le site → bouton Partager (carré avec flèche) → "Sur l'écran d'accueil".
**Sur Android (Chrome)** : ouvrir le site → menu ⋮ → "Ajouter à l'écran d'accueil" (ou bannière d'installation automatique).

Fichiers concernés :
- `public/manifest.json` — nom, icônes, couleur du thème
- `public/service-worker.js` — rend l'app installable et affiche `public/offline.html` en cas de coupure réseau (met en cache uniquement les fichiers statiques CSS/JS/icônes, jamais les données dynamiques comme les messages ou profils)
- `public/icons/` — icônes générées en plusieurs tailles (192, 512, 512 maskable pour Android, 180 pour iOS)

⚠️ **Différence avec une vraie app store** : pas de fiche App Store/Play Store, pas de notifications push natives, découverte uniquement via lien direct (à partager toi-même). Si un jour tu veux une vraie présence sur les stores, il faudra un compte Apple Developer (99$/an) et Google Play (25$), un Mac pour compiler la version iOS, et passer par la revue d'Apple/Google — un chantier à part.

## Déploiement (Render)
Le dépôt contient un `render.yaml` prêt à l'emploi :
1. [dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint** → connecte ce dépôt GitHub
2. Renseigne `APP_BASE_URL` (l'URL que Render te donne) et les clés CinetPay dans son dashboard
3. Le disque persistant (`disk` dans `render.yaml`, pour les photos) et la base PostgreSQL nécessitent un plan payant — pas inclus dans le plan gratuit

## Notes techniques
- Les données sont dans PostgreSQL (voir section dédiée plus haut) ; les photos de profil restent des fichiers, stockés dans `uploads/` (affecté par `DATA_DIR` — pointe vers le disque persistant en production).
- Les mots de passe sont hachés (scrypt), jamais stockés en clair.
- Sessions en cookie signé (`express-session`) — pense à changer `SESSION_SECRET` en production (`render.yaml` en génère un automatiquement).
- Le numéro de téléphone est normalisé (indicatif pays + numéro, ex `+243812345678`) et sert d'identifiant unique ; il est vérifié par SMS avant la création du compte (voir section dédiée).

## Idées pour la suite
- Serveur TURN pour fiabiliser les appels en 4G
- Historique des appels manqués
- Notifications
- Interface d'administration pour consulter/traiter les signalements (table `reports`)
