# Rencontre Congo 🧡💙❤️

Application de rencontre simple, pensée pour la communauté congolaise (RDC & Congo-Brazzaville).

## Fonctionnalités
- Inscription / connexion par numéro de téléphone (RDC ou Congo-Brazzaville) + mot de passe
- Profil avec photo, âge, genre, ville, pays, langues parlées (Lingala, Swahili, Kikongo, Tshiluba, Français, Anglais), bio
- Découverte de profils façon "carte", avec filtre par ville et par langue
- Like / Passer, avec détection automatique du match mutuel
- Messagerie simple entre personnes qui ont matché

## Prérequis
- [Node.js](https://nodejs.org/) version 16 ou plus récente (télécharge la version "LTS")

## Installation

```bash
npm install
npm start
```

Puis ouvre **http://localhost:3000** dans ton navigateur.

## Notes techniques
- Stockage des données dans un simple fichier `data.json` à la racine (créé automatiquement) — pas de base de données à installer, pratique pour tester rapidement. Pour un vrai déploiement avec plusieurs milliers d'utilisateurs, il faudrait migrer vers une vraie base (PostgreSQL/MySQL/MongoDB).
- Les photos de profil sont stockées dans `uploads/`.
- Les mots de passe sont hachés (scrypt), jamais stockés en clair.
- Sessions en cookie signé (`express-session`) — pense à changer `SESSION_SECRET` en production.
- Le numéro de téléphone est normalisé (indicatif pays + numéro, ex `+243812345678`) et sert d'identifiant unique, mais **n'est pas vérifié par SMS** — n'importe qui peut saisir n'importe quel numéro. Pour une vraie vérification (code à 6 chiffres envoyé par SMS), il faudrait brancher un service comme Twilio (compte + coût par SMS).

## Idées pour la suite
- Vraie vérification par SMS (code à 6 chiffres via Twilio ou équivalent)
- Notifications
- Blocage / signalement de profils
- Déploiement sur un hébergeur (Render, Railway, VPS...) avec un vrai nom de domaine
