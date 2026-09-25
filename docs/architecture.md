# Architecture technique

Ce document décrit l'architecture détaillée du projet rr-djuikoo.com, ses flux de données et ses composants fonctionnels.

## Principe fondateur : Source unique de vérité

Le projet repose sur la séparation stricte entre la source des données (`src/profile.mjs`) et les artefacts de production (`site/index.html` et `site/content.json`).

Le fichier `src/profile.mjs` contient l'ensemble des informations du portfolio (identité, biographie, liens de contact, projets GitHub, expériences, formations, certifications).

Une seule modification de `src/profile.mjs` suivie de `make build` met à jour simultanément :

1. Le site statique HTML pour les utilisateurs (`site/index.html`).
2. Le fichier JSON structuré (`site/content.json`) qui constitue la base de connaissances de l'assistant virtuel Wags.

Lorsque `content.json` est synchronisé sur S3, la fonction Lambda le lit lors des requêtes HTTP (avec une mise en cache mémoire de 5 minutes dans `agent/orchestrator/content.mjs` et un fallback local). Ainsi, la mise à jour des informations personnelles de l'auteur ne nécessite **aucun redéploiement d'infrastructure** (`terraform apply` non requis).

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

### 2. Traitement d'une requête de chat (Streaming & Multi-Agent)

```
Browser
   │  POST /api/chat {message, sessionId, captchaToken}
   ▼
CloudFront (/api/*)
   │  SigV4 (OAC)
   ▼
Lambda Function URL (AWS_IAM)
   │
   ├─► DynamoDB (Rate Limit & Sessions)
   ├─► SSM Parameter Store (Secret Turnstile, cache mémoire)
   ├─► Cloudflare Siteverify (Validation captcha au 1er message, fail-open)
   ├─► S3 (Chargement synchrone content.json, cache TTL 5 min)
   ├─► Heartbeat (Ping NDJSON toutes les 10s)
   │
   ▼
Runtime Multi-Agent Strands (Claude Haiku 4.5)
   ├── Gatekeeper (Filtrage hors-sujet fail-open)
   ├── Orchestrateur Wags (8 outils)
   └── Code Explorer (Inspection /tmp repositories GitHub)
   │
   ▼
Streaming NDJSON (tokens / ping / done / error)
   │
   ▼
Browser (Rendu Markdown & Animation is-waiting)
```

