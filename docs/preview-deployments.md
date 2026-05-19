# Preview Deployments

Preview host pattern:

```txt
pr-<number>--<service>--<project>--<org>.preview.<BASE_DOMAIN>
```

GitHub `pull_request` opened/synchronize/reopened queues a `PREVIEW` deployment. PR closed queues cleanup. The local fixture in `pnpm dev:e2e` creates a preview deployment record, workflow job, and URL without needing real GitHub credentials.
