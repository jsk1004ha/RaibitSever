# 승인과 쿼터

> RAIBITSERVER는 사용자 유형과 관리자 승인 상태에 따라 project, service, deployment, resource 사용량을 제한합니다.

## 목적

이 문서는 사용자 승인 흐름, club member 예외, runtime quota accounting 범위를 설명합니다.

## 사용자 상태

첫 auth 사용자(이메일/비밀번호 signup 또는 deterministic GitHub callback)는 자동으로 `ADMIN` + `CLUB_MEMBER` + `APPROVED`가 됩니다. `ADMIN_EMAILS`는 운영자가 사전에 지정한 이메일을 같은 관리자 bootstrap 경로로 승인하는 fallback입니다. GitHub deterministic callback의 이메일 기반 계정 생성/연동은 production에서 기본 비활성화되며, 로컬/베타 검증 또는 `RAIBITSERVER_GITHUB_OAUTH_LOCAL_CALLBACK=1`일 때만 사용합니다.

| 사용자 | 기본 상태 | 사용 가능 범위 |
| --- | --- | --- |
| `ADMIN` | 승인됨 | 모든 사용자, 프로젝트, 리소스 관리 |
| `CLUB_MEMBER` | 승인됨 | user-facing quota는 무제한, hard safety cap은 적용 |
| `NON_CLUB` | `PENDING` | 관리자 승인 전 생성/배포/provision 차단 |
| `NON_CLUB + APPROVED` | 승인됨 | `Quota` row 범위 안에서 사용 |

## 차단 대상 작업

`PENDING` 또는 quota 초과 사용자는 다음 작업이 차단됩니다.

- project 생성
- service 생성
- deployment 생성
- resource 생성
- preview deployment 생성

Quota block은 403/429 계열 오류로 응답하고 in-memory/prod persistence path 모두 audit log에 기록합니다.

## Runtime quota accounting

현재 runtime 사용량은 다음 항목을 포함합니다.

- project 수
- service 수
- 일별 deployment 수
- preview deployment 수
- DB storage MB
- object storage MB
- 월별 build minutes
- 월별 runtime hours
- aggregate service CPU requests (millicores)
- aggregate service memory requests (MB)

## Plan model과 DB field 매핑

`packages/core/src/quota.ts`의 plan-time quota 이름은 공개 plan model입니다.

```txt
apps
projects
dbStorageGb
buildMinutesMonthly
```

Runtime enforcement는 이를 `Quota` row field에 매핑합니다.

```txt
maxServices
maxProjects
maxDbStorageMb
maxBuildMinutesPerMonth
maxRuntimeHoursPerMonth
```

## 로컬 검증

`pnpm e2e:dry`는 다음을 확인합니다.

- pending non-club 사용자는 project 생성이 차단됩니다.
- 첫 auth 사용자는 admin으로 bootstrap됩니다.
- admin approve 후 quota 설정으로 사용이 가능해집니다.
- build/runtime/resource 사용량 evidence가 기록됩니다.
- club member는 non-club quota보다 많은 service 생성이 가능합니다.

## 관련 문서

- [보안](security.md)
- [로컬 E2E](local-e2e.md)
- [Closed Beta 기준](beta-criteria.md)
