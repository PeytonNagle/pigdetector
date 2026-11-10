# secrets/

Local only. Git ignores everything here except this file. Never `git add -f` in this folder.

| File | What it is | Secret? |
|---|---|---|
| `pd-fake-gw/private.pem.key` | Private key for the fake gateway's IoT certificate | **Yes** |
| `pd-fake-gw/certificate.pem.crt` | The fake gateway's certificate, signed by AWS | No |
| `pd-fake-gw/public.pem.key` | Public half of the key (not needed to connect) | No |
| `pd-fake-gw/AmazonRootCA1.pem` | Amazon's root CA, used to check you're talking to AWS | No |
| `pd-fake-gw/certificate-arn.txt` | The certificate's ARN, for deactivating or deleting it | No |
| `pd-gw-01.csr` | Wonhee's signing request for the real gateway, once it arrives | No |

Used by `cloud/tools/fake_gateway.mjs` through `FAKE_GW_CERT_DIR` in `.env`. Lost or leaked? Deactivate the certificate and make a new one (see the build spec's IoT tab, Certificates).