1. **Envoi de la demande** : Le navigateur génère un `sessionId` unique et envoie une requête HTTP POST `/api/chat` contenant le message, le `sessionId`, le champ `captchaToken` (présent dans chaque requête, mais qui n'a d'effet que pour le premier message d'une session) et le hachage SHA-256 du corps (`X-Amz-Content-Sha256`).
2. **Acheminement sécurisé** : CloudFront intercepte l'appel sous `/api/*` et le redirige vers la Lambda URL. La signature SigV4 est appliquée par CloudFront via Origin Access Control (OAC).
3. **Contrôle de débit, validation du captcha & chargement du contenu** : La Lambda (`agent/index.mjs`) vérifie les limites de débit dans DynamoDB (`RATE_LIMIT_TABLE`, max 20 requêtes / 10 min par IP). Sur le premier message de la session, la Lambda valide le jeton Turnstile (`agent/captcha.mjs`) auprès de l'API Cloudflare Siteverify à l'aide du secret lu dans SSM (`TURNSTILE_SECRET_PARAM`). La vérification contrôle l'action (`chat_first_message`), le nom d'hôte (`rr-djuikoo.com`) et enregistre `captchaVerified: true` dans DynamoDB via `UpdateCommand`. En cas de panne de Cloudflare, la validation applique le principe _fail-open_ pour ne pas bloquer les utilisateurs. Les messages suivants de la session sont dispensés de captcha. L'IP est lue dans `cloudfront-viewer-address`, écrit par CloudFront, et le numéro de la tranche de 10 minutes fait partie de la clé. Un `sessionId` non conforme à UUID v4 est rejeté (`INVALID_SESSION`) avant tout appel Bedrock. Le fichier `content.json` est chargé de façon synchrone afin de fournir les noms de projets au filtre. Un temporisateur émet un ping NDJSON (`{"type":"ping"}`) toutes les 10 secondes pour maintenir la connexion CloudFront active pendant les opérations longues.
4. **Filtrage de garde (Gatekeeper)** : Le message passe par l'agent `Gatekeeper` auquel le contenu du profil est transmis. S'il s'agit d'une question hors-sujet, il génère une réponse de refus directe dans la langue du visiteur.
5. **Orchestration & Outils (Wags)** : Si la question est légitime, l'Orchestrateur Wags prend le relais. Il consulte le profil, répond aux questions sur le parcours ou délègue les questions techniques approfondies au sous-agent `Code Explorer`.
6. **Réponse en streaming** : Les tokens générés sont transmis au navigateur au format NDJSON (`type: token`, `type: ping`, `type: done` ou `type: error`).

## Composants du système

### Frontend (`site/`)

- HTML, CSS et JavaScript natifs sans framework externe.
- **Indicateur d'attente & Parsing NDJSON** :
  - Lorsque la réponse HTTP démarre et que la promesse `fetch` se résout dans `readReply` (`site/js/main.js`), le chat affiche 3 points animés (`is-waiting`).
  - La fonction `parseNDJSONStream` découpe le flux binaire reçu et émet chaque ligne sous forme d'objet JSON.
  - La fonction `readReply` traite les événements `token`, `done` et `error`, et ignore silencieusement les trames de maintien de connexion (`type: ping`).
- **Rendu Markdown & Sanitization** :
  - Utilise `marked` (v18) et `DOMPurify` (v3) vendorisés localement (`site/js/vendor/`).
  - Configuration GFM avec retours à la ligne explicites (`breaks: true`).
  - Sanitization stricte (`DOMPurify`) sur une liste blanche de balises (`p`, `code`, `pre`, `ul`, `ol`, `table`, etc.), interdisant l'injection d'images inline (`img`) et forçant `target="_blank" rel="noopener noreferrer"` sur tous les liens hypertextes.
  - Filtre de liens dans le même hook `DOMPurify` : un lien ne reste cliquable que vers un domaine de `ALLOWED_LINK_HOSTS` (les domaines présents dans `content.json`) ou vers `mailto:`. Les autres perdent leur `href` et gardent leur texte. La liste est à tenir à jour si le profil ajoute un domaine.
- **Protection anti-bot (Cloudflare Turnstile)** :
  - Un widget Cloudflare Turnstile (`#turnstile-widget`) est affiché au bas du chat. Le champ de saisie et le bouton d'envoi restent verrouillés tant que le défi n'est pas résolu (`captcha.awaiting`, seul propriétaire de cet état dans `main.js`).
  - Dès qu'une réponse backend confirme la session, le widget est retiré du DOM (`captcha.hide()`). En cas d'erreur de validation (`CAPTCHA_REQUIRED` ou `CAPTCHA_INVALID`), le widget est explicitement réinitialisé (`captcha.reset()`, qui appelle `window.turnstile.reset`). Sur expiration du jeton (`expired-callback`), le formulaire se reverrouille sans appel explicite à `reset` : c'est Turnstile qui gère lui-même le renouvellement du défi affiché.
- **Content-Security-Policy** : posée en `<meta>` dans `src/index.template.html`, elle autorise les scripts et connexions du site, les polices Google Fonts, ainsi que les scripts, connexions et frames nécessaires à Cloudflare Turnstile (`https://challenges.cloudflare.com`). Elle se vérifie en local sous `make mock`, dans la console du navigateur.
- **Gestion du flux NDJSON & Batching d'affichage** :
  - `site/js/main.js` accumule le Markdown **brut** au fil de la réception du flux NDJSON, jamais du HTML, et re-parse la chaîne complète à chaque rendu. `marked` étant sans état entre deux appels, une syntaxe coupée entre deux tokens (`**`, un lien, une fence) se referme correctement au token suivant.
  - Le rendu HTML et la sanitization sont planifiés par image via `requestAnimationFrame`, regroupant les rafales de tokens en une seule écriture DOM.

### Dépendances front (`site/js/vendor/`)

Pour permettre à Trivy d'analyser les vulnérabilités des bibliothèques JavaScript chargées par le navigateur sans ajouter de bundler (Webpack/Vite), les dépendances `marked` et `dompurify` sont déclarées dans `package.json` à la racine. Les fichiers de `site/js/vendor/` sont des artefacts générés et committés : il ne faut pas les éditer à la main.

- La commande `make vendor` copie les builds navigateur depuis `node_modules/` vers `site/js/vendor/`.
- Le fichier `node_modules/.deps-stamp` enregistre l'empreinte SHA-256 de `package-lock.json` pour garantir que `node_modules` est aligné avec le lockfile avant la copie.
- Le fichier `.npmrc` applique `save-exact=true`, `ignore-scripts=true` et `audit-level=moderate`.
- Le hook pre-commit `vendor-deps` déclenche automatiquement `make vendor` dès qu'une dérive est détectée.

### Environnement de test local (`make mock`)

Pour tester le rendu du chat sans consommer de tokens Bedrock ni nécessiter d'accès AWS :

- Serveur HTTP Python (`mocks/server.py`) servant `site/` et simulant l'agent via `POST /api/chat`.
- Jeu de 8 fixtures (`mocks/replies/01-*.ndjson` à `08-attente-longue.ndjson`) rejouant en rotation les cas limites de rendu (mise en forme, listes, code, liens, tableaux et citations, tokens coupés, injections XSS, attente longue avec pings NDJSON).

### Suite de tests & Bancs d'essai (`tests/`)

Le projet intègre une suite de tests automatisés basée sur le test runner natif de Node.js (`node --test`), sans aucune dépendance de test ajoutée. Les deux cibles sont séparées parce que l'une coûte de l'argent et pas l'autre : celle qui est gratuite doit pouvoir tourner à chaque modification.

- **`make check`** — `node --test --test-concurrency=1 --test-reporter=spec tests/`, aucun appel AWS. Le `--test-concurrency=1` n'est pas une préférence : le lanceur ouvre un processus par fichier, or `repo.test.mjs` vide l'arborescence `/tmp` que `tools.test.mjs` lit ensuite.
  - `tests/repo.test.mjs` : téléchargement des trois dépôts, extraction filtrée, et six cas d'échec vérifiant que `repo.mjs` rend une phrase lisible sans exposer d'URL ni de trace.
  - `tests/tools.test.mjs` : les trois outils du **sous-agent explorateur** (`list_files`, `read_file`, `search_code`), leur confinement de chemins, leurs trois plafonds, les alternatives séparées par `|`, et un motif à retour arrière catastrophique (`(a+)+$` sur une ligne de 5 000 caractères) qui doit répondre en moins d'une seconde.
  - `tests/wiring.test.mjs` : les huit outils de **l'orchestrateur**, les refus qui n'atteignent jamais le sous-agent, les données dont dépend l'attribution (compte GitHub déductible de `content.json`, MyAm rattaché à un autre compte), et un rapport d'explorateur piégé (fausse ligne `ATTRIBUTION:`, balise fermante) qui ne doit produire qu'une attribution, placée après l'encadrement.
  - `tests/eval.test.mjs` : que `agent-eval.mjs` se charge sans rien exécuter, et que l'extraction des fichiers cités distingue un chemin réel d'un fichier inventé.
- **`make eval`** (`tests/agent-eval.mjs`) — appelle Bedrock sur seize questions de référence réparties en cinq familles : ancrage dans des fichiers réels (2), attribution sur un projet mené à plusieurs (4), cas témoin sur un dépôt personnel où cette mise à distance ne doit **pas** apparaître (1), refus de justifier un choix technique (4), et filtrage du hors-sujet (5). Le cas témoin et la famille filtrage sont les contrepoids : ils attrapent la dérive inverse, un agent qui se dédouanerait de tout ou un garde qui ouvrirait en grand.
  - Les questions traversent `answerWith`, donc le garde, l'orchestrateur et l'explorateur s'exécutent comme en production. L'historique de conversation est écrit dans DynamoDB en effet de bord, sous des `sessionId` préfixés `eval-` qui expirent au TTL de 24 heures de la table.
  - Le verdict par question, les réponses et les compteurs de tokens par agent sont conservés dans `tests/results/agent-eval-<horodatage>.json`, ignoré par git. C'est ce fichier qui permet de comparer deux versions d'un prompt.

### Runtime Agent Multi-Agent (`agent/`)

Exécuté dans AWS Lambda Node.js 22 (`arm64`), le runtime repose sur le SDK `@strands-agents/sdk` et orchestre trois agents spécialisés :

#### 1. Agent Gatekeeper (`agent/gatekeeper/`)

- **Rôle** : Filtrer sans état (_stateless_) les messages des visiteurs avant toute lecture d'historique.
- **Fonctionnement** : Invoque Claude Haiku 4.5 avec un prompt système décrivant les projets et technologies (~490 tokens) et plafonne la taille de la réponse générée avec `MAX_TOKENS = 100`.
- **Détection & Langue** : Le contrat du prompt exige la réponse `OFFTOPIC:` suivie d'une courte explication dans la langue du visiteur. L'expression régulière du code (`REFUSAL_MARKER`) offre une tolérance assouplie aux minuscules et espaces (`OFF TOPIC:`).
- **Stratégie Fail-Open** : En cas de pépin d'API Bedrock ou de réponse non conforme au marqueur, le message est laissé passer vers l'Orchestrateur. Un dysfonctionnement du screener ne bloque jamais un visiteur légitime.

#### 2. Agent Orchestrateur Wags (`agent/orchestrator/`)

- **Rôle** : Agent principal gérant la conversation, l'historique et la synthèse des réponses.
- **Configuration** : Invoque Claude Haiku 4.5 (`global.anthropic.claude-haiku-4-5-20251001-v1:0`) avec `maxTokens: 1024` (limite explicite évitant de réserver le plafond du modèle sur le quota du compte). Le modèle et sa limite de chaque agent (gatekeeper, orchestrateur, code explorer) sont déclarés séparément dans `agent/models.mjs`.
- **Historique** : Sauvegarde et restaure la conversation dans DynamoDB (`SESSIONS_TABLE`, TTL 24h) via `agent/dynamo.mjs`, seul point d'accès à DynamoDB de l'agent.
- **Outils** (`agent/tools/toolbox.mjs`) : un registre déclare, pour chaque agent, la liste des outils qu'il a le droit d'utiliser. L'orchestrateur reçoit 8 outils construits à partir de `content.json` :
  - `get_profile`, `list_projects`, `get_project_details`, `get_education`, `get_experience`, `get_certifications`, `get_contact`.
  - `ask_code_explorer` : Outil de délégation vers le sous-agent d'inspection de code.
- **Streaming manuel** : Utilise l'itérateur manuel sur `agent.stream()` afin d'extraire les objets `AgentResult` (métriques de tokens) sans perdre le streaming.

#### 3. Sous-agent Code Explorer (`agent/code_explorer/`)

- **Rôle** : Explorer le code source réel d'un projet public du portfolio pour répondre aux questions techniques pointues.
- **Résolution sécurisée** (`repo.mjs`) : L'URL du dépôt GitHub est résolue exclusivement depuis l'entrée du projet dans `content.json` (`resolveRepo`). L'utilisateur ou le modèle ne peuvent pas spécifier une URL externe arbitraire.
- **Téléchargement & Caching** : Télécharge l'archive `tar.gz` de la branche `main` (ou `master`) et l'extrait dans `/tmp/repos/`. Le dossier `/tmp` persiste entre invocations chaudes (_warm_), évitant de re-télécharger le dépôt pour des questions consécutives.
- **Extraction & Filtrage strict** :
  - Seuls les fichiers réguliers portant des extensions de code connues (`CODE_EXTENSIONS` : `.js`, `.py`, `.tf`, `.ts`, `.md`, etc.) ou des noms de configuration autorisés (`CODE_FILENAMES`) sont extraits.
  - Les liens symboliques (_symlinks_) sont ignorés lors de l'extraction pour empêcher toute évasion arborescente.
  - Les binaires et les fichiers de secrets (`.env`) sont strictement ignorés (`.env.example` autorisé).
  - Limites : taille max fichier 512 Ko. La taille de l'archive n'est pas plafonnée, GitHub ne la déclarant pas (`content-length` absent).
- **Outils d'exploration** (déclarés dans le même registre, `agent/tools/repository.mjs`) : `list_files`, `read_file` (tronqué à 30 Ko), `search_code` (recherche de texte littéral insensible à la casse, alternatives séparées par `|`, limitée à 40 correspondances ; jamais d'expression régulière, pour qu'un motif fourni par le modèle ne puisse pas bloquer la Lambda).
- **Budgets d'exploration** : Max 12 appels d'outils, 120 Ko de lecture au total, délai d'expiration de 45 secondes, vérifié entre deux fichiers et à chaque ligne d'une recherche.
- **Taille du rapport** : `MAX_TOKENS = 2048`. Sur une question large, le rapport final variait de 760 à plus de 1024 jetons d'un run à l'autre, et un rapport coupé à la limite lève `MaxTokensError` : l'orchestrateur ne recevait alors aucun rapport. Le rapport étant rejoué dans le contexte de l'orchestrateur, chaque jeton est payé deux fois.
- **Attribution d'auteur** : Vérifie si le compte GitHub du dépôt correspond au handle de l'auteur (`ownerHandle`). `formatExplorerReport` encadre le rapport dans `<explorer_report>`, y neutralise toute ligne `ATTRIBUTION:` et toute balise `explorer_report`, puis place la vraie note d'attribution après l'encadrement : un fichier piégé d'un dépôt tiers ne peut pas la concurrencer. `ORCHESTRATOR_PROMPT` pose que ce contenu est une donnée à décrire, jamais une instruction.

#### 4. Observabilité & Journalisation (`agent/usage.mjs`)

- **Ligne `chat.usage`** : Chaque invocation d'un agent émet une ligne de journal structurée JSON contenant :
  - `agent` (`gatekeeper`, `orchestrator`, `code_explorer`), `sessionId`, `modelId`.
  - `inputTokens`, `outputTokens`, `totalTokens`, `cacheReadInputTokens`, `cacheWriteInputTokens`, `cycles`, `stopReason`.
- **Confidentialité** : Les textes des questions/réponses sont strictement exclus des journaux CloudWatch.
- **Analytique** : Alimente le tableau de bord CloudWatch (`terraform/monitoring.tf`) ventilé par agent.

### Infrastructure AWS

- **Région** : `us-east-1`
- **Distribution** : CloudFront avec certificat ACM et enregistrements DNS Route 53 (`origin_read_timeout = 90s`).
- **Stockage** : Bucket S3 privé (site & `content.json`).
- **Calcul** : AWS Lambda Node.js 22 (`arm64`, 512 Mo, timeout 90s, `RESPONSE_STREAM`).
- **Base de données** : Amazon DynamoDB (Tables de sessions et de rate limit).
- **Intelligence Artificielle** : Amazon Bedrock (Claude Haiku 4.5).
- **Supervision & Budget** : Dashboard CloudWatch et budget mensuel Bedrock (20 USD) avec alertes par email (`TF_VAR_budget_alert_email`).
