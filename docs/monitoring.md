# Monitoring

Monitoring is created by `terraform/modules/monitoring` and works as soon as the environment is deployed. Nothing has
to be installed.

## What is in place

| Piece | Name (dev) | Purpose |
|---|---|---|
| CloudWatch dashboard | `receipt-scanner-dev` | one page: requests, errors, latency, Lambda, DynamoDB, Gemini failures, alarm states |
| SNS topic | `receipt-scanner-dev-alerts` | every alarm publishes here; e-mail subscription when `alert_email` is set |
| 5 CloudWatch alarms | see below | tell you something is wrong before a user does |
| Log metric filter | `receipt-scanner-dev-gemini-errors` | turns "Gemini HTTP 4xx/5xx" log lines into a metric |
| AWS Budget | `receipt-scanner-dev-monthly` | e-mail at 80 percent of the monthly budget (actual) and when 100 percent is forecast |
| Lambda logs | `/aws/lambda/receipt-scanner-dev-api`, `/aws/lambda/receipt-scanner-dev-processor` | 14 days of retention |

Built-in metrics from AWS services need no setup: Lambda (`Invocations`, `Errors`, `Duration`, `Throttles`),
API Gateway (`Count`, `4xx`, `5xx`, `Latency`), DynamoDB (consumed capacity, throttled requests).

## Alarms

| Alarm | Fires when | What it usually means | First step |
|---|---|---|---|
| `...-api-lambda-errors` | API Lambda reports 1+ error in 5 min | bug, timeout, missing permission, VPC problem | read the API log (below) |
| `...-processor-lambda-errors` | processor crashes in 5 min | permission or code error. A bad photo does **not** count: it is stored as `failed` | read the processor log |
| `...-processor-slow` | one receipt took over 120 s (timeout is 180 s) | very long receipt or slow Gemini | check Gemini latency, the 7 MB limit |
| `...-api-gateway-5xx` | 3+ responses with 5xx in 5 min | Lambda failing or timing out | start with the API Lambda alarm |
| `...-gemini-errors` | 3+ rejected Gemini calls in 15 min | quota reached (429), wrong or deleted key, model name removed | check the key in SSM and the model in tfvars |

Missing data counts as "not breaching": no traffic is not an incident. Alarms send mail on `ALARM` and on return to `OK`
(the processor-slow alarm only on `ALARM`).

The mail only arrives after the SNS subscription is confirmed (a message from AWS Notifications, click the link).

## Looking at it

Console: CloudWatch, Dashboards, `receipt-scanner-<env>` (`terraform output -raw dashboard_name`).

Command line:

```powershell
# live log of the processor (what Gemini returned, why a receipt failed)
aws logs tail /aws/lambda/receipt-scanner-dev-processor --follow --region eu-north-1

# the API Lambda, last 30 minutes
aws logs tail /aws/lambda/receipt-scanner-dev-api --since 30m --region eu-north-1

# state of all alarms of this environment
aws cloudwatch describe-alarms --alarm-name-prefix receipt-scanner-dev --query "MetricAlarms[].[AlarmName,StateValue]" --output table --region eu-north-1
```

CloudWatch Logs Insights (console, select the processor log group): receipts that failed and why

```
fields @timestamp, @message
| filter @message like /Rejected|Gemini HTTP|Failed to process/
| sort @timestamp desc
| limit 50
```

## Testing the alarms (useful during a demo)

```powershell
# send the alarm e-mail without breaking anything
aws cloudwatch set-alarm-state --alarm-name receipt-scanner-dev-api-lambda-errors --state-value ALARM --state-reason "demo" --region eu-north-1
```

The alarm returns to `OK` at its next evaluation (within five minutes) and sends the second mail.

A real Gemini failure: put a wrong key into SSM (`aws ssm put-parameter --name /receipt-scanner/dev/gemini-api-key --type SecureString --value wrong --overwrite`),
wait until warm Lambdas are replaced or redeploy, upload three receipts; the `gemini-errors` alarm fires. Restore the key afterwards.

## Application-level signals

The site itself reports problems to the user: a receipt that could not be read shows `failed` with the reason
(`Gemini rate limit reached`, `Could not read a total amount`, `The file is larger than 7 MB`, ...), taken from the
`error` attribute written by the processor.

## Free-tier footprint of the monitoring

Per environment: 5 alarms, 1 dashboard, 1 custom metric, 1 budget, a few MB of logs. CloudWatch gives 10 alarm metrics,
3 dashboards, 10 custom metrics and 5 GB of logs for free, so dev and prod together fit, with no alarm to spare
(see [cost-analysis.md](cost-analysis.md)).
