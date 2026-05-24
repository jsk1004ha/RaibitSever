const raibitDefaults = {
  theme: "dark"
};

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("raibit-theme", theme);
}

function initTheme() {
  const saved = localStorage.getItem("raibit-theme") || raibitDefaults.theme;
  setTheme(saved);
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      setTheme(next);
    });
  });
}

function initTabs() {
  document.querySelectorAll("[data-tabs]").forEach((tabs) => {
    const buttons = tabs.querySelectorAll("[data-tab]");
    const targetRoot = document.querySelector(tabs.dataset.tabs);
    if (!targetRoot) return;
    const panels = targetRoot.querySelectorAll("[data-panel]");
    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        buttons.forEach((item) => item.classList.remove("active"));
        panels.forEach((panel) => panel.hidden = true);
        button.classList.add("active");
        const panel = targetRoot.querySelector(`[data-panel="${button.dataset.tab}"]`);
        if (panel) panel.hidden = false;
      });
    });
  });
}

function initQueryGuard() {
  const query = document.querySelector("[data-query-input]");
  const result = document.querySelector("[data-query-result]");
  const run = document.querySelector("[data-run-query]");
  if (!query || !result || !run) return;
  run.addEventListener("click", () => {
    const value = query.value.trim().toLowerCase();
    const destructive = ["delete", "drop", "truncate", "alter", "update", "insert", "vacuum", "attach", "detach"].some((word) => value.includes(word));
    if (destructive) {
      result.textContent = "Blocked: 이 콘솔은 기본적으로 read-only입니다. 파괴적 명령은 별도 승인 모달과 audit log가 필요합니다.";
      result.classList.add("danger");
      return;
    }
    result.classList.remove("danger");
    result.textContent = "3 rows returned in 42ms · query limit 100 · connection secret remained masked";
  });
}

function initStepFlow() {
  const steps = document.querySelectorAll("[data-step]");
  const next = document.querySelector("[data-next-step]");
  if (!steps.length || !next) return;
  let current = 0;
  next.addEventListener("click", () => {
    steps[current].hidden = true;
    current = Math.min(current + 1, steps.length - 1);
    steps[current].hidden = false;
    next.textContent = current === steps.length - 1 ? "프로젝트 생성" : "다음 단계";
  });
}

function initApproval() {
  document.querySelectorAll("[data-approve]").forEach((button) => {
    button.addEventListener("click", () => {
      const row = button.closest("tr");
      const status = row.querySelector("[data-status]");
      status.textContent = "승인됨";
      status.className = "badge ok";
      button.textContent = "쿼터 편집";
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initTabs();
  initQueryGuard();
  initStepFlow();
  initApproval();
});
