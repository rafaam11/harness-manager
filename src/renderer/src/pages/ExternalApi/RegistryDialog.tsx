import { useEffect } from "react";
import type { Catalog } from "@shared/external-api/schema";
import { call } from "../../api/client";
import { formatDomains, formatSkillCategory, formatTechnologyCategory } from "../../external-api/labels";
import type { RegistryKind, RegistryView } from "../../external-api/registry";
import { StatusMark } from "./StatusMark";

const kindLabels: Record<RegistryKind, string> = { source: "정보원", skill: "k-skill", blueprint: "청사진", technology: "기술" };

type Props = {
  catalog: Catalog;
  view: RegistryView | null;
  /** 앞 기록으로 돌아갈 수 있으면 true. */
  canGoBack: boolean;
  onOpen(view: RegistryView): void;
  onBack(): void;
  onClose(): void;
};

/** 외부 링크는 앱 안에서 열지 않고 OS 브라우저로 넘긴다(main이 http(s)만 허용). */
function External({ href, children }: { href: string; children: string }) {
  return (
    <button type="button" className="btn ghost" onClick={() => void call("app:open-external", href)}>
      {children} ↗
    </button>
  );
}

function Relations({ title, items, onOpen }: { title: string; items: { view: RegistryView; name: string }[]; onOpen(view: RegistryView): void }) {
  return (
    <div className="ext-relations">
      <dt>{title}</dt>
      <dd>
        {items.length === 0 ? (
          <span className="muted">연결 기록 없음</span>
        ) : (
          items.map((item) => (
            <button type="button" key={`${item.view.kind}:${item.view.id}`} onClick={() => onOpen(item.view)}>
              {item.name}
            </button>
          ))
        )}
      </dd>
    </div>
  );
}

/**
 * 기록 하나의 상세. jk-external-api의 상세 페이지와 대화상자를 합쳤다 — 앱에는 라우트가 없으므로 연결 항목은
 * 같은 대화상자에서 열고, "뒤로"로 앞 기록에 돌아간다.
 */
