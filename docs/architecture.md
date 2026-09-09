# Architecture technique

Ce document décrit l'architecture détaillée du projet rr-djuikoo.com, ses flux de données et ses composants fonctionnels.

## Principe fondateur : Source unique de vérité

Le projet repose sur la séparation stricte entre la source des données (`src/profile.mjs`) et les artefacts de production (`site/index.html` et `site/content.json`).

Une seule modification de `src/profile.mjs` met à jour à la fois le site statique pour les utilisateurs et la base de connaissances utilisée par l'assistant virtuel Wags, sans nécessiter de redéploiement d'infrastructure.

## Flux de données

### 1. Génération et distribution du contenu statique

```
src/profile.mjs + src/index.template.html
               │
               ▼
     scripts/build-site.mjs
               │
      ┌────────┴────────┐
      ▼                 ▼
site/index.html   site/content.json
      │                 │
      ▼                 ▼
   S3 Site           S3 Site
      │                 │
      └────────┬────────┘
               ▼
           CloudFront
               │
               ▼
            Browser
```

- `scripts/build-site.mjs` (script Node.js sans dépendance) injecte les données de `src/profile.mjs` dans le gabarit `src/index.template.html` pour produire `site/index.html`.
- En parallèle, le script extrait l'ensemble des données structurées et génère `site/content.json`.
- `site/index.html` et `site/content.json` sont synchronisés vers le bucket S3 privé et distribués par CloudFront.

### 2. Traitement d'une requête de chat

```
Browser
   │  POST /api/chat (NDJSON)
   ▼
CloudFront (/api/*)
   │  SigV4 (OAC)
   ▼
Lambda Function URL (AWS_IAM)
   │
   ├─► DynamoDB (Vérification Rate Limit & Sessions)
   ├─► S3 (Lecture content.json, cache TTL 5 min)
   │
   ▼
Amazon Bedrock (Claude Haiku 4.5)
   │
   ▼
Streaming NDJSON (tokens)
   │
   ▼
Browser
```

1. **Envoi de la demande** : Le navigateur génère un `sessionId` unique et envoie une requête HTTP POST `/api/chat` contenant le message et le hachage SHA-256 du corps (`X-Amz-Content-Sha256`).
2. **Acheminement sécurisé** : CloudFront intercepte l'appel sous `/api/*` et le redirige vers la Lambda URL. La signature SigV4 est appliquée par CloudFront via Origin Access Control (OAC).
3. **Contrôle et contexte** : La Lambda (`agent/index.mjs`) vérifie les limites de débit dans DynamoDB (`RATE_LIMIT_TABLE`). Elle récupère `content.json` sur S3 avec une mise en cache en mémoire de 5 minutes (`agent/content.mjs`).
4. **Exécution du modèle** : L'agent Strands (`agent/agent.mjs`) est instancié avec les outils construits dynamiquement (`makeTools`). Il invoque Amazon Bedrock (`global.anthropic.claude-haiku-4-5-20251001-v1:0`).
5. **Réponse en streaming** : La réponse est transmise au navigateur au format NDJSON (`type: token`, `type: done` ou `type: error`).

## Composants du système

### Frontend (`site/`)

- HTML, CSS et JavaScript natifs sans framework externe.
- **Rendu Markdown & Sanitization** :
  - Utilise `marked` (v18) et `DOMPurify` (v3) vendorisés localement (`site/js/vendor/`).
  - Configuration GFM avec retours à la ligne explicites (`breaks: true`).
  - Sanitization stricte (`DOMPurify`) sur une liste blanche de balises (`p`, `code`, `pre`, `ul`, `ol`, `table`, etc.), interdisant l'injection d'images inline (`img`) et forçant `target="_blank" rel="noopener noreferrer"` sur tous les liens hypertextes.
- **Gestion du flux NDJSON & Batching d'affichage** :
  - `site/js/main.js` accumule le Markdown **brut** au fil de la réception du flux NDJSON (`parseNDJSONStream`), jamais du HTML, et re-parse la chaîne complète à chaque rendu. `marked` étant sans état entre deux appels, une syntaxe coupée entre deux tokens (`**`, un lien, une fence) se referme correctement au token suivant. C'est ce mécanisme, et lui seul, qui assure la justesse du rendu pendant le streaming.
  - Le rendu HTML et la sanitization sont ensuite planifiés par image via `requestAnimationFrame`, ce qui regroupe une rafale de tokens en une seule écriture DOM. Il s'agit d'une optimisation, indépendante de la justesse du rendu assurée par le point précédent.
  - Un curseur clignotant CSS (`.chat-message.is-streaming::after`) signale visuellement le streaming actif.

### Dépendances front (`site/js/vendor/`)

Pour permettre à Trivy d'analyser les vulnérabilités des bibliothèques JavaScript chargées par le navigateur sans ajouter de bundler (Webpack/Vite), les dépendances `marked` et `dompurify` sont déclarées dans `package.json` à la racine. Les fichiers de `site/js/vendor/` sont, comme `site/index.html` et `site/content.json`, des artefacts générés et committés : ils ne doivent jamais être édités à la main.

- La commande `make vendor` (déclenchée automatiquement par le hook pre-commit `vendor-deps` dès que `package.json`, `package-lock.json` ou `site/js/vendor/` changent) copie les builds navigateur depuis `node_modules/` vers `site/js/vendor/`. Ce sont deux modules UMD, chargés par de simples balises `<script>` : `marked.umd.js`, non minifié, et `purify.min.js`.
- Le fichier `node_modules/.deps-stamp` enregistre l'empreinte SHA-256 de `package-lock.json`. Il compare volontairement le contenu et non les dates de modification, jugées peu fiables, et garantit ainsi que `node_modules` correspond au lockfile avant toute copie. La fraîcheur de `site/js/vendor/` est vérifiée séparément, par le hook `vendor-deps` et par l'étape d'alignement en CI.
- Le fichier `.npmrc` applique `save-exact=true`, `ignore-scripts=true` et `audit-level=moderate`.

### Environnement de test local (`make mock`)

Pour tester le rendu du chat sans consommer de tokens Bedrock ni nécessiter d'accès AWS :

- Un serveur HTTP/1.1 Python (`mocks/server.py`) sert les fichiers statiques de `site/` et intercepte `POST /api/chat`.
- Le serveur simule la réponse de la Lambda en transmettant des données NDJSON streamées (`Transfer-Encoding: chunked`).
- Un jeu de 7 fixtures (`mocks/replies/`) rejoue en rotation les cas limites de rendu (mise en forme, blocs de code, tableaux, liens, coupures de tokens mi-mot, tentatives d'injection XSS).

### Runtime Agent (`agent/`)

- Exécuté dans une fonction Lambda Node.js 22 (`arm64`).
- Utilise le SDK `@strands-agents/sdk` et Zod pour la définition et la validation des outils de l'agent.
- Maintient l'historique de conversation dans une table DynamoDB dédiée.

### Infrastructure AWS

- **Région** : `us-east-1`
- **Distribution** : CloudFront avec certificat ACM et enregistrements DNS Route 53.
- **Stockage** : Bucket S3 privé (bloqué à tout accès public direct).
- **Calcul** : AWS Lambda avec réponse en streaming (`RESPONSE_STREAM`).
- **Base de données** : Amazon DynamoDB en mode à la demande.
- **Intelligence Artificielle** : Amazon Bedrock.
