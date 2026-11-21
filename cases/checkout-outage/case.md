---
id: checkout-outage
title: The March 14 Checkout Outage
claim: The March 14 checkout outage was caused by the payment vendor's certificate rotation, not by our 08:55 deploy.
burden: preponderance
prosecution_theory: The vendor rotated its TLS certificates at 09:00, our clients could not validate the new chain, and checkout failed. Rolling back our deploy changed nothing; pinning the new intermediate certificate fixed it.
defense_theory: Our 08:55 deploy upgraded the HTTP client and changed how it handles TLS. The timing is too close to rule it out, and the vendor's own notice was written after the fact.
---
On Thursday, March 14, card checkout failed for 45 minutes between 09:02 and 09:47 UTC. About 3,900 orders were lost or abandoned. Two changes landed within five minutes of each other: our own release of the checkout service at 08:55, and a certificate rotation by our payment vendor at 09:00.

The postmortem needs one answer before it can assign corrective actions: which change caused the outage. This trial puts the vendor theory to the test.
