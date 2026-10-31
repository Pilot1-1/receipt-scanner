# receipt-scanner

Upload a photo of a receipt, Gemini reads it (store, date, total, currency, category, product lines),
and a dashboard shows where the money goes and how prices change. Everything is created by Terraform.

```
Browser ──► CloudFront ──► S3 (site)           React app built with Vite
   │
   ├──► Cognito                                sign in (SRP) → ID token
   ├──► API Gateway ──► Lambda (api)           JWT checked by API Gateway
   │                      │                    POST /upload-url, GET /receipts
   │                      │                    GET /receipts/{id}/image, PATCH|DELETE /receipts/{id}
   │                      └──► DynamoDB        GET|PUT /budgets (budgets table)
   └──► S3 (receipts)   PUT photo via presigned URL, GET photo via presigned URL
              │ ObjectCreated
              ▼
        Lambda (processor) ──► Gemini ──► DynamoDB (receipts)
```

## What the website does

- **Overview**: opens on "this month". The period can be switched to the last 30 days, 6 or 12 months, all time or a
  custom range (two date fields appear only for that choice). Cards (spent in the period and the change against the
  period before it, top store, biggest receipt, average per day), a budget bar for the month (spent against the sum of
  the limits, with a tick for where an even spend would be today), a bar chart that follows the period (per day, month
  or year), spending by category, monthly budgets per category.
  Click a bar of the chart to list the receipts behind it and search them by store or product.
- **Currency**: the switch next to the tabs applies to every tab. Lists, totals, the chart, budgets and products show
  one currency at a time. Receipts that are still being read, or could not be read, have no currency yet and appear in all of them.
- **Receipts**: search by store or product, filter by category and status, sort, export the shown list to CSV.
  Click a receipt to see its products and price changes, look at the original photo, correct the data, or delete it.
- **Products**: every product you bought, its price history, the biggest rise and drop, the cheapest store.

## API

Every route needs a Cognito token (`Authorization: Bearer <id token>`). A receipt of another user answers 404.

| Route | Purpose |
|---|---|
| `POST /upload-url` | Creates the receipt row and a one-time upload link |
| `GET /receipts` | The user's receipts, newest first |
| `GET /receipts/{id}/image` | Temporary (5 min) link to the original photo |
| `PATCH /receipts/{id}` | Correct `store`, `date`, `total`, `currency`, `category`. Only receipts that were read; marks `edited: true` |
| `DELETE /receipts/{id}` | Deletes the row and the photo |
| `GET /budgets` | `{ "EUR": { "food": 200 } }` |
| `PUT /budgets` | `{ "currency": "EUR", "limits": { "food": 200, "bills": null } }` (`null` or `0` removes a limit) |

## Deploy

Needs Node 20.19+ (or 22.12+), Terraform 1.5+, and AWS credentials.

```powershell
# once: the Gemini key lives in SSM, never in Terraform state
aws ssm put-parameter --name /receipt-scanner/dev/gemini-api-key --type SecureString --value "YOUR_KEY"

.\scripts\deploy.ps1          # builds the site, then runs terraform apply
```

The first apply takes several minutes (CloudFront). It prints `site_url`.
The site needs `frontend/dist`, so always build before `terraform apply`; the script does both.

When updating an existing deployment, `terraform apply` shows one new DynamoDB table (`budgets`),
five new API routes and changed Lambda code and IAM policies. The only deletions are the old site build files
(`assets/index-<hash>.js` and `.css`), which the new build replaces.

## Currency of receipts

Every receipt keeps the currency Gemini read from it (RUB, TRY, KZT, ...). Amounts in different currencies are never
added together: the Overview has a switch per currency, and monthly budgets are stored per currency.

If a receipt was read with the wrong currency, fix it on the website (open the receipt, Edit). To correct many
receipts at once, for example everything that was wrongly read as RUB, use the script. Run the preview first:
receipts that really are in that currency must stay as they are.

```powershell
cd terraform
$TABLE = terraform output -raw receipts_table
cd ..
python scripts/fix_currency.py --table $TABLE --from RUB --to KZT           # preview only
python scripts/fix_currency.py --table $TABLE --from RUB --to KZT --apply   # change them
```

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
  Photos are shown through short-lived presigned GET links; the bucket itself stays private.
- API Gateway allows `PATCH`, `PUT` and `DELETE` in its CORS settings; without them the browser blocks
  those calls before they reach the API.
- Ownership is checked in the Lambda (the `sub` of the verified token against the row's `userId`), and again
  inside DynamoDB with a condition expression on every write.
- If a receipt is deleted while Gemini is still reading it, the processor drops the result instead of
  recreating the row.
- Hashed files in `assets/` are cached for a year; `index.html` and `config.json` are `no-cache`,
  so a deploy is visible immediately without a CloudFront invalidation.
