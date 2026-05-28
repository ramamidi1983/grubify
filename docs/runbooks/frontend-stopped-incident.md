# Runbook: Frontend Container App Stopped

## Overview

This runbook covers diagnosis and remediation when the Grubify frontend container app (`ca-grubify-fe-lo6o542xwnj7i`) is stopped — whether by an admin action, a failed revision transition, or a cost-blocking policy.

**Alert:** `alert-frontend-stopped-sre-lab` (Activity Log alert on stop action)  
**Resource:** `/subscriptions/10071b20-ef3c-4249-9cee-232a1b456c28/resourceGroups/rg-sre-lab/providers/Microsoft.App/containerApps/ca-grubify-fe-lo6o542xwnj7i`  
**Log Analytics Workspace ID:** `8c17ad07-8856-4349-8fe0-decb52546722`

---

## Step 1: Confirm the App Is Stopped

```bash
az containerapp show \
  -n ca-grubify-fe-lo6o542xwnj7i \
  -g rg-sre-lab \
  --subscription 10071b20-ef3c-4249-9cee-232a1b456c28 \
  --query "{name:name, provisioningState:properties.provisioningState, runningStatus:properties.runningStatus, latestRevision:properties.latestRevisionName}" \
  -o json
```

Expected output when stopped: `"runningStatus": "Stopped"`.

---

## Step 2: Check for Cost-Blocking Policy

**This must be done before attempting any write operations.** The SRE Cost Agent may have applied a `costBlocked=true` tag to the resource group, which triggers an Azure Policy that rejects all write operations.

```bash
az group show \
  -n rg-sre-lab \
  --subscription 10071b20-ef3c-4249-9cee-232a1b456c28 \
  --query tags \
  -o json
```

If `"costBlocked": "true"` is present, override it:

```bash
az tag update \
  --resource-id /subscriptions/10071b20-ef3c-4249-9cee-232a1b456c28/resourceGroups/rg-sre-lab \
  --operation merge \
  --tags costBlocked=false \
  --subscription 10071b20-ef3c-4249-9cee-232a1b456c28
```

> **Note:** Overriding this tag is necessary for incident remediation. Document the override in the incident timeline and restore the tag after remediation if appropriate.

---

## Step 3: Identify Who/What Stopped the App

Query activity logs for the stop action (expand window to 6 hours):

```bash
az monitor activity-log list \
  --resource-id /subscriptions/10071b20-ef3c-4249-9cee-232a1b456c28/resourceGroups/rg-sre-lab/providers/Microsoft.App/containerApps/ca-grubify-fe-lo6o542xwnj7i \
  --subscription 10071b20-ef3c-4249-9cee-232a1b456c28 \
  --offset 6h \
  --query "[?contains(operationName.value,'Stop') || contains(operationName.value,'Start') || contains(operationName.value,'Write')].{operation:operationName.value, status:status.value, time:eventTimestamp, caller:caller}" \
  -o table
```

### Common Callers

| Caller | Meaning |
|--------|---------|
| `admin@MngEnvMCAP460630.onmicrosoft.com` | Lab admin — manual stop action |
| `cac86e72-638c-42fd-8d63-43a4c18f6dc0` | SRE Agent service principal |
| Other service principal GUIDs | Automated deployments or CI/CD |

---

## Step 4: Start the Container App

### Option A: Azure CLI (if available)

```bash
az containerapp start \
  -n ca-grubify-fe-lo6o542xwnj7i \
  -g rg-sre-lab \
  --subscription 10071b20-ef3c-4249-9cee-232a1b456c28
```

> **Note:** The `az containerapp start` command may not be available in all CLI versions. If it fails with "not recognized", use Option B.

### Option B: ARM REST API via Python (reliable fallback)

Use this when the CLI `start` command is unavailable or when operating through the SRE Agent:

