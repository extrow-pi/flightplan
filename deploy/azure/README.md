# Deploying to Azure Container Apps + Supabase

The whole site runs as one container on Azure Container Apps. The database is a free Supabase Postgres project, and floor map uploads are kept on an Azure Files share.

```
GitHub push to main ─▶ GitHub Actions ─▶ image on ghcr.io ─▶ Azure Container App (1 replica)
                                                                ├─▶ Supabase Postgres (session pooler)
                                                                ├─▶ Azure Files share (/data/uploads)
                                                                └─▶ Resend (email)
```

Expected cost: roughly **$8–10/month**, almost all of it Container Apps compute. Set a budget alert (step 6).

You need the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) (`az login` first) and Git Bash on Windows, or any bash shell.

## 1. Create the Supabase database

1. Create a project at [supabase.com](https://supabase.com). Pick the **Canada (Central)** region so it's close to the app, and save the database password somewhere safe.
2. **Turn off the Data API.** Flightplan talks to Postgres directly and never uses Supabase's REST API. With the Data API on, anyone with the project's public key could read tables that have no row-level security, which is all of Flightplan's. Go to **Project Settings → Data API** and disable it, or at least remove `public` from the exposed schemas.
3. Click **Connect** and copy the **Session pooler** connection string. Don't use the *Direct connection*, which is IPv6 only and Azure can't reach it, or the *Transaction pooler*, which breaks the prepared statements the app uses.
4. Put in your password and add `?sslmode=require` to the end:
   ```
   postgresql://postgres.abcdefghijklmnop:YOUR-PASSWORD@aws-0-ca-central-1.pooler.supabase.com:5432/postgres?sslmode=require
   ```

The app creates its tables when it starts. Free Supabase projects pause after a week without activity, but the app queries the database every 30 seconds, so that won't happen while it's running.

## 2. Build the first image

Merge this branch into `main` and push. The **Build and deploy** workflow builds the image and pushes it to `ghcr.io/extrow-pi/flightplan`. The deploy step is skipped until step 5.

The package is **private** by default. Either:

- make it public: on GitHub, go to **Packages → flightplan → Package settings → Change visibility**. This is fine as long as the repository is public too, because the image contains only the code, no secrets. Or
- keep it private and give Azure a token: create a classic personal access token with only the **read:packages** scope, and put it in `GHCR_USERNAME` / `GHCR_TOKEN` in the next step.

## 3. Fill in the settings

```bash
cp deploy/azure/production.env.example deploy/azure/production.env
```

Edit `deploy/azure/production.env`. It's ignored by git, so never commit it. At minimum set:

- `STORAGE_ACCOUNT`: a globally unique name, e.g. `flightplanuploads123`
- `DATABASE_URL`: the Supabase string from step 1
- `BETTER_AUTH_SECRET`: a new random value, not the one from your local `.env`
- `RESEND_API_KEY` and `EMAIL_FROM`, if you want emails to actually send

Leave `BETTER_AUTH_URL` blank to use the app's own `https://flightplan.<random>.canadacentral.azurecontainerapps.io` address.

## 4. Create the Azure resources

```bash
bash deploy/azure/setup.sh
```

It prints the app's URL when it's done, usually after 3–5 minutes. Re-run it any time you change `production.env`. It updates the settings and keeps the currently deployed image.

Open the URL and sign up for your organizer account. The seed script only works against a local dev server, which keeps its well-known test password off the live site.

If you use Google sign-in, add `https://<your-app-url>/api/auth/callback/google` to the OAuth client's redirect URIs.

## 5. Deploy automatically on every push (optional)

This lets GitHub Actions sign in to Azure with OpenID Connect, so no password is stored in GitHub. It can only change resources in the `flightplan` resource group.

```bash
RG=flightplan
SUB=$(az account show --query id -o tsv)
TENANT=$(az account show --query tenantId -o tsv)
APP_ID=$(az ad app create --display-name flightplan-github-deploy --query appId -o tsv)
az ad sp create --id "$APP_ID"
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "github-main",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:extrow-pi@48468642/flightplan@1383259849:ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"]
}'
MSYS_NO_PATHCONV=1 az role assignment create --assignee "$APP_ID" --role Contributor \
  --scope "/subscriptions/$SUB/resourceGroups/$RG"
echo "AZURE_CLIENT_ID=$APP_ID  AZURE_TENANT_ID=$TENANT  AZURE_SUBSCRIPTION_ID=$SUB"
```

The `subject` must match what GitHub sends exactly. GitHub now includes the owner's and repository's numeric IDs (`owner@<id>/repo@<id>`); the numbers above are this repository's. For a fork or a renamed repo, run the workflow once: the failed **azure/login** step prints the expected subject in its `AADSTS700213` error. Then update it with `az ad app federated-credential update --id "$APP_ID" --federated-credential-id github-main --parameters …`.

Then, on GitHub, go to **Settings → Secrets and variables → Actions → Variables** and add these as **variables**. They're IDs, not secrets:

| Variable | Value |
|---|---|
| `AZURE_CLIENT_ID` | printed above |
| `AZURE_TENANT_ID` | printed above |
| `AZURE_SUBSCRIPTION_ID` | printed above |
| `AZURE_RESOURCE_GROUP` | `flightplan` |
| `AZURE_CONTAINERAPP` | `flightplan` |

From then on, every push to `main` builds a new image and switches the app to it once it passes its health check.

## 6. Set a budget alert

In the Azure portal, go to **Cost Management → Budgets → Add**. Scope it to the `flightplan` resource group with a monthly amount of about $15, and add an alert at 80% to your email.

## Custom domain (optional)

1. In the portal, open the Container App and go to **Custom domains → Add**. Choose a **managed certificate**, which is free, and add the DNS records it shows you.
2. Set `BETTER_AUTH_URL=https://your.domain` in `production.env` and re-run `setup.sh`.
3. Update the Google OAuth redirect URI and the `EMAIL_FROM` domain to match.

## Day to day

| Task | Command |
|---|---|
| Live logs | `az containerapp logs show -n flightplan -g flightplan --follow` |
| Restart | `az containerapp revision restart -n flightplan -g flightplan --revision $(az containerapp revision list -n flightplan -g flightplan --query "[0].name" -o tsv)` |
| Change a setting | edit `production.env`, re-run `setup.sh` |
| Roll back | re-run the **Build and deploy** workflow from an older commit, or `az containerapp update -n flightplan -g flightplan --image ghcr.io/extrow-pi/flightplan:<older-sha>` |
| Tear it all down | `az group delete -n flightplan`. This deletes the uploads too; the Supabase database is separate. |

**Keep it to one replica.** The email worker and payment reminders run inside the app, so the setup pins the app at exactly one replica. Don't raise `maxReplicas`.
