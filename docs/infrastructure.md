# Infrastructure as Code et Terraform

Ce document regroupe la description de l'infrastructure AWS, les règles d'organisation Terraform et les spécificités techniques à connaître.

## Structure des fichiers Terraform

Le code d'infrastructure est situé dans le dossier `terraform/` :

- `versions.tf` : fixe la version de Terraform à `1.15.8` et les fournisseurs (`aws` 6.62.0, `archive` 2.8.0).
- `backend.tf` : configure le backend S3 à la racine (`rr-djuikoo-tf-state` dans la région `us-east-1` avec `use_lockfile = true` et chiffrement).
- `bootstrap/` : stack isolée permettant de provisionner initialement le bucket de state S3.
- `s3.tf` : bucket S3 du site (`rr-djuikoo-site`).
- `cloudfront.tf` : distribution CloudFront, contrôles OAC et politique de bucket fusionnée.
- `lambda.tf` : fonction Lambda `rr-djuikoo-chat`, URL de fonction et packaging.
- `dynamodb.tf` : tables DynamoDB pour les sessions et le contrôle du débit.
- `iam.tf` : rôles et politiques IAM pour la Lambda et les accès Bedrock.
- `acm.tf` et `route53.tf` : gestion du certificat TLS et des enregistrements DNS.

## Spécificités d'implémentation et points d'attention

### 1. Gestion des dépendances de la Lambda (`agent.zip`)

Le runtime AWS Lambda `nodejs22.x` ne contient pas les paquets `@strands-agents/sdk` ou `zod`. Les dépendances sous `node_modules` doivent obligatoirement être incluses dans le fichier `agent.zip`.

Afin de prévenir tout déploiement d'une archive incomplète, Terraform intègre une `precondition` dans `lambda.tf`. Celle-ci compare l'empreinte du fichier `agent/node_modules/.deps-stamp` avec le hachage SHA-256 de `agent/package-lock.json`. Le plan Terraform échoue automatiquement si les dépendances ne sont pas installées ou ne sont pas à jour.

### 2. Maîtrise des coûts et concurrence Lambda

Pour éviter une surconsommation imprévue des API Amazon Bedrock, la fonction Lambda applique `reserved_concurrent_executions = 10`. La mémoire est fixée à `512 MB` et le délai d'expiration à 30 secondes.

### 3. Exigence de l'en-tête `X-Amz-Content-Sha256`

L'URL de fonction Lambda en mode d'authentification `AWS_IAM` exige la présence de l'en-tête HTTP `X-Amz-Content-Sha256` contenant le hachage SHA-256 du corps de la requête. Le client frontend (`site/js/main.js`) calcule et transmet cet en-tête à chaque appel.

### 4. Permissions d'invocation de la Lambda

L'accès à la Lambda via CloudFront nécessite deux ressources `aws_lambda_permission` distinctes :

- `lambda:InvokeFunctionUrl` pour l'appel de l'URL de fonction.
- `lambda:InvokeFunction` pour l'invocation directe.

Ces deux autorisations restreignent la source à l'ARN de la distribution CloudFront (`SourceArn`).

### 5. Gestion des en-têtes HTTP sur CloudFront (`/api/*`)

Le comportement ordonné `/api/*` dans CloudFront utilise une politique d'origine personnalisée. Il applique la politique d'en-têtes `AllViewerExceptHostHeader`.

Si l'en-tête `Host` du client d'origine était transmis, la signature SigV4 calculée par l'Origin Access Control (OAC) de CloudFront serait invalide, provoquant une erreur 403.

### 6. Politique de bucket S3 unique

AWS S3 autorise une seule ressource `aws_s3_bucket_policy` par bucket. La politique `site_combined` (dans `cloudfront.tf`) rassemble les règles suivantes :

- Refus de tout transport non sécurisé (`DenyInsecureTransport`).
- Autorisation d'accès exclusif par CloudFront via OAC (`AllowCloudFrontOAC`).

### 7. Autorisations IAM pour Amazon Bedrock

L'accès au modèle Anthropic Claude Haiku 4.5 (`global.anthropic.claude-haiku-4-5-20251001-v1:0`) s'appuie sur trois déclarations IAM distinctes :

- Autorisation sur l'ARN du profil d'inférence global incluant l'identifiant du compte.
- Autorisation sur le modèle de base régional.
- Autorisation sur le modèle de base global.
