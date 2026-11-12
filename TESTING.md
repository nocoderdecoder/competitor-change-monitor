# Test scope

The 17 Node tests cover normalization, repeated lines, filters, baseline creation, changed and unchanged pages, failed extraction, public-address checks, and the generated n8n Code nodes. The sample digest is produced from synthetic HTML fixtures.

The generated workflow was also imported and executed with n8n 2.47.4. A local HTTP fixture exercised the HTTP Request, comparison, and digest nodes. Runs checked baseline creation, changes against a supplied previous snapshot, and a connection failure reported in the digest. The fixture URL was substituted only for this integration check; the distributed workflow contains a public HTTPS example URL.

The Code-node unit tests use fixture inputs and a static-data stub. The integration check does not establish persistence between scheduled production executions, retrieval from every public site, or delivery to a configured destination. No schedule or notification destination was enabled during testing.

No recurring monitoring is enabled by installing or cloning this repository.
