# Setup

## AWS

Everything runs in one project Region, `us-west-1`.

| Stack | What it holds | Deployed by |
|---|---|---|
| `pd-bootstrap` | GitHub OIDC trust and the `pd-github-deploy` role | Hand, once (see [cloud/README.md](../cloud/README.md)) |
| `pd-stack` | Tables, Cognito, IoT things and policy | CI on merge to `main` when `cloud/` changes |
| `aws-sam-cli-managed-default` | SAM's upload bucket | SAM, automatically |

Set up by hand, outside the stacks: the Amplify app (linked to this repo, publishes `web/`), IoT certificates, and the budget and spend limit.

## Values other parts need

None of these are secrets.

| Value | Used by |
|---|---|
| Site: https://main.dc3k8sg5zaosx.amplifyapp.com | Cognito redirects, CORS |
| Cognito domain: https://pigdetector-828411126105.auth.us-west-1.amazoncognito.com | `web/js/config.js` |
| User pool ID: `us-west-1_UAbK8omG2` | Lambda token checks |
| App client ID: `53ag8m9ir3lggeb4qo0p53arbp` | `web/js/config.js` |
| Login redirect: `{site}/callback.html` (also `http://localhost:5500/callback.html`) | `web/js/config.js` |
| Logout redirect: `{site}/index.html` (also `http://localhost:5500/index.html`) | `web/js/config.js` |
| IoT endpoint: `a1h01vt47w0y8q-ats.iot.us-west-1.amazonaws.com` | `firmware/gateway/config.h` |

The stack outputs are the source of truth if anything here drifts:

```bash
aws cloudformation describe-stacks --stack-name pd-stack --region us-west-1 --query 'Stacks[0].Outputs'
aws iot describe-endpoint --endpoint-type iot:Data-ATS --region us-west-1
```
