# cloud

Owner: Peyton.

- `template.yaml` AWS SAM stack `pd-stack`: DynamoDB tables, IoT policy and rules, Cognito, HTTP API, Lambda
- `lambda/pd_api/` the API Lambda (Node.js 22)
- `tools/` fake gateway and demo seeding scripts
- `bootstrap.yaml` stack `pd-bootstrap`: GitHub OIDC trust and the `pd-github-deploy` role CI uses. Deployed once by hand:

  ```bash
  aws cloudformation deploy --stack-name pd-bootstrap --template-file cloud/bootstrap.yaml \
    --capabilities CAPABILITY_NAMED_IAM --region us-west-1
  ```

Every cloud resource lives in `template.yaml`. Change it with a pull request, never in the console. Setup steps are in [../docs/setup.md](../docs/setup.md), and the API reference is in [../docs/api.md](../docs/api.md).
