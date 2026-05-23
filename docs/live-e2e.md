# Live E2E

> `pnpm e2e:live`는 Docker, kind/k3d, kubectl을 사용해 실제 local cluster에 build → push → deploy → HTTP 검증까지 수행하는 side-effecting smoke test입니다.

## 목적

Dry-run으로는 확인할 수 없는 registry, cluster, ingress, rollout, live provider 경계를 검증합니다. 일반 CI 기본값은 dry E2E이며, live E2E는 의도적으로 실행할 때만 사용합니다.

## 실행 명령

```sh
pnpm dev:up
pnpm e2e:live
pnpm dev:down
```

Alias는 `pnpm dev:e2e:live`입니다.

## 사전 요구사항

- Docker + BuildKit/buildx
- `kubectl`
- `kind` 또는 `k3d`
- 기본값 `localhost:5000`이 맞지 않으면 `REGISTRY_URL`

필수 도구가 없으면 build, push, `kubectl apply`를 시작하기 전에 non-zero로 종료합니다.

## 실행 중 준비하는 것

Live mode는 `--execute` 계약과 도구 준비가 모두 충족될 때 다음을 준비합니다.

1. `raibitserver-registry` local registry (`:5000`)
2. `raibitserver-e2e` disposable kind 또는 k3d cluster
3. registry-to-cluster wiring
   - kind: containerd mirror, Docker network 연결, `kube-public/local-registry-hosting` ConfigMap
   - k3d: `--registry-use`
4. ingress-nginx 설치와 readiness wait
5. build/push, Kubernetes apply, rollout/log evidence, provider provisioning check

## 증거 파일

`.raibitserver-work/e2e-report.json`에는 다음이 포함되어야 합니다.

- tool readiness
- registry/cluster/ingress setup command와 결과
- local registry가 cluster에서 접근 가능한지 여부
- example app HTTP 200 결과
- PostgreSQL provider dry-run/env injection evidence
- SQLite DB console query evidence
- deployment, preview deployment, preview cleanup, build log, runtime log, event check
- build/Kubernetes/provisioning mode의 `dryRun: false`

## CI에서의 위치

수동 실행용 GitHub Actions workflow는 `.github/workflows/live-e2e.yml`에 있습니다. 기본 runner는 `self-hosted` 계열로 가정하므로 일반 PR은 dry E2E를 기본 proof로 사용합니다.

## 관련 문서

- [로컬 E2E](local-e2e.md)
- [검증 명령](verification-commands.md)
- [문제 해결](troubleshooting.md)
