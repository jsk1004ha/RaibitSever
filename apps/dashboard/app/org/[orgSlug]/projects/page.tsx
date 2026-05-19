export default function ProjectsPage({ params }: { params: { orgSlug: string } }) {
  return (
    <main style={{ padding: 32 }}>
      <h1>Workspace: {params.orgSlug}</h1>
      <p>프로젝트, 서비스, 리소스, 사용량, 팀 권한을 관리하는 화면입니다.</p>
    </main>
  );
}
