import { useEffect, useRef } from "react";

export interface LogLine {
  id: number;
  stream: "stdout" | "stderr" | "info";
  text: string;
}

/**
 * 설치 로그를 보여 주는 읽기 전용 터미널. 맨 아래를 보고 있을 때만 따라 내려간다 — 위로 올려 읽는 중에
 * 새 줄이 와도 화면이 튀지 않게. 색은 보조이고 stderr 줄은 앞에 `!`가 붙는다.
 */
export function LogTerminal({ lines, onClear }: { lines: LogLine[]; onClear?: () => void }) {
  const box = useRef<HTMLPreElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const element = box.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [lines]);

  return (
    <div className="log-terminal">
      <div className="log-terminal-head">
        <span className="muted">로그 {lines.length}줄</span>
        <span className="cleanup-toolbar-spacer" />
        {onClear && (
          <button className="btn ghost" onClick={onClear} disabled={lines.length === 0}>
            지우기
          </button>
        )}
      </div>
      <pre
        ref={box}
        className="log-terminal-body"
        onScroll={(event) => {
          const element = event.currentTarget;
          pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
        }}
      >
        {lines.length === 0 ? (
          <span className="muted">아직 로그가 없습니다.</span>
        ) : (
          lines.map((line) => (
            <span key={line.id} className={`log-line ${line.stream}`}>
              {line.stream === "stderr" ? "! " : line.stream === "info" ? "· " : "  "}
              {line.text}
              {"\n"}
            </span>
          ))
        )}
      </pre>
    </div>
  );
}
