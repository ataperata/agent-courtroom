---
id: E3
title: Rollback and recovery measurements
kind: data
source: Marco Reyes, incident commander
reliability: 0.88
favors: prosecution
summary: Rolling back our 08:55 deploy at 09:20 did not change the error rate. Errors stopped at 09:47, within a minute of adding the vendor's new intermediate certificate to our trust bundle.
quote: The error rate on rolled-back pods was 96.8 percent, against 97.1 percent on pods still running v412.
misquote: Rolling back to v411 had no effect at all on the error rate.
weakness: The rollback was partial; two of twelve pods kept the new build for eleven extra minutes.
impact: 0.35
rebuttal: The ten pods that did roll back failed at the same rate as the two that did not, which is the comparison that matters.
---
Measurements taken from the checkout dashboard during the incident.

| Time  | Action                                   | Error rate |
|-------|------------------------------------------|-----------:|
| 09:05 | none                                     | 97%        |
| 09:20 | roll back to v411 on 10 of 12 pods       | 97%        |
| 09:31 | remaining 2 pods rolled back             | 97%        |
| 09:46 | add vendor intermediate CA to trust bundle | 97%      |
| 09:47 | bundle reload complete                   | 0.4%       |

The error rate on rolled-back pods was 96.8 percent, against 97.1 percent on pods still running v412.

v411 has been running in production since March 2 without TLS errors before this date.
