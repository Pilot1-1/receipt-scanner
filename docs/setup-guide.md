# Setup guide

How to deploy receipt-scanner from nothing to a working website. Commands are PowerShell (Windows); on Linux or macOS
use `./scripts/deploy.sh` and the same `aws` and `terraform` commands.

## 1. Prerequisites

| Tool | Version | Check |
|---|---|---|
| AWS account and an IAM user or SSO profile that may create Lambda, API Gateway, DynamoDB, S3, CloudFront, Cognito, IAM roles, VPC, CloudWatch, SNS, SSM, Budgets | | `aws sts get-caller-identity` |
| AWS CLI | 2.x | `aws --version` |
| Terraform | 1.10+ (1.5+ is enough if you keep the state in a local file) | `terraform version` |
| Node.js | 20.19+ or 22.12+ | `node --version` |
| Python | 3.12 (only to run the tests; the standard library is enough) | `python --version` |
| A Gemini API key | free, from [Google AI Studio](https://aistudio.google.com/) | |

Pick a region close to you; the default is `eu-north-1` (`terraform/variables.tf`). Everything below uses it.

## 2. Get the code

```powershell
git clone https://github.com/Pilot1-1/receipt-scanner.git
cd receipt-scanner
```

## 3. Store the Gemini key (once per environment)

The key lives in SSM Parameter Store and never appears in Terraform code or state:

```powershell
aws ssm put-parameter --name /receipt-scanner/dev/gemini-api-key --type SecureString --value "YOUR_KEY" --region eu-north-1
```

For prod use `/receipt-scanner/prod/gemini-api-key`.

Optional but recommended: check that the model you configured exists for your key and that it reads a receipt
(`src/gemini_test.py`, described in its header). The model name is `gemini_model` in `terraform/envs/*.tfvars`.

## 4. Remote state (recommended, once per AWS account)

By default Terraform keeps its state in a local file. Remote state is safer (versioned, encrypted, locked) and is
required to deploy more than one environment. Skip this section for a quick first try.

```powershell
cd terraform\bootstrap
terraform init
terraform apply                      # creates the S3 state bucket
terraform output -raw backend_config | Out-File -Encoding ascii ..\backend.hcl
cd ..
copy backend.tf.example backend.tf
terraform init -migrate-state -backend-config="backend.hcl" -backend-config="key=dev/terraform.tfstate"
```

`Out-File -Encoding ascii` matters: the default PowerShell redirection writes UTF-16, which Terraform cannot read.
`-migrate-state` copies an existing local state into the bucket. From now on `deploy.ps1` initializes the backend
itself, with the key of the environment you deploy.

## 5. Deploy

Optional: get alarm and budget e-mails (set this in the same window, before deploying):

```powershell
$env:TF_VAR_alert_email = "you@example.com"
```

```powershell
.\scripts\deploy.ps1            # dev
```

The script runs `npm ci` and `npm run build`, then `terraform init` and `terraform apply`. Terraform shows the plan
and asks for confirmation. The first apply takes 5 to 10 minutes (CloudFront). At the end it prints the site URL:

```
Website: https://dxxxxxxxxxxxxx.cloudfront.net
```

Useful outputs any time: `terraform output` (inside `terraform/`): `site_url`, `api_url`, `user_pool_id`,
`dashboard_name`, `alerts_topic_arn`, `vpc_id`.

If you set `alert_email`, AWS sends a **confirmation e-mail** from SNS; click the link, otherwise no alarm mail is
delivered. Budget warnings go to the same address and do not need confirmation.

## 6. Create a user and sign in

Self sign-up is off, so create an account yourself:

```powershell
cd terraform
$POOL = terraform output -raw user_pool_id
aws cognito-idp admin-create-user --user-pool-id $POOL --username you@example.com `
  --user-attributes Name=email,Value=you@example.com Name=email_verified,Value=true --message-action SUPPRESS
aws cognito-idp admin-set-user-password --user-pool-id $POOL --username you@example.com `
  --password "Str0ngPassw0rd" --permanent
```

Open `site_url`, sign in with the e-mail and password (10+ characters, upper and lower case, a digit), upload a receipt
photo. The card shows "processing" for a few seconds and then the data.

## 7. Check that everything works

| Check | How | Expected |
|---|---|---|
| API is protected | `curl <api_url>/receipts` | `401 Unauthorized` |
| Upload and AI | upload a receipt in the site | status becomes `done` within ~10 s, store and total are filled |
| Isolation | create a second user and sign in | the second user sees none of the first user's receipts |
| Monitoring | CloudWatch, Dashboards, `terraform output -raw dashboard_name` | graphs show your requests |
| Alarm mail | `aws cloudwatch set-alarm-state --alarm-name receipt-scanner-dev-api-lambda-errors --state-value ALARM --state-reason test` | e-mail arrives (state returns to OK by itself) |

## 8. Run the tests

```powershell
python -m unittest discover -s tests -v       # no installation needed
pip install -r requirements-dev.txt; python -m pytest tests   # same tests with pytest
```

The tests use mocks, so they need no AWS account, no key and no network. CI (`.github/workflows/ci.yml`) runs them on
every push, together with `terraform fmt`/`validate` and the frontend build.

Before the first push run `terraform fmt -recursive` inside `terraform/` once, so the formatting check passes.

## 9. Run the website locally (optional)

```powershell
cd terraform
terraform output -json frontend_config | Out-File -Encoding ascii ..\frontend\public\config.json
cd ..\frontend
npm install
npm run dev        # http://localhost:5173
```

`localhost:5173` is allowed by CORS through `dev_origins` (empty in prod).

## 10. Deploy production

```powershell
aws ssm put-parameter --name /receipt-scanner/prod/gemini-api-key --type SecureString --value "YOUR_KEY" --region eu-north-1
$env:TF_VAR_alert_email = "you@example.com"
.\scripts\deploy.ps1 -Env prod
```

`prod.tfvars` turns off the simple password flow (`allow_password_auth = false`), removes the local dev origin and
enables Cognito deletion protection. The script refuses to deploy prod without remote state (section 4), because dev
and prod would share one state file. Note that Cognito `admin-create-user` still works in prod, and the user pool
cannot be deleted by `terraform destroy` until deletion protection is switched off.

## 11. Update

Change code or variables and run the deploy script again; Terraform shows exactly what will change. Lambda code is
zipped from `src/api` and `src/processor` on every apply, the website from `frontend/dist`.

## 12. Tear down

```powershell
cd terraform
terraform init -backend-config="backend.hcl" -backend-config="key=dev/terraform.tfstate" -reconfigure   # only with remote state
terraform destroy -var-file="envs/dev.tfvars"
```

- Deleting the VPC can take 10 to 30 minutes: AWS releases the Lambda network interfaces slowly. If `destroy` reports a
  dependency on a subnet or security group, wait a few minutes and run it again.
- Prod cannot be destroyed while Cognito deletion protection is on.
- The state bucket in `terraform/bootstrap` has `prevent_destroy`; delete it by hand only when no environment is left.
- The SSM parameter with the Gemini key is not managed by Terraform: `aws ssm delete-parameter --name /receipt-scanner/dev/gemini-api-key`.

## Variables

| Variable | Default | Meaning |
|---|---|---|
| `environment` | none (set in `envs/*.tfvars`) | `dev` or `prod`; part of every resource name |
| `aws_region` | `eu-north-1` | |
| `gemini_model` | `gemini-2.5-flash-lite` (overridden in `envs/*.tfvars`) | model that reads receipts |
| `allow_self_signup` | `false` | anyone may register |
| `allow_password_auth` | `true` (`false` in prod) | extra Cognito flow for curl and CLI tests |
| `dev_origins` | `["http://localhost:5173"]` (`[]` in prod) | extra websites allowed by CORS |
| `enable_vpc` | `true` | run the API Lambda in the private VPC |
| `vpc_cidr` | `10.20.0.0/16` | |
| `alert_email` | empty | where alarms and budget warnings go; empty means none |
| `monthly_budget_usd` | `5` | budget that triggers a warning |
