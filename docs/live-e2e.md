# Live E2E

> `pnpm e2e:live`는 Docker, kind/k3d, kubectl을 사용해 실제 local cluster에 build → push → deploy → rollout → HTTP 200 → DB/resource evidence → preview cleanup까지 수행하는 side-effecting 베타 gate입니다.

## 목적

Dry-run으로는 확인할 수 없는 registry, cluster, ingress, rollout, image pull, live provider 경계를 검증합니다. 일반 CI 기본값은 dry E2E이며, live E2E는 의도적으로 실행할 때만 사용합니다.

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

필수 도구가 없으면 build, push, `kubectl apply`를 시작하기 전에 non-zero로 종료합니다. 기본 dry-run은 이 경우에도 deterministic fallback report를 생성합니다.

## 실행 중 준비하는 것

Live mode는 `--execute` 계약과 도구 준비가 모두 충족될 때 다음을 준비합니다.

1. `raibitserver-registry` local registry (`:5000`)
2. `raibitserver-e2e` disposable kind 또는 k3d cluster
3. registry-to-cluster wiring
   - kind: containerd mirror, Docker network 연결, `kube-public/local-registry-hosting` ConfigMap
   - k3d: `--registry-use`
4. RAIBITSERVER managed resource CRD 설치
5. ingress-nginx 설치, `raibitserver.io/ingress-gateway=true` namespace label, readiness wait
6. Express Dockerfile app build/push
7. Vite Dockerfile app build/push
8. generated Dockerfile app build/push
9. prebuilt image retag/push/deploy
10. local PostgreSQL provider Deployment/Service apply와 `SELECT 1` 확인
11. Kubernetes workload apply, rollout status, ingress HTTP 200, log/event evidence
12. SQLite console query, PR preview 생성, PR closed cleanup enqueue 확인

## 증거 파일

Live mode는 `.raibitserver-work/e2e-report.json`와 `.raibitserver-work/live-e2e-report.json`를 씁니다. Dry mode는 같은 schema를 `.raibitserver-work/e2e-report.json`에만 씁니다.

핵심 필드:

- `tools`: Docker/kubectl/kind/k3d/go 감지 결과
- `liveSetup`, `liveSetupResults`: registry/cluster/ingress/CRD setup 계획과 실행 결과
- `liveBeta.services`: service별 deployment id, image URL, image digest
- `liveBeta.rolloutResults`: `kubectl rollout status`와 PostgreSQL `SELECT 1` 결과
- `liveBeta.httpResults`: public/local ingress URL HTTP status
- `liveBeta.betaChecklist`: 베타 Live E2E checklist 항목별 boolean
- `previewDeploymentId`, `previewCleanupAction`: PR preview와 cleanup evidence
- `buildDryRun`, `kubernetesDryRun`, `provisionDryRun`: live에서는 모두 `false`

## 통과 기준

```txt
[ ] pnpm e2e:live exit code 0
[ ] .raibitserver-work/live-e2e-report.json 존재
[ ] liveBeta.betaChecklist 모든 값 true
[ ] buildDryRun=false
[ ] kubernetesDryRun=false
[ ] provisionDryRun=false
[ ] liveBeta.httpResults 모든 statusCode=200
[ ] liveBeta.services 모든 imageDigest 존재
```

## CI에서의 위치

수동 실행용 GitHub Actions workflow는 `.github/workflows/live-e2e.yml`에 있습니다. 기본 runner는 `self-hosted` 계열로 가정하므로 일반 PR은 dry E2E를 기본 proof로 사용합니다.

## 관련 문서

- [로컬 E2E](local-e2e.md)
- [검증 명령](verification-commands.md)
- [문제 해결](troubleshooting.md)
