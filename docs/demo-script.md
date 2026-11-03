# Demonstration script (10 minutes)

Audience: the instructor and classmates. Goal: show a working, deployed, secure and monitored AI application, and show
that you understand why it is built this way.

## Before you start (15 minutes earlier)

- [ ] The environment is deployed: `terraform output site_url` opens, you are signed out.
- [ ] Two users exist (`you@...` and a second one for the isolation demo), passwords written on a note, not on screen.
- [ ] 3 sample receipts ready in a folder: one clear photo with product lines, one PDF, one **bad** photo (blurred or not a receipt). Use test receipts, not private ones.
- [ ] An older receipt of the same shop already uploaded, so the price comparison has something to show.
- [ ] Gemini quota is fresh (do not rehearse 20 uploads right before).
- [ ] Browser tabs open: the site, CloudWatch dashboard, the architecture diagram (`docs/architecture.md` rendered on GitHub), a terminal in `terraform/`, the GitHub repository.
- [ ] A 60-second screen recording of the full upload flow as a backup (Wi-Fi, AWS or Gemini can fail).
- [ ] The alarm e-mail subscription is confirmed (the "alarm mail" moment is a nice finish).

## Timeline

| Time | Part | What you say and do |
|---|---|---|
| 0:00-1:00 | **Problem and idea** | "People keep paper and PDF receipts and never learn where the money goes or that the same milk got 20 percent more expensive." A photo goes in, structured data comes out, and the dashboard answers: how much did I spend, on what, and which products got more expensive. Gemini only *reads* the receipt; the analysis is arithmetic, so the numbers are reliable. |
| 1:00-3:30 | **Architecture walkthrough** | Show the diagram. Follow one upload: browser → Cognito → API Gateway (token checked) → Lambda creates the row and a presigned URL → browser uploads straight to S3 → S3 event → processor Lambda → Gemini → DynamoDB. Name the services: 12 AWS services plus Gemini, 4 are required. Point out the VPC (API Lambda private, no NAT, gateway endpoints) and say *why the processor is outside*: it needs the internet and NAT costs about 30 USD a month. |
| 3:30-7:00 | **Live demo** | See the next section. |
| 7:00-8:30 | **Infrastructure as code and operations** | In the terminal: `tree terraform` (modules, envs, bootstrap). `terraform plan -var-file=envs/prod.tfvars` shows what differs in prod. Say: remote state in versioned S3 with a lock, one key per environment, deploy script refuses prod with local state. Open the CloudWatch dashboard (requests, latency, Gemini errors), show the alarm list, trigger `set-alarm-state` and show the e-mail. Mention the budget alarm and that the monthly cost is about 0 USD (see `docs/cost-analysis.md`). |
| 8:30-9:00 | **Quality** | 83 unit tests, CI runs tests, `terraform validate` and the frontend build on every push. |
| 9:00-10:00 | **Summary and limits** | What works, what you would add next (WAF, custom domain, on-demand DynamoDB, a dead-letter queue, per-user quotas). Then questions. |

## Live demo steps (3:30-7:00)

1. **Sign in** (`you@...`). Say: SRP, the password never leaves the browser.
2. **Upload the clear receipt.** The card appears as *processing*, becomes *done* in a few seconds. Open it: store, date, total, currency, category, product lines, the original photo.
3. **Price comparison.** Open the receipt of the shop you uploaded before: the banner and icons show which products got more expensive or cheaper. Open the **Products** tab: price history, biggest rise, cheapest store. "None of this is AI: the product key is computed in code, so the same product always matches itself."
4. **Dashboard.** Period switch, spending by category, budget bar, click a bar to see the receipts behind it. Set a budget for one category and show the bar react.
5. **Edit and PDF.** Correct a wrong value by hand (the receipt is marked *edited*). Upload the PDF: shop, date and total are read.
6. **Failure path.** Upload the bad photo: it ends as *failed* with a readable reason, and nothing crashes. "The processor never raises, otherwise S3 would retry and burn the AI quota."
7. **Security.**
   - In the terminal: `curl "$(terraform output -raw api_url)/receipts"` → `Unauthorized`.
   - Sign in as the second user: the list is empty; the first user's receipts are invisible. Say: other people's receipt ids answer 404, the same as missing ones, and writes carry a DynamoDB condition on the owner.
