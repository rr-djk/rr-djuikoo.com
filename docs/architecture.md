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
- Le fichier `site/js/main.js` gère la communication asynchrone avec l'API, le verrouillage de l'interface pendant le traitement et le traitement du flux NDJSON (`parseNDJSONStream`).

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
