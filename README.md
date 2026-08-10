# Rencontre Congo 🧡💙❤️

Application de rencontre simple, pensée pour la communauté congolaise (RDC & Congo-Brazzaville).

## Fonctionnalités
- Inscription / connexion par numéro de téléphone (RDC ou Congo-Brazzaville) + mot de passe
- Profil avec photo, âge, genre, ville, pays, langues parlées (Lingala, Swahili, Kikongo, Tshiluba, Français, Anglais), bio
- Découverte de profils façon "carte", avec filtre par ville et par langue
- Like / Passer, avec détection automatique du match mutuel
- Messagerie simple entre personnes qui ont matché
- **3 packs** : Standard (gratuit), Premium et VIP — voir `lib/plans.js`
- **Paiement Mobile Money** (Orange Money, Airtel Money, M-Pesa, carte) via CinetPay — voir section dédiée
- **Appels vocaux et vidéo** entre matchs (réservés Premium/VIP) via WebRTC

## Prérequis
- [Node.js](https://nodejs.org/) version 20 ou plus récente (télécharge la version "LTS")

## Installation

```bash
npm install
npm start
```

Puis ouvre **http://localhost:3000** dans ton navigateur.

## Configuration (.env)
Copie `.env.example` en `.env` et remplis les valeurs (voir les commentaires dans le fichier). Sans configuration, l'app tourne quand même en **mode démo** :
- Sans clés CinetPay → changer de pack est instantané et gratuit (pratique pour présenter l'app)
- Sans `TURN_URL` → les appels utilisent uniquement des serveurs STUN gratuits (voir limite ci-dessous)

## Paiement Mobile Money (CinetPay)
1. Crée un compte sur [cinetpay.com](https://cinetpay.com) (KYC entreprise requis)
2. Renseigne `CINETPAY_API_KEY` et `CINETPAY_SITE_ID` dans `.env`
3. **Teste un vrai paiement en mode test CinetPay avant de passer en argent réel** — l'intégration (`lib/cinetpay.js`) est basée sur la documentation publique de CinetPay, pas sur un compte réel testé pendant le développement
4. Ajuste les montants dans `lib/plans.js` (`amount`, en `CINETPAY_CURRENCY`)

Le flux : achat de pack → redirection vers la page de paiement CinetPay → webhook (`/paiement/notifier`) + double-vérification du statut avant de créditer le compte (jamais confiance aveugle dans un webhook, recommandation officielle CinetPay).

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

## Déploiement (Render)
Le dépôt contient un `render.yaml` prêt à l'emploi :
1. [dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint** → connecte ce dépôt GitHub
2. Renseigne `APP_BASE_URL` (l'URL que Render te donne) et les clés CinetPay dans son dashboard
3. Le disque persistant (`disk` dans `render.yaml`) évite de perdre les données à chaque redéploiement — nécessite un plan payant (~7$/mois), pas inclus dans le plan gratuit

## Notes techniques
- Stockage des données dans un simple fichier `data.json` (créé automatiquement) — pas de base de données à installer. Pointe `DATA_DIR` vers un disque persistant en production. Pour un vrai déploiement à grande échelle, il faudrait migrer vers une vraie base (PostgreSQL/MySQL/MongoDB).
- Les photos de profil sont stockées dans `uploads/` (aussi affecté par `DATA_DIR`).
- Les mots de passe sont hachés (scrypt), jamais stockés en clair.
- Sessions en cookie signé (`express-session`) — pense à changer `SESSION_SECRET` en production (`render.yaml` en génère un automatiquement).
- Le numéro de téléphone est normalisé (indicatif pays + numéro, ex `+243812345678`) et sert d'identifiant unique, mais **n'est pas vérifié par SMS** — n'importe qui peut saisir n'importe quel numéro. Pour une vraie vérification (code à 6 chiffres envoyé par SMS), il faudrait brancher un service comme Twilio.

## Idées pour la suite
- Vraie vérification par SMS (code à 6 chiffres via Twilio ou équivalent)
- Serveur TURN pour fiabiliser les appels en 4G
- Historique des appels manqués
- Notifications
- Blocage / signalement de profils
- Migration vers une vraie base de données pour la montée en charge