8. Switch the theme and the currency (one second each), then go on to infrastructure.

If something fails live: say what you expect to see, show the CloudWatch log line that explains it (that *is* the monitoring demo), and play the backup recording.

## Questions and short answers

**Architecture**

- *Why serverless?* Pay per use and free tier friendly, no servers to patch, scales to zero. The load is bursty (a few receipts a day).
- *Why is the processor outside the VPC but the API inside?* The API only needs S3 and DynamoDB, which have free gateway endpoints. The processor must call Gemini on the internet, which would need a NAT gateway (about 30 USD per month). Its protection is a least-privilege IAM role instead.
- *Why does the browser upload straight to S3?* The image never passes through API Gateway or Lambda: no payload limit, lower cost, faster. The presigned URL is valid 5 minutes and tied to one key and content type.
- *Why an event-driven design?* The AI call takes seconds and can fail. S3 triggers the processor, the upload returns at once, the page polls. A slow AI never blocks the user.
- *Why DynamoDB and not a SQL database?* Access is by user and time; one index covers it. It is serverless and its capacity (11 + 11 units) is inside the always-free tier. RDS would cost money.
- *Why HTTP API and not REST API?* Cheaper, simpler, has the JWT authorizer. We do not need usage plans or WAF integration.

**Security**

- *How do you stop user A from seeing user B's receipts?* The user id comes from the verified token only. Every lookup checks `userId`, foreign receipts answer 404, and writes carry a DynamoDB condition, so the check exists in code and in the database. The list uses an index keyed by the user.
- *Where is the Gemini key?* In SSM Parameter Store as SecureString, created from the CLI, so it is not in Git, not in Terraform code and not in the state.
- *What if someone floods the API?* No valid token means no Lambda invocation; with a token, throttling is 5 requests per second.
- *What about privacy of the receipts?* Images are sent to Gemini. On the free tier Google may use content to improve its products, so use test data; a paid tier or a different provider is the production answer.
- *Is the data encrypted?* In transit with HTTPS everywhere; at rest by AWS defaults (S3, DynamoDB). A customer-managed KMS key is the next step.

**Reliability and scaling**

- *What if Gemini is down or the quota is gone?* The receipt is saved as `failed` with a clear reason, an alarm fires, the user can upload again. Nothing else stops working.
- *What happens with 100 users?* Lambda, API Gateway and S3 scale automatically. The first limits are the 5 requests per second throttle (a variable), the DynamoDB provisioned units (switch to on-demand) and the Gemini quota.
- *What if the same S3 event arrives twice?* The processor skips receipts that are already `done` or deleted and writes only if the row still exists.

**Infrastructure and operations**

- *How is state managed?* Remote state in a versioned, encrypted S3 bucket with a native lock file, one key per environment. The bucket is created by a small `bootstrap` configuration.
- *How do dev and prod differ?* `envs/dev.tfvars` vs `envs/prod.tfvars`: no local origins, no simple password flow, Cognito deletion protection, own SSM key. The code is the same.
- *How do you deploy?* One script: build the site, `terraform apply`. Terraform also uploads the site files and writes `config.json`, so no URL is copied by hand.
- *How do you know it is healthy?* CloudWatch dashboard and five alarms, e-mail through SNS, the budget alarm, and a `failed` status shown to the user.
- *How much does it cost?* About 0 USD within the free tier; roughly 10 USD per month if the free allowances were gone (mostly DynamoDB capacity and alarms). Details in `docs/cost-analysis.md`.
- *How is it tested?* 83 unit tests with mocks (ownership rules, validation, the AI answer checks, error paths) and CI. The end-to-end check is the live demo.

**Honest limitations (say them before they are asked)**

- No WAF and no custom domain (cost); single region; the processor is not in the VPC (explained above).
- `force_destroy` on the buckets is for a student project; remove it for real data.
- The product matching is normalization, not understanding: a new spelling of a product starts a new price history.
