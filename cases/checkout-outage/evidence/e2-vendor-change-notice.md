---
id: E2
title: Vendor change notice CN-5531
kind: document
source: Ellen Ford, vendor change manager
reliability: 0.85
favors: prosecution
summary: The vendor rotated the certificates for its API endpoints starting at 09:00 UTC and moved to a new intermediate certificate authority.
quote: Rotation of TLS certificates for api.payments-vendor.example began at 09:00 UTC and introduced a new intermediate CA.
misquote: Rotation of TLS certificates for api.payments-vendor.example began at 09:00 UTC and broke clients that use a bundled trust store.
weakness: The notice was published at 11:40 UTC, almost two hours after checkout recovered.
impact: 0.3
rebuttal: The 09:00 start time comes from the vendor's change system record, not from when the notice was posted.
---
**Change notice CN-5531**
Status: Completed. Published 11:40 UTC, March 14.

Rotation of TLS certificates for api.payments-vendor.example began at 09:00 UTC and introduced a new intermediate CA.

Customers who pin intermediate certificates or ship a bundled trust store may have seen handshake failures until the new intermediate was added. Customers using the operating system trust store were not affected.

The change was scheduled in our change system as CHG-88213 with a start time of 09:00 UTC. Advance notice was sent to the technical contact on file on March 7.
