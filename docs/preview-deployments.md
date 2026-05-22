# Preview Deployments

Preview host pattern:

```txt
pr-<number>--<service>--<project>--<org>.preview.<BASE_DOMAIN>
```

GitHub `pull_request` opened/synchronize/reopened queues a `PREVIEW` deployment. PR closed queues cleanup. The local fixture in `pnpm e2e:dry` creates a preview deployment record, workflow job, and URL without needing real GitHub credentials.
