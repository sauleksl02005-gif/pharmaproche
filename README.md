# PharmaProche — disponibilité de médicaments en pharmacie

Trois espaces :
- **Patient** (`/index.html`) : recherche un médicament (avec suggestions pendant la frappe), filtre par région/ville, et peut utiliser sa position GPS pour voir la distance réelle et la pharmacie la plus proche. Chaque résultat propose d'appeler, d'écrire sur WhatsApp, ou d'ouvrir l'itinéraire si la pharmacie est géolocalisée.
- **Pharmacie** (`/pharmacie.html`) : chaque pharmacie se connecte avec son propre identifiant et gère elle-même son stock (dispo/rupture, ajout de nouveaux médicaments).
- **Admin** (`/admin.html`) : ajoute de nouvelles pharmacies (région/ville du Cameroun existantes ou nouvelles, quartier, coordonnées GPS, numéro de téléphone, médicaments de départ, identifiants de connexion), peut réinitialiser leur mot de passe ou les supprimer.

## Lancer le projet

Aucune dépendance à installer — Node.js natif uniquement.

```bash
node server.js
```

Le serveur démarre sur `http://localhost:3000`.

**Au tout premier lancement**, un compte admin est créé automatiquement avec un mot de passe aléatoire, affiché **une seule fois** dans le terminal :

```
Compte admin créé automatiquement :
  identifiant : admin
  mot de passe : xxxxxxxxxxxx
```

Notez-le immédiatement. Des pharmacies de démonstration sont aussi créées (mot de passe commun `ChangeMoi123!`, à changer en conditions réelles — il n'y a pas encore d'écran "changer mon mot de passe", à ajouter avant une mise en production).

Les données vivent dans `data/pharmacies.json` et `data/admins.json` (créés automatiquement, à exclure d'un dépôt Git public).

## Mettre le projet en ligne

Le plus simple pour débuter : **Render.com**, gratuit pour démarrer, pas besoin d'installer quoi que ce soit sur ton ordinateur, HTTPS automatique.

1. **Mettre le code sur GitHub** (sans avoir besoin de la ligne de commande) :
   - Crée un compte sur [github.com](https://github.com)
   - Crée un nouveau dépôt (bouton vert "New")
   - Sur la page du dépôt vide : "uploading an existing file" → glisse-dépose tout le contenu du dossier `pharmaproche` (PAS le dossier `data` s'il existe — il sera recréé tout seul)

2. **Déployer sur Render** :
   - Crée un compte sur [render.com](https://render.com) (tu peux te connecter directement avec ton compte GitHub)
   - "New +" → "Web Service" → choisis ton dépôt
   - Renseigne :
     - **Build command** : laisse vide
     - **Start command** : `node server.js`
     - **Environment variable** : ajoute `DATA_DIR` = `/data`
   - Dans l'onglet "Disks" : ajoute un disque persistant, monté sur `/data` (~1 Go suffit largement) — **indispensable**, sinon toutes les pharmacies ajoutées disparaissent à chaque redémarrage du serveur.
   - Clique "Create Web Service". Render te donne une adresse du type `https://pharma237.onrender.com`, accessible à tous.

3. **Après le premier déploiement** : va dans les "Logs" de Render pour récupérer le mot de passe admin généré automatiquement (affiché une seule fois, comme en local).

Le plan gratuit de Render met le service en veille après 15 minutes sans visite (le premier chargement est alors un peu lent) — largement suffisant pour un pilote ou une démo. Pour un vrai usage en production, prévois un plan payant (quelques dollars/mois).

**Alternative pour plus de contrôle** : un petit serveur privé (VPS) chez un hébergeur comme Contabo ou DigitalOcean (~3-5 $/mois), avec `node server.js` lancé en tâche de fond (outil `pm2`) et un nom de domaine pointé dessus. Plus technique, mais aucune limite de veille et données garanties persistantes par défaut. Dis-moi si tu veux ce chemin, je te guide pas à pas.

**Dans tous les cas, avant d'ouvrir au public :**
- Change le mot de passe des pharmacies de démonstration (`ChangeMoi123!`) ou supprime-les depuis l'espace admin.
- Le mot de passe admin généré au premier lancement ne s'affiche qu'une fois — note-le depuis les logs d'hébergement dès le déploiement.

## Ce qui est déjà sécurisé

- Mots de passe jamais stockés en clair : hachés avec `scrypt` (module natif Node), sel aléatoire par compte, comparaison à temps constant.
- Sessions par cookie **HttpOnly** (inaccessible en JavaScript côté client) + `SameSite=Strict` (protection CSRF de base), expirant après 8h.
- Chaque route pharmacie/admin vérifie la session côté serveur ; une pharmacie ne peut modifier que **son propre** stock (jamais celui d'une autre, même en trafiquant les requêtes).
- Limitation des tentatives de connexion : 5 essais par IP / 15 min, au-delà : blocage temporaire (anti brute-force).
- Écriture des fichiers JSON de façon atomique (fichier temporaire + renommage) pour éviter un fichier corrompu en cas de coupure.
- Entrées utilisateur systématiquement nettoyées et limitées en taille côté serveur ; affichage côté client via `textContent` (pas d'injection HTML).
- En-têtes de sécurité de base (`X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy`).

## Limites connues, à traiter avant une vraie mise en production

- Pas de HTTPS en local (à mettre derrière un reverse proxy Nginx/Caddy avec certificat TLS si hébergé ailleurs que Render, qui le fournit automatiquement) — la géolocalisation du navigateur exige d'ailleurs HTTPS pour fonctionner (ou `localhost`).
- Pas d'écran "changer son mot de passe" pour une pharmacie elle-même, ni de réinitialisation par email/SMS (l'admin peut réinitialiser un mot de passe, voir plus haut).
- La distance affichée est "à vol d'oiseau" (formule de Haversine), pas un vrai trajet routier — pour un itinéraire précis, le patient clique sur "🧭 Itinéraire" qui ouvre Google Maps.
- Le stockage JSON fichier convient pour un pilote sur une ville ; au-delà de quelques centaines de pharmacies, prévoir une vraie base de données (SQLite en zéro-dépendance quasi, ou PostgreSQL).
- Un seul rôle admin global : pas de gestion fine des droits (par exemple un admin par région).
- Le lien WhatsApp suppose un numéro joignable sur WhatsApp ; sans l'app installée, le bouton ouvre simplement wa.me dans le navigateur.

## Idées pour la suite
- Permettre à chaque pharmacie de modifier elle-même son téléphone et ses coordonnées GPS (aujourd'hui, seul l'admin les saisit à la création).
- Historique des ruptures par médicament, pour repérer les pénuries récurrentes.
- Notification (email/SMS) au patient quand un médicament en rupture redevient disponible dans une pharmacie suivie.
- Carte interactive (Leaflet) listant toutes les pharmacies géolocalisées d'une ville d'un coup d'œil, plutôt qu'une simple liste.
