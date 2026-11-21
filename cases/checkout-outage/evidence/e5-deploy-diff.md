---
id: E5
title: Release notes for checkout-svc v412
kind: document
source: Sam Whitley, checkout tech lead
reliability: 0.75
favors: defense
summary: The 08:55 release upgraded the HTTP client library from 4.2 to 5.0, and the upgrade changed default TLS behavior.
quote: Upgrade http-client from 4.2 to 5.0, which changes TLS defaults and certificate chain caching.
misquote: Upgrade http-client from 4.2 to 5.0, which breaks certificate chain validation.
weakness: The changed TLS default governs fallback to TLS 1.0, which the vendor endpoint has never used.
impact: 0.5
rebuttal: The same upgrade also changed how intermediate certificates are cached, so it can still matter during a rotation.
---
**checkout-svc v412**, released 08:55 UTC, March 14.

- Upgrade http-client from 4.2 to 5.0, which changes TLS defaults and certificate chain caching.
- Remove the legacy TLS 1.0 fallback path.
- Add retry jitter to the payment authorization call.

Testing: integration tests passed against the vendor sandbox on March 12. The sandbox did not have the new certificate chain at that time.
