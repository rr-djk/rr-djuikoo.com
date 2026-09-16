# Politique de sécurité

## Contrôles de sécurité en place

Le projet intègre plusieurs niveaux de vérification automatique et de durcissement :

### Analyses automatisées (CI/CD)

Le workflow `.github/workflows/security-scan.yml` s'exécute sur chaque pull request vers `main` :

- **Trivy** : analyse des dépendances déclarées de l'agent Lambda (`agent/package-lock.json`) et du site (`package-lock.json`), échec sur les sévérités `HIGH` et `CRITICAL`.
- **Semgrep** : analyse statique du code (SAST) avec les règles CI standard (`p/ci`).
- **Gitleaks** : détection de secrets et jetons d'accès dans l'historique et le code.
- **Checkov** : analyse de sécurité du code d'infrastructure Terraform (`terraform/`).

### Durcissement des workflows

- **Principe du moindre privilège** : `permissions: {}` défini par défaut à l'échelle des workflows.
- **Épinglage par SHA** : toutes les actions GitHub utilisent des commits SHA immuables.
- **Surveillance de l'exécuteur** : utilisation de `step-security/harden-runner` en mode audit.

### Déploiement et infrastructure

- **OIDC AWS** : aucun secret ni clé AWS à longue durée de vie stocké dans GitHub.
- **Attestation de provenance** : génération d'un manifeste SHA256 et vérification par GitHub Attestations avant déploiement.
- **Exposition S3 et Lambda** : le bucket S3 du site n'est pas public. La Lambda et le bucket S3 sont restreints par Origin Access Control (OAC) via CloudFront.

### Sécurité du Frontend et des Dépendances

- **Sanitization XSS dans le Chat** : Tout le contenu généré par l'assistant virtuel au format Markdown est passé au crible de `DOMPurify` avant insertion dans le DOM. Les balises à risque (ex: `<iframe>`, `<script>`, `<img>`) sont éliminées, et les liens sont contraints avec `rel="noopener noreferrer"`.
- **Liens limités aux domaines connus** : Une réponse de l'agent peut être orientée par du texte que le propriétaire ne contrôle pas, par exemple un fichier d'un dépôt public lu par le _Code Explorer_. Un lien ne reste donc cliquable que s'il pointe vers un domaine de `ALLOWED_LINK_HOSTS` (`site/js/main.js` : `github.com`, `www.linkedin.com`, `learn.microsoft.com`, `rr-djuikoo.com`) ou vers `mailto:`. Les autres perdent leur `href`, leur texte reste affiché. Ce contrôle ne dépend pas du modèle. Limite connue : un lien vers un autre compte sur `github.com` reste cliquable.
- **Content-Security-Policy** : Une CSP posée en `<meta>` dans `src/index.template.html` n'autorise que les scripts servis par le site, les feuilles de style du site et de Google Fonts, et les requêtes vers le même domaine. C'est la seconde ligne de défense derrière `DOMPurify` : un script injecté qui passerait la sanitization ne s'exécuterait pas. `frame-ancestors` n'étant pas supporté en `<meta>`, l'intégration en iframe reste bloquée par l'en-tête `X-Frame-Options` de la politique CloudFront gérée.
- **Garantie d'intégrité Vendor** : Les dépendances navigateur (`marked`, `DOMPurify`) sont déclarées dans `package.json` et synchronisées dans `site/js/vendor/` via `make vendor`. Trivy n'analysant que les manifestes et jamais les fichiers `.js` réellement servis, deux garde-fous complémentaires garantissent que les octets exécutés par le navigateur correspondent au lockfile audité : le hook pre-commit `vendor-deps` rejette les commits locaux qui dérivent, et une étape du workflow `security-scan.yml` rejette les pull requests et les push sur `main`, y compris ceux créés par API sans passer par pre-commit.

### Sécurité du Runtime Multi-Agent et du Code Explorer

- **Allowlist stricte de dépôts** : L'agent _Code Explorer_ résout l'URL du dépôt GitHub à télécharger exclusivement depuis le fichier `content.json` hébergé sur S3 (`resolveRepo`). Aucune instruction utilisateur ni aucun prompt du modèle ne peut forcer le système à télécharger un dépôt externe ou privé non répertorié.
- **Isolation et Sanitization des archives (`repo.mjs`)** :
  - **Exclusion des liens symboliques** : L'extraction `tar` rejette tous les symlinks (`entry.type === "File"` uniquement), neutralisant ainsi tout risque de traversée de répertoire par saut de lien symbolique.
  - **Filtrage des extensions et secrets** : Seuls les fichiers de code textuels (`CODE_EXTENSIONS`) et les fichiers de configuration autorisés (`CODE_FILENAMES`) sont extraits. Les binaires, exécutables et fichiers de secrets (`.env`) sont strictement ignorés (`.env.example` autorisé).
  - **Limites de taille et staging atomique** : Fichiers individuels plafonnés à 512 Ko. La taille de l'archive n'est pas plafonnée : GitHub la génère à la volée sans en-tête `content-length`, et le risque est borné par l'allowlist de dépôts, le cache par environnement d'exécution et le délai de téléchargement de 20 s. Extraction sous un répertoire de staging temporaire unique (`.partial-UUID`) sous `/tmp` pour éviter qu'une interruption ne laisse un dossier incomplet pris pour un cache valide, et pour isoler les exécutions locales simultanées.
