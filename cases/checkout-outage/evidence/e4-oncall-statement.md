---
id: E4
title: Statement of the checkout on-call engineer
kind: testimony
source: Jordan Kim, checkout on-call engineer
reliability: 0.6
favors: defense
summary: The on-call engineer saw connection pool warnings from the new HTTP client right after the 08:55 deploy and suspected the deploy first.
quote: Right after the deploy finished I saw connection pool warnings from the new client, and my first thought was that we broke it.
misquote: Right after the deploy finished I saw connection errors from the new client, and I knew that we broke it.
weakness: The same connection pool warnings appear in the logs on each of the seven days before the incident.
impact: 0.6
---
Written statement, taken March 15.

I was on call for checkout. I watched the deploy go out at 08:55. Right after the deploy finished I saw connection pool warnings from the new client, and my first thought was that we broke it.

When checkout errors paged at 09:03 I assumed the deploy and asked for a rollback. I did not look at the vendor status page until after 09:30.

I am not sure the warnings had anything to do with the TLS errors. I only know they started around the same time.
