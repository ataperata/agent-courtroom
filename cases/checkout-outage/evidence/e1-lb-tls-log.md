---
id: E1
title: Load balancer TLS error log
kind: log
source: Priya Shah, SRE on call
reliability: 0.92
favors: prosecution
summary: TLS handshake failures against the vendor endpoint started at 09:02:11, two minutes after the vendor rotation and seven minutes after our deploy.
quote: Every failed request in the window ends with the same error: unable to get local issuer certificate.
misquote: Every request in the window failed with the same error: unable to get local issuer certificate.
weakness: The excerpt covers only the us-east region, one of three regions that serve checkout.
impact: 0.4
rebuttal: The us-west and eu-central logs show the same error starting within the same minute; they were left out of the excerpt for length, not because they differ.
---
Excerpt from `lb-prod-us-east` egress logs, March 14 (UTC).

```
08:55:40  deploy checkout-svc v412 complete (12/12 pods)
08:59:58  upstream=api.payments-vendor.example status=200 tls=ok
09:02:11  upstream=api.payments-vendor.example status=502 tls_error=handshake_failure
09:02:11  detail="unable to get local issuer certificate"
09:02:30  502 rate 41% of checkout calls
09:05:00  502 rate 97% of checkout calls
09:47:20  upstream=api.payments-vendor.example status=200 tls=ok
```

Between 08:55:40 and 09:02:10 there were 1,812 successful calls to the vendor from the new build.

Every failed request in the window ends with the same error: unable to get local issuer certificate.

Calls to our other upstreams (tax, fraud scoring, inventory) from the same pods succeeded throughout the window.
