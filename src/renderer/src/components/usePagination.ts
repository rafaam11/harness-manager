import { useEffect, useRef, useState } from "react";

/** 화면 높이에 맞춰 행 수를 바꿔 목록 아래의 작업 버튼을 항상 남긴다. */
export function usePagination(count: number, key = "") {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(10);
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(count / size));
  useEffect(() => {
    const element = ref.current; if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize(Math.max(1, Math.floor(entry!.contentRect.height / 36))));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => setPage(0), [key]);
  useEffect(() => setPage(current => Math.min(current, pages - 1)), [pages]);
  return { ref, size, page, pages, setPage, start: Math.min(page, pages - 1) * size };
}
