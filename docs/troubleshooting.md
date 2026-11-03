# Troubleshooting

Find the symptom, read the likely cause, apply the fix. Logs are the first place to look:
`aws logs tail /aws/lambda/receipt-scanner-dev-processor --follow` (and `...-api`). See [monitoring.md](monitoring.md).

## Using the website

| Symptom | Likely cause | Fix |
|---|---|---|
| Sign-in says "Incorrect username or password" for a correct password | the user was created with a temporary password and is in state `FORCE_CHANGE_PASSWORD` | run `admin-set-user-password ... --permanent` (setup guide, section 6). Cognito deliberately gives the same error for a wrong e-mail and a wrong password |
| After a while every request answers 401 | the ID token expired (60 minutes) and refresh failed or the session was revoked | sign out and in again |
| Every request answers 401 right after sign-in | the site sends the wrong token, or the user pool or client id in `config.json` is from another environment | open `<site_url>/config.json` and compare with `terraform output user_pool_id` and `user_pool_client_id`; redeploy |
| Upload fails in the browser with a CORS error, `curl` works | the page's origin is not in `allowed_origins` (S3 bucket CORS and API CORS use the same list) | the origin must match exactly, including `https://` and no trailing slash. Local development needs `http://localhost:5173` in `dev_origins`; production has `dev_origins = []` |
| Upload is accepted but the receipt stays `processing` | the processor did not run or crashed | processor log. No log lines at all: the S3 trigger is missing (`terraform apply` again; the notification is on prefix `uploads/`) |
| Receipt shows `failed`: "Gemini rate limit reached, try again later" | Gemini free quota (per minute or per day) is used up | wait and upload again. The `gemini-errors` alarm counts these |
| Receipt shows `failed`: "Gemini error 404 (model ...)" | the model name in `gemini_model` does not exist for your key | `python src/gemini_test.py list`, fix `terraform/envs/*.tfvars`, deploy |
| Receipt shows `failed`: "Gemini error 400/403" | wrong or revoked API key, or the key has no access to the model | put a valid key into SSM (`--overwrite`); a warm Lambda keeps the old key until it is replaced, so redeploy or wait |
| Receipt shows `failed`: "Could not read a total amount from this photo" | blurry photo, not a receipt, or a photo cut off | retake the photo. The failed receipt can be deleted |
| Receipt shows `failed`: "The file is larger than 7 MB" | limit of the processor | the site compresses photos; for a PDF export a smaller file |
| The receipt list is empty although receipts exist | you are signed in as another user (receipts are private per user), or the currency switch hides them | check the user; switch the currency |
| Photo of a receipt does not open | the temporary link (5 minutes) expired | close and open the receipt again |
| New deploy not visible | browser cache | `index.html` and `config.json` are `no-cache`; hard-reload (Ctrl+F5). Hashed files in `assets/` change name on every build |

## Deployment and Terraform

| Symptom | Likely cause | Fix |
|---|---|---|
| `check "website_is_built"` warning, empty website | `frontend/dist` is missing | run `npm run build` (or use `deploy.ps1`, which does it) and apply again |
| `npm ci` fails with an engine error | Node is too old | Node 20.19+ or 22.12+ |
| `Error: no valid credential sources` | AWS credentials not configured | `aws configure` or `aws sso login`; check `aws sts get-caller-identity` |
| `parameter ... not found` in the processor log | the Gemini key was never stored for this environment | `aws ssm put-parameter --name /receipt-scanner/<env>/gemini-api-key --type SecureString --value ...` |
| `BucketAlreadyExists` | bucket names are global; the name includes your account id, so this means a bucket from a previous deployment still exists | delete the old bucket or use another `project_name` |
| `Error acquiring the state lock` | another apply is running, or a previous one was interrupted | wait. If sure nothing is running: `terraform force-unlock <LOCK_ID>` (the id is in the message); with the native lock file you can also delete the `*.tflock` object in the state bucket |
| `Backend initialization required` or "state not found" after enabling remote state | the backend was not initialized with this environment's key | `terraform init -reconfigure -backend-config=backend.hcl -backend-config="key=<env>/terraform.tfstate"` (the deploy script does this) |
| Remote state looks empty after `-migrate-state` | the key differs from the one used before | list the bucket (`aws s3 ls s3://<bucket>/ --recursive`), reuse the same key |
| `The argument "environment" is required` | no tfvars given | `terraform plan -var-file=envs/dev.tfvars` |
| Plan wants to replace the API Lambda or add a VPC to an existing deployment | expected the first time `enable_vpc` is true | the Lambda is updated in place (network interfaces are added); the plan is safe to apply |
| API Lambda times out after the VPC change (calls to AWS hang) | the Lambda calls a service that has no endpoint in the VPC (it has only S3 and DynamoDB) | add an interface endpoint for that service, or set `enable_vpc = false`. Do not add a NAT gateway if you want to stay free |
| `terraform destroy` stops on a subnet or security group | Lambda network interfaces are still being released | wait 10 to 30 minutes and run `destroy` again |
| `terraform destroy` cannot delete the user pool in prod | deletion protection is on | set the pool's `deletion_protection` to `INACTIVE`, apply, then destroy |
| `terraform fmt -check` fails in CI | files were not formatted | `terraform fmt -recursive` inside `terraform/` and commit |
| `pip`/tests: `ModuleNotFoundError: boto3` | boto3 is not installed | not needed: the tests install stand-ins automatically. For pytest run `pip install -r requirements-dev.txt` |

## Monitoring

| Symptom | Likely cause | Fix |
|---|---|---|
| No alarm e-mails | the SNS subscription is not confirmed, or `alert_email` was empty at apply time | click the confirmation link in the AWS mail (check spam); set `$env:TF_VAR_alert_email` and apply again |
| No budget e-mails | `alert_email` empty (no budget is created) | set it and apply |
| Dashboard graphs are empty | no traffic yet, or the period is too short | generate requests; widen the time range |
| `api-gateway-5xx` stays in `INSUFFICIENT_DATA` | no requests yet (the alarm treats missing data as fine) | normal until the first 5xx or request |

## Quick health check

```powershell
cd terraform
$API = terraform output -raw api_url
curl "$API/receipts"                       # expect {"message":"Unauthorized"}  (the route exists and is protected)
aws lambda get-function --function-name receipt-scanner-dev-processor --query "Configuration.State"        # Active
aws lambda get-function --function-name receipt-scanner-dev-api --query "Configuration.VpcConfig.SubnetIds"  # two subnets
aws dynamodb describe-table --table-name receipt-scanner-dev-receipts --query "Table.TableStatus"           # ACTIVE
aws ssm get-parameter --name /receipt-scanner/dev/gemini-api-key --query "Parameter.Type"                   # SecureString
```
