export function Pager({ count, page, pages, onChange }: { count: number; page: number; pages: number; onChange(page: number): void }) {
  return <div className="pc-pager"><span className="muted">{count}개 · {page + 1} / {pages}쪽</span><div className="pc-inline"><button className="btn ghost" aria-label="이전 페이지" disabled={page === 0} onClick={() => onChange(page - 1)}>이전</button><button className="btn ghost" aria-label="다음 페이지" disabled={page >= pages - 1} onClick={() => onChange(page + 1)}>다음</button></div></div>;
}
