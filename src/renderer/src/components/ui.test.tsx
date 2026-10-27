// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Banner, StatusTag, Tabs } from "./ui";

function Harness() {
  const [value, setValue] = useState<"a" | "b" | "c">("a");
  return (
    <Tabs<"a" | "b" | "c">
      label="시험"
      value={value}
      onChange={setValue}
      items={[
        { id: "a", label: "가" },
        { id: "b", label: "나" },
        { id: "c", label: "다" },
      ]}
    />
  );
}

describe("Tabs", () => {
  it("선택한 탭만 Tab 키로 들어가고, 화살표·Home·End로 옮겨 다닌다", () => {
    render(<Harness />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
    fireEvent.keyDown(tabs[0]!, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { selected: true }).textContent).toBe("다");
    expect(document.activeElement?.textContent).toBe("다");
    fireEvent.keyDown(screen.getByRole("tab", { selected: true }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { selected: true }).textContent).toBe("가");
    fireEvent.keyDown(screen.getByRole("tab", { selected: true }), { key: "End" });
    expect(screen.getByRole("tab", { selected: true }).textContent).toBe("다");
    fireEvent.click(screen.getByText("나"));
    expect(screen.getByRole("tab", { selected: true }).textContent).toBe("나");
  });
});

describe("상태 표시", () => {
  it("상태 태그와 배너는 글자를 보이고 톤을 data 속성으로 넘긴다", () => {
    render(
      <>
        <StatusTag tone="warn">주의</StatusTag>
        <Banner tone="err">실패</Banner>
      </>,
    );
    expect(screen.getByText("주의").getAttribute("data-tone")).toBe("warn");
    expect(screen.getByRole("alert").textContent).toBe("실패");
  });
});