export default function RegistryDialog({ catalog, view, canGoBack, onOpen, onBack, onClose }: Props) {
  useEffect(() => {
    if (!view) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, onClose]);

  if (!view) return null;
  const source = view.kind === "source" ? catalog.sources.find(({ id }) => id === view.id) : undefined;
  const skill = view.kind === "skill" ? catalog.skills.find(({ id }) => id === view.id) : undefined;
  const blueprint = view.kind === "blueprint" ? catalog.blueprints.find(({ id }) => id === view.id) : undefined;
  const technology = view.kind === "technology" ? catalog.technologies.find(({ id }) => id === view.id) : undefined;
  const title = source?.name ?? skill?.name ?? blueprint?.name ?? technology?.name ?? view.id;
  const summary = source?.summary ?? skill?.description ?? blueprint?.problem ?? technology?.summary ?? "";
  const sourceItems = (ids: (id: string) => boolean) =>
    catalog.sources.filter((item) => ids(item.id)).map((item) => ({ view: { kind: "source" as const, id: item.id }, name: item.name }));

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="ext-dialog" role="dialog" aria-modal="true" aria-labelledby="ext-dialog-title">
        <div className="ext-dialog-head">
          <span className="tag muted">{kindLabels[view.kind]}</span>
          <code className="mono muted">{view.id}</code>
          <span className="cleanup-toolbar-spacer" />
          {canGoBack && (
            <button type="button" className="btn ghost" onClick={onBack}>
              뒤로
            </button>
          )}
          <button type="button" className="btn ghost" onClick={onClose} aria-label="닫기">
            닫기
          </button>
        </div>
        <h2 id="ext-dialog-title">{title}</h2>
        <p className="muted">{summary}</p>

        {source && (
          <>
            <div className="ext-status-row">
              <StatusMark kind="auth" value={source.auth} />
              <StatusMark kind="freshness" value={source.updateFrequency} />
            </div>
            <dl className="ext-facts">
              <div><dt>운영기관</dt><dd>{source.operator}</dd></div>
              <div><dt>분야</dt><dd>{formatDomains(source.domains)}</dd></div>
              <div><dt>제공 방식</dt><dd>{source.delivery.join(" · ")}</dd></div>
              <div><dt>형식</dt><dd>{source.formats.join(" · ")}</dd></div>
              <div><dt>비용</dt><dd>{source.cost}</dd></div>
              <div><dt>CORS</dt><dd>{source.cors}</dd></div>
              <div><dt>지역</dt><dd>{source.geography.join(" · ")}</dd></div>
              <div><dt>확인일</dt><dd>{source.lastVerifiedAt}</dd></div>
            </dl>
            <h3>데이터 명세</h3>
            <div className="ext-datasheets">
              {source.data.map((dataset) => (
                <div key={dataset.name}>
                  <strong>{dataset.name}</strong>
                  <span className="muted">{dataset.fields.join(" · ")}</span>
                </div>
              ))}
            </div>
            <dl className="ext-facts">
              <Relations title="k-skill" items={catalog.skills.filter((item) => item.sourceIds.includes(source.id)).map((item) => ({ view: { kind: "skill", id: item.id }, name: item.name }))} onOpen={onOpen} />
              <Relations title="청사진" items={catalog.blueprints.filter((item) => item.sourceIds.includes(source.id)).map((item) => ({ view: { kind: "blueprint", id: item.id }, name: item.name }))} onOpen={onOpen} />
              <Relations title="기술" items={catalog.technologies.filter((item) => source.technologyIds.includes(item.id)).map((item) => ({ view: { kind: "technology", id: item.id }, name: item.name }))} onOpen={onOpen} />
            </dl>
            <div className="ext-dialog-links">
              <External href={source.officialUrl}>공식 서비스</External>
              <External href={source.docsUrl}>개발 문서</External>
              <External href={source.termsUrl}>이용조건</External>
            </div>
          </>
        )}

        {skill && (
          <>
            <dl className="ext-facts">
              <div><dt>분류</dt><dd>{formatSkillCategory(skill.category)}</dd></div>
              <div><dt>실행 환경</dt><dd>{skill.runtimes.join(" · ") || "문서 확인"}</dd></div>
              <div><dt>인증 단서</dt><dd>{skill.auth.join(" · ") || "없음"}</dd></div>
              <Relations title="연결 정보원" items={sourceItems((id) => skill.sourceIds.includes(id))} onOpen={onOpen} />
            </dl>
            <div className="ext-dialog-links">
              <External href={skill.upstreamUrl}>공식 원문</External>
            </div>
          </>
        )}

        {blueprint && (
          <>
            <dl className="ext-facts">
              <div><dt>사용자</dt><dd>{blueprint.users.join(" · ")}</dd></div>
              <div><dt>입력</dt><dd>{blueprint.inputs.join(" · ")}</dd></div>
              <div><dt>출력</dt><dd>{blueprint.outputs.join(" · ")}</dd></div>
              <div><dt>흐름</dt><dd>{blueprint.flow.join(" → ")}</dd></div>
              <div><dt>스택</dt><dd>{blueprint.stack.join(" · ")}</dd></div>
              <div><dt>MVP 단계</dt><dd>{blueprint.mvpSteps.join(" → ")}</dd></div>
              <div><dt>위험</dt><dd>{blueprint.risks.join(" · ")}</dd></div>
              <div><dt>개인정보</dt><dd>{blueprint.privacy.join(" · ")}</dd></div>
              <div><dt>대체 경로</dt><dd>{blueprint.fallback.join(" · ")}</dd></div>
              <Relations title="연결 정보원" items={sourceItems((id) => blueprint.sourceIds.includes(id))} onOpen={onOpen} />
            </dl>
            <details className="capture-file">
              <summary>예제 코드(Node·Python)</summary>
              <pre className="capture-diff">{blueprint.examples.node}</pre>
              <pre className="capture-diff">{blueprint.examples.python}</pre>
            </details>
          </>
        )}

        {technology && (
          <dl className="ext-facts">
            <div><dt>분류</dt><dd>{formatTechnologyCategory(technology.category)}</dd></div>
            <Relations title="연결 정보원" items={sourceItems((id) => catalog.sources.find((item) => item.id === id)!.technologyIds.includes(technology.id))} onOpen={onOpen} />
            <Relations
              title="k-skill"
              items={catalog.skills.filter((item) => item.technologyIds.includes(technology.id)).map((item) => ({ view: { kind: "skill", id: item.id }, name: item.name }))}
              onOpen={onOpen}
            />
          </dl>
        )}
      </div>
    </div>
  );
}
