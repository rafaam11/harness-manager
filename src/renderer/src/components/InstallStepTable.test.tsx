// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { InstallStep, InstallStepResult } from "@shared/install-types";
import InstallStepTable from "./InstallStepTable";

const git: InstallStep = {
  id: "packages.winget.git",
  section: "toolchain",
  title: "Git",
  state: "missing",
  detail: "PATH에 없음",
  actionable: true,
  manual: false,
  actions: [
    { kind: "command", summary: "winget install Git.Git" },
    { kind: "file", summary: "~/.gitconfig 관리 키 병합", diff: "+name = me" },
  ],
};
const node: InstallStep = {
  id: "packages.winget.nvm",
  section: "toolchain",
  title: "Node",
  state: "drift",
  detail: "버전이 낮음",
  actionable: true,
  manual: false,
  actions: [{ kind: "command", summary: "nvm install 22" }],
};
const cua: InstallStep = {
  id: "tools.cua-driver",
  section: "cua",
  title: "cua-driver",
  state: "missing",
  detail: "설치 위치를 찾지 못함",
  actionable: false,
  manual: true,
  actions: [{ kind: "manual", summary: "릴리스 페이지에서 직접 설치" }],
};
const steps = [git, node, cua];

function Selectable({ onChange, disabled }: { onChange?: (next: Set<string>) => void; disabled?: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  return <InstallStepTable steps={steps} selection={{ selected, disabled, onChange: (next) => { setSelected(next); onChange?.(next); } }} />;
}

afterEach(cleanup);

it("gives the shared columns one header row and uses the section label", () => {
  render(<InstallStepTable steps={[git]} />);
  expect(screen.getAllByRole("columnheader").map((head) => head.textContent)).toEqual(["구분", "항목", "상태", "내용", ""]);
  expect(screen.getByRole("cell", { name: "툴체인" })).toBeTruthy();
  expect(screen.getByRole("cell", { name: "PATH에 없음" })).toBeTruthy();
});

it("selects single rows and every runnable step, but never a manual one", () => {
  const onChange = vi.fn();
  render(<Selectable onChange={onChange} />);
  expect(screen.getByRole("checkbox", { name: "cua-driver 선택" })).toBeDisabled();

  fireEvent.click(screen.getByRole("checkbox", { name: "Git 선택" }));
  expect([...onChange.mock.lastCall![0]]).toEqual([git.id]);
  expect(screen.getByRole("checkbox", { name: "실행할 수 있는 step 전체" })).not.toBeChecked();

  fireEvent.click(screen.getByRole("checkbox", { name: "실행할 수 있는 step 전체" }));
  expect([...onChange.mock.lastCall![0]]).toEqual([git.id, node.id]);
  expect(screen.getByRole("checkbox", { name: "실행할 수 있는 step 전체" })).toBeChecked();

  fireEvent.click(screen.getByRole("checkbox", { name: "실행할 수 있는 step 전체" }));
  expect(onChange.mock.lastCall![0].size).toBe(0);
});

it("locks every checkbox while a run is in progress", () => {
  render(<Selectable disabled />);
  for (const box of screen.getAllByRole("checkbox")) expect(box).toBeDisabled();
});

it("opens manual steps by default because the instructions are the task", () => {
  render(<InstallStepTable steps={steps} />);
  expect(screen.getByRole("button", { name: "cua-driver 상세 닫기" })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText(/릴리스 페이지에서 직접 설치/)).toBeTruthy();
  expect(screen.getByText("직접 해야 함")).toBeTruthy();
  // 펼치지 않은 행의 명령은 아직 보이지 않는다.
  expect(screen.queryByText(/winget install Git\.Git/)).toBeNull();
});

it("shows commands, file diffs and the step id when a row is expanded", () => {
  render(<InstallStepTable steps={[git]} />);
  fireEvent.click(screen.getByRole("button", { name: "Git 상세 열기" }));
  expect(screen.getByText(git.id)).toBeTruthy();
  expect(screen.getByText(/\$ winget install Git\.Git/)).toBeTruthy();
  expect(screen.getByText("+name = me")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Git 상세 닫기" }));
  expect(screen.queryByText(git.id)).toBeNull();
});

it("replaces the content with the failure and adds a result column only after a run", () => {
  const result: InstallStepResult = { id: git.id, outcome: "failed", after: "missing", detail: "winget 종료 코드 1" };
  const { rerender } = render(<InstallStepTable steps={[git]} />);
  expect(screen.queryByRole("columnheader", { name: "결과" })).toBeNull();
  rerender(<InstallStepTable steps={[git]} results={{ [git.id]: result }} />);
  expect(screen.getByRole("columnheader", { name: "결과" })).toBeTruthy();
  expect(screen.getByText("실패")).toBeTruthy();
  expect(screen.getByRole("cell", { name: "winget 종료 코드 1" })).toBeTruthy();
  expect(screen.queryByText("PATH에 없음")).toBeNull();
});

it("summarizes the first action for the wizard preview", () => {
  render(<InstallStepTable steps={[git, node]} summary="action" />);
  expect(screen.getByRole("cell", { name: "winget install Git.Git 외 1개" })).toBeTruthy();
  expect(screen.getByRole("cell", { name: "nvm install 22" })).toBeTruthy();
  expect(screen.queryByRole("checkbox")).toBeNull();
});