```python
import requests
from azure.identity import ManagedIdentityCredential

credential = ManagedIdentityCredential(client_id="971dc731-5e0f-4dd6-bb8a-28d805802733")
token = credential.get_token("https://management.azure.com/.default")

subscription_id = "10071b20-ef3c-4249-9cee-232a1b456c28"
resource_group = "rg-sre-lab"
app_name = "ca-grubify-fe-lo6o542xwnj7i"

url = (
    f"https://management.azure.com/subscriptions/{subscription_id}"
    f"/resourceGroups/{resource_group}"
    f"/providers/Microsoft.App/containerApps/{app_name}"
    f"/start?api-version=2024-03-01"
)

response = requests.post(url, headers={
    "Authorization": f"Bearer {token.token}",
    "Content-Type": "application/json"
})

print(f"Status: {response.status_code}")  # Expect 202 Accepted
```

Wait ~30 seconds after receiving HTTP 202 before verifying.

### Option C: Update replicas (reliable workaround)

```bash
az containerapp update \
  -n ca-grubify-fe-lo6o542xwnj7i \
  -g rg-sre-lab \
  --subscription 10071b20-ef3c-4249-9cee-232a1b456c28 \
  --min-replicas 1 --max-replicas 3
```

> **Note:** Despite earlier assumptions, this command **does** successfully restart a stopped app. The update implicitly starts the app when it needs to provision replicas. Confirmed during incident [#19](https://github.com/ramamidi1983/grubify/issues/19) on 2026-05-28. This is the simplest remediation path when `az containerapp start` is unavailable.

---

## Step 5: Verify Recovery

### Quick Verification

```bash
az containerapp show \
  -n ca-grubify-fe-lo6o542xwnj7i \
  -g rg-sre-lab \
  --subscription 10071b20-ef3c-4249-9cee-232a1b456c28 \
  --query "{runningStatus:properties.runningStatus, provisioningState:properties.provisioningState}" \
  -o json
```

Expected: `"runningStatus": "Running"`, `"provisioningState": "Succeeded"`.

### Full Health Check (SRE Agent)

Use the `ValidateContainerAppHealth` tool with the resource ID. Verify:
- Provisioning state: Succeeded
- Replicas: 1/1 running
- Endpoint reachable: True
- No errors in logs

### Manual Endpoint Check

```bash
curl -s -o /dev/null -w "%{http_code}" \
  https://ca-grubify-fe-lo6o542xwnj7i.greentree-b32620cf.eastus2.azurecontainerapps.io/
```

Expected: `200`.

---

## Step 6: Gather Evidence and Create Incident Report

### System Logs (KQL)

```kql
ContainerAppSystemLogs_CL
| where ContainerAppName_s == "ca-grubify-fe-lo6o542xwnj7i"
| where TimeGenerated > ago(2h)
| project TimeGenerated, Type_s, Reason_s, Log_s, RevisionName_s
| order by TimeGenerated desc
| take 30
```

### Console Logs (KQL)

```kql
ContainerAppConsoleLogs_CL
| where ContainerAppName_s == "ca-grubify-fe-lo6o542xwnj7i"
| where TimeGenerated > ago(2h)
| project TimeGenerated, Log_s, RevisionName_s
| order by TimeGenerated desc
| take 50
```

### Create GitHub Issue

Follow the [incident report template](../../docs/runbooks/incident-report-template.md) and create an issue in `ramamidi1983/grubify` with labels: `bug`, `frontend-bug`, `incident`, `severity-high`.

---

## Troubleshooting

### "RequestDisallowedByPolicy" Error

This means an Azure Policy is blocking write operations. Check for cost-blocking tags on the resource group (Step 2).

### "start is misspelled or not recognized"

The `az containerapp start` command is not available in your CLI version. Use the ARM REST API approach (Step 4, Option B).

### App Shows "Running" but No Traffic

Check if KEDA scalers restarted and replicas are actually provisioned:
- Look for `KEDAScalersStarted` in system logs
- Verify replica count is >= 1

---

## Past Incidents

| Date | Issue | Root Cause | Duration |
|------|-------|------------|----------|
| 2026-05-27 ~18:12 | [#16](https://github.com/ramamidi1983/grubify/issues/16) | Revision transition without rolling update | ~10 min |
| 2026-05-27 ~21:28 | [#18](https://github.com/ramamidi1983/grubify/issues/18) | Manual admin stop + cost policy block | ~16 hours |
| 2026-05-27 ~21:28 | [#19](https://github.com/ramamidi1983/grubify/issues/19) | Manual admin stop (no cost block) — remediated via `az containerapp update` | ~17.8 hours |
