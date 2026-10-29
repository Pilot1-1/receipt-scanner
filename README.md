# receipt-scanner

Upload a photo of a receipt, Gemini reads it (store, date, total, currency, category),
and a dashboard shows where the money goes. Everything is created by Terraform.

```
Browser ──► CloudFront ──► S3 (site)           React app built with Vite
   │
   ├──► Cognito                                sign in (SRP) → ID token
   ├──► API Gateway ──► Lambda (api)           POST /upload-url, GET /receipts
   │                                           (JWT checked by API Gateway)
   └──► S3 (receipts)   PUT photo via presigned URL
              │ ObjectCreated
              ▼
        Lambda (processor) ──► Gemini ──► DynamoDB
```

## Deploy

Needs Node 20.19+ (or 22.12+), Terraform 1.5+, and AWS credentials.

```powershell
# once: the Gemini key lives in SSM, never in Terraform state
aws ssm put-parameter --name /receipt-scanner/dev/gemini-api-key --type SecureString --value "YOUR_KEY"

.\scripts\deploy.ps1          # builds the site, then runs terraform apply
```

The first apply takes several minutes (CloudFront). It prints `site_url`.
The site needs `frontend/dist`, so always build before `terraform apply`; the script does both.

## Create a user

Self sign-up is off by default (`allow_self_signup = false`). Create an account yourself:

```powershell
cd terraform
$POOL = terraform output -raw user_pool_id
aws cognito-idp admin-create-user --user-pool-id $POOL --username you@example.com `
  --user-attributes Name=email,Value=you@example.com Name=email_verified,Value=true --message-action SUPPRESS
aws cognito-idp admin-set-user-password --user-pool-id $POOL --username you@example.com `
  --password "Str0ngPassw0rd" --permanent
```

Sign in with the e-mail address. Passwords need 10+ characters with upper case, lower case and a digit.

## Run the site locally

```powershell
cd terraform
terraform output -json frontend_config | Out-File -Encoding ascii ..\frontend\public\config.json
cd ..\frontend
npm install
npm run dev        # http://localhost:5173
```

`localhost:5173` is allowed by CORS through `dev_origins` (set it to `[]` in prod).

## How the pieces fit

- `config.json` is written by Terraform next to `index.html`, so the same build works in every
  environment and no URL is copied by hand.
- The browser uploads photos straight to S3, so the receipts bucket has a CORS rule for the site.
- Hashed files in `assets/` are cached for a year; `index.html` and `config.json` are `no-cache`,
  so a deploy is visible immediately without a CloudFront invalidation.
