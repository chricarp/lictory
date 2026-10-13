# Security policy

Report vulnerabilities privately through the upstream repository's GitHub
**Security → Report a vulnerability** flow. Do not open a public issue or PR
containing exploit details, secrets or customer data. If private reporting is
unavailable, use the repository owner's published private contact; wait for a
private channel before sharing sensitive details.

Include the affected commit or release, installation type, steps to reproduce,
impact and a minimal example using your own local data. Authentication bypass,
cross-organization access, incorrect authorization, and exposed integration
credentials are particularly important. Do not test against other people's
workspaces or the hosted service without explicit authorization.

Maintainers investigate reproducible reports against the current development
branch and latest stable release when available. There is currently no LTS
commitment or fixed response-time guarantee. Operators should apply security
fixes and review their infrastructure and integration credentials. Coordinate
public disclosure after remediation, and state your preferred attribution.

Before publishing or transferring the repository, maintainers must enable
private vulnerability reporting and verify a monitored fallback contact. Fork
operators are responsible for their installation and should publish their own
contact. The software license does not provide a hosted security service.
