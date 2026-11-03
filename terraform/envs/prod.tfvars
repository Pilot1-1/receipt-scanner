# Production settings. Use with:  .\scripts\deploy.ps1 -Env prod   (or  ./scripts/deploy.sh prod)
#
# Before the first prod deploy, store the Gemini key for this environment (one parameter per environment):
#   aws ssm put-parameter --name /receipt-scanner/prod/gemini-api-key --type SecureString --value "YOUR_KEY"
#
# Set the alert address without committing it:  $env:TF_VAR_alert_email = "you@example.com"
environment  = "prod"
gemini_model = "gemini-3.5-flash-lite"

# Accounts are created by the administrator only.
allow_self_signup = false

# The website signs in with SRP; the plain password flow is only for testing.
allow_password_auth = false

# No local development server may call the production API or upload to the production bucket.
dev_origins = []

# Alarms and the budget warning go to alert_email (see above). 5 USD is far above the free-tier usage.
monthly_budget_usd = 5
