---
id: E6
title: Agreed incident timeline
kind: document
source: Postmortem working group
reliability: 0.95
favors: neutral
summary: Both changes landed within five minutes of each other; errors began at 09:02 and ended at 09:47.
quote: Checkout errors began at 09:02 and ended at 09:47.
---
Times in UTC, March 14. Both parties agree to this sequence.

- 08:55 checkout-svc v412 deployed
- 09:00 vendor certificate rotation begins (CHG-88213)
- 09:02 first TLS handshake failures
- 09:03 on-call paged
- 09:20 rollback to v411 begins
- 09:46 vendor intermediate CA added to trust bundle
- 09:47 recovery

Checkout errors began at 09:02 and ended at 09:47.