- **Barrière de chemin sandbox (`inside(path)`)** : L'ensemble des outils d'exploration (`list_files`, `read_file`, `search_code`) valident la résolution lexicale du chemin demandé pour garantir qu'aucune lecture ne sorte du répertoire du dépôt sous `/tmp`.
- **Budgets et plafonds d'exécution** : L'exploration de code est restreinte par trois budgets simultanés (12 appels d'outils max, 120 Ko de texte lu max, 45 s de délai d'expiration max) pour empêcher tout épuisement de ressource ou de mémoire de la Lambda.
- **Recherche littérale, jamais d'expression régulière** : `search_code` cherche du texte brut insensible à la casse, `|` séparant des alternatives. Le motif venant du modèle, donc indirectement du visiteur, une expression régulière à retour arrière catastrophique comme `(a+)+$` bloquerait la Lambda jusqu'à son timeout de 90 s à l'intérieur d'un seul appel, là où aucun contrôle d'échéance ne peut s'exécuter. L'échéance de 45 s est vérifiée à chaque ligne.
- **Contenu de dépôt traité comme une donnée** :
  - Le rapport du _Code Explorer_ paraphrase des fichiers de dépôts publics, dont un appartenant à une organisation que le propriétaire ne contrôle pas. `formatExplorerReport` (`agent/orchestrator/orchestrator.mjs`) neutralise dans ce rapport toute ligne `ATTRIBUTION:` et toute balise `explorer_report`, l'encadre dans `<explorer_report>`, et place la vraie attribution, calculée depuis `content.json`, après l'encadrement. Un fichier piégé ne peut plus concurrencer l'attribution réelle.
  - `ORCHESTRATOR_PROMPT` pose que le contenu encadré et tout résultat d'outil sont des données à décrire, jamais des instructions, et que les instructions ne doivent pas être révélées. Ce garde-fou repose sur le modèle : il réduit le risque d'injection sans le supprimer. Le filtre de liens du frontend couvre l'effet le plus dommageable indépendamment du modèle.

### Point d'entrée `/api/chat` (`agent/index.mjs`)

- **Adresse IP non falsifiable** : La limite de débit (20 requêtes par tranche de 10 minutes) identifie le visiteur par `cloudfront-viewer-address`, écrit par CloudFront, et non par le premier élément de `X-Forwarded-For`, que le client écrit lui-même. L'adresse est coupée au dernier `:` pour retirer le port sans tronquer une IPv6. À défaut, le dernier élément de `X-Forwarded-For`, ajouté par CloudFront, est utilisé.
- **Fenêtre de débit dans la clé** : Le numéro de la tranche de 10 minutes fait partie de la clé DynamoDB. Le compteur repart à zéro à chaque tranche sans dépendre du TTL, dont la suppression peut prendre plusieurs jours.
- **Identifiant de session validé** : `sessionId` doit être un UUID v4, la forme que génère le navigateur. Toute autre valeur, absente comprise, est refusée avec `INVALID_SESSION` avant tout appel Bedrock : un identifiant devinable permettrait de reprendre la conversation d'un autre visiteur.
- **Erreurs internes génériques** : Une erreur inattendue est renvoyée au visiteur sous la forme `INTERNAL_ERROR`, sans détail. Les erreurs des SDK AWS contiennent l'ARN du rôle, le numéro de compte ou le nom des tables : le détail n'est écrit que dans CloudWatch.
- **Filtrage de périmètre et Confidentialité des Journaux** :
  - Le _Gatekeeper_ évalue chaque message de façon isolée (sans historique) pour refuser les questions hors-sujet avant tout chargement de session, fermant ainsi la contournement par étapes multi-tours. Conçu selon un principe _fail-open_, en cas d'erreur du screener, il laisse passer le message vers l'Orchestrateur.
  - Les métriques de consommation émettent des journaux d'usage (`chat.usage`) contenant uniquement des compteurs de tokens, les noms d'agents et le `sessionId`. **Aucun texte de conversation (saisie utilisateur ou réponse agent) n'est consigné dans les logs CloudWatch**. La rétention des logs est fixée à 60 jours.

## Exceptions de sécurité

Les exceptions d'analyse Checkov pour l'infrastructure Terraform (par exemple le mode mono-région ou le ciblage des journaux) sont documentées et justifiées dans le fichier `.checkov.yml` à la racine du dépôt.
