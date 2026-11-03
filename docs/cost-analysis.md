# Cost analysis and optimization

Goal of the assignment: run inside the free tier. This document shows the expected usage, what each service would cost
if the free allowance were not there, which design choices keep the bill at zero, and what would break it.

Prices below are approximate AWS list prices (US regions) and the free allowances are the ones AWS publishes; both
change. Check the **Billing → Free Tier** page of your account and the
[AWS Pricing Calculator](https://calculator.aws/) before relying on them.

## 1. Which free tier applies to your account

AWS changed the model in July 2025. An account opened **before 15 July 2025** has the classic free tier (always-free
services plus 12-month offers). An account opened **since then** chooses a *Free plan*: 100 USD of credits (up to 100
USD more for completing onboarding tasks such as creating a budget), valid for at most 6 months. When the credits or the
6 months run out, AWS closes the account unless you upgrade, and keeps the data for 90 days. The Free plan covers a
subset of services, and joining AWS Organizations upgrades the account to Paid for good. Look at which plan your account
is on before the demo and make sure the project does not outlive it unnoticed.

## 2. Assumed usage (typical for a course project and demo)

| Quantity | Assumption |
|---|---|
| Users | 1 to 5 |
| Receipts uploaded | 300 per month (about 1 MB each) |
| API calls | 10,000 per month (the page polls while a receipt is processing) |
| Website visits | 2,000 page loads per month |
| Gemini requests | 300 per month (one per receipt, plus rare retries) |

## 3. Cost per service

| Service | Free allowance (published) | Expected use | Cost without any free tier | With free tier |
|---|---|---|---|---|
| Lambda (2 functions) | 1 M requests and 400,000 GB-s per month, always free | ~10,300 invocations; processor ~10 s at 256 MB is about 750 GB-s in total | well under 1 USD | 0 |
| API Gateway (HTTP API) | 1 M calls per month for 12 months (legacy accounts) | 10,000 calls | about 0.01 USD (1 USD per million) | 0 |
| DynamoDB (provisioned) | 25 read and 25 write units, 25 GB, always free | 11 + 11 units per environment, a few MB | about 6 USD per month for 11 + 11 units | 0 |
| S3 (2 buckets) | 5 GB | ~0.3 GB of photos, ~5 MB of site | under 0.01 USD | 0 |
| CloudFront | 1 TB and 10 M requests per month | ~100 MB | 0 to 0.01 USD | 0 |
| Cognito | free tier for the first 10,000 monthly active users | 1 to 5 | 0 | 0 |
| SSM Parameter Store (standard) | standard parameters are free | 1 parameter, ~300 reads | 0 | 0 |
| CloudWatch | 10 alarm metrics, 3 dashboards, 10 custom metrics, 5 GB of logs | 5 alarms, 1 dashboard, 1 custom metric, a few MB of logs per environment | about 3.50 USD (0.10 USD per alarm beyond the free ones, a dashboard beyond 3 is about 3 USD) | 0 |
| SNS | 1 M publishes; 1,000 e-mails free | a few e-mails | 0 | 0 |
| AWS Budgets | 2 budgets free | 1 per environment | 0 | 0 |
| VPC, subnets, security group, **gateway** endpoints | free | no NAT gateway, no interface endpoints | 0 | 0 |
| IAM | free | | 0 | 0 |
| Gemini API | free tier with per-minute and per-day request quotas | 300 requests per month, far below the quota | 0 (pay-as-you-go only if you enable billing in Google AI Studio) | 0 |

**Result:** about 0 USD per month inside the free tier. If every free allowance were gone, the project would cost roughly
10 USD per month, almost all of it DynamoDB provisioned capacity and CloudWatch alarms and dashboard.

## 4. Where the design saves money

| Measure | Where | Effect |
|---|---|---|
| No NAT gateway: the API Lambda is in a private VPC and uses free gateway endpoints; the processor is outside the VPC | `modules/network` | avoids about 30 USD per month per NAT gateway |
| DynamoDB provisioned at 5 + 5 units (table), 5 + 5 (index), 1 + 1 (budgets) | `modules/storage` | 11 + 11 units per environment stays inside the 25 + 25 always-free units |
| HTTP API instead of REST API | `modules/api` | about 70 percent cheaper per request, JWT authorizer included |
| JWT checked by API Gateway | `modules/api` | requests without a token never start a Lambda |
| Throttling 5 requests per second, burst 10 | `modules/api` | a flood cannot exhaust the Lambda or Gemini quota |
| Photos go from the browser straight to S3 (presigned URL) | `src/api` | Lambda and API Gateway never carry image bytes |
| Processor skips deleted and already processed receipts, never raises on a bad photo | `src/processor` | no duplicate Gemini calls, no S3 retry storm |
| `gemini-flash-lite` class model, `temperature 0`, 8,192 output tokens, 7 MB file limit | `src/processor`, tfvars | smallest model that reads receipts correctly |
| Analysis is arithmetic on stored data, not AI calls | `frontend/src/lib` | price changes and monthly totals cost nothing |
| CloudFront `PriceClass_100`, `Managed-CachingOptimized`, one year cache for hashed files | `modules/frontend` | cheapest edge locations, few origin requests |
| Log retention 14 days, 256 MB Lambda memory | `modules/*` | logs stay far below 5 GB |
| Budget warning at 80 percent actual and 100 percent forecast | `modules/monitoring` | an e-mail before the money is spent, not after |
| Tags `Project`, `Environment`, `ManagedBy` on every resource | provider `default_tags` | cost can be filtered per environment in Cost Explorer |

## 5. What would break the free tier

| Risk | Why | Protection |
|---|---|---|
| Both environments in one account | dev + prod use 22 of the 25 always-free DynamoDB units each for reads and writes, 10 of 10 free alarm metrics and both free budgets | they fit, but there is no room for a third environment or more tables |
| Gemini quota | too many receipts per minute or per day | API throttle; the processor stores a readable "rate limit reached" error; alarm `gemini-errors` |
| Adding a NAT gateway or interface endpoints | about 30 USD and 7 USD per month each | keep processor outside the VPC; document this decision |
| Forgetting a deployed environment | alarms, dashboards and DynamoDB capacity bill by the hour after the free plan ends | `terraform destroy`; budget e-mail |
| Large uploads | S3 storage and Gemini tokens | 7 MB limit, S3 lifecycle rule can be added later |
| Free plan expiry (new accounts) | account is closed after 6 months or when credits run out | check the Credits page in Billing |

## 6. How to check the real bill

1. Billing → **Free Tier**: usage against each allowance, with forecasts.
2. Billing → **Cost Explorer**, group by tag `Environment`.
3. The Budgets alarm (`alert_email`) sends mail at 80 percent of `monthly_budget_usd`.
4. CloudWatch dashboard `receipt-scanner-<env>`: invocations and DynamoDB consumed capacity show the real load.
