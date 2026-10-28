import { useEffect, useState, type ReactNode } from "react";
import { call, fmtSize, fmtDate } from "../api/client";
import { renderMarkdownSafe } from "../markdown";
import type { CatalogContent, CatalogItem, McpServer, PluginInfo } from "@shared/api-types";
import type { ProviderFilter, ProviderId } from "@shared/provider-types";
import { Banner, EmptyState, PageHeader, StatusTag, Tabs } from "../components/ui";
import { groupRowsByProvider, providerGroupLabel, providerLabel, providerToneClass, useStoredProviderFilter } from "../provider-ui";

// 좌측 종류 필터(세그먼트). skill/agent/command는 CatalogItem.kind, mcp/plugin은 별도 소스.
type KindFilter = "all" | "skill" | "agent" | "command" | "instruction" | "memory" | "mcp" | "plugin";
const SEGMENTS: { key: KindFilter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "skill", label: "Skill" },
  { key: "agent", label: "Agent" },
  { key: "command", label: "Command" },
  { key: "instruction", label: "Instruction" },
  { key: "memory", label: "Memory" },
  { key: "mcp", label: "MCP" },
  { key: "plugin", label: "Plugin" },
];
const ITEM_BADGE: Record<CatalogItem["kind"], string> = {
  skill: "SKILL",
  agent: "AGENT",
  command: "CMD",
  instruction: "INSTR",
  memory: "MEMORY",
};
const GROUP_LABEL: Record<Exclude<KindFilter, "all">, string> = {
  skill: "Skills",
  agent: "Agents",
  command: "Commands",
  instruction: "Instructions",
  memory: "Memories",
  mcp: "MCP Servers",
  plugin: "Plugins",
};

const mcpKey = (m: McpServer) => `mcp:${m.provider ?? "unknown"}:${m.scope}:${m.projectPath ?? ""}:${m.name}`;

export const CATALOG_PROVIDER_TABS: { key: ProviderFilter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "claude", label: "Claude" },
  { key: "codex", label: "Codex" },
];

export function filterCatalogItemsByProvider<T extends { provider?: ProviderId }>(
  rows: T[],
  provider: ProviderFilter,
): T[] {
  return provider === "all" ? rows : rows.filter((row) => row.provider === provider);
}

// 이전 Claude 목록은 provider가 없어 Claude로 간주한다.
export function filterCatalogPluginsByProvider<T extends { provider?: ProviderId }>(rows: T[], provider: ProviderFilter): T[] {
  return provider === "all" ? rows : rows.filter((row) => (row.provider ?? "claude") === provider);
}
const pluginKey = (p: PluginInfo) => `plugin:${p.provider ?? "claude"}:${p.id}`;

export default function Catalog() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [mcps, setMcps] = useState<McpServer[]>([]);
  const [error, setError] = useState("");
  const [visibleSkills, setVisibleSkills] = useState<{ cwd: string; skills: string[] } | null>(null);
  const [checkingSkills, setCheckingSkills] = useState(false);
  const [pluginWarnings, setPluginWarnings] = useState<string[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [content, setContent] = useState<Record<string, CatalogContent>>({});
  const [query, setQuery] = useState(() => localStorage.getItem("hm-cat-q") ?? "");
  const [kind, setKind] = useState<KindFilter>(
    () => (localStorage.getItem("hm-cat-kind") as KindFilter | null) ?? "all",
  );
  // v2부터 쓰던 저장 키를 그대로 써서 이전 선택을 이어 간다.
  const [catalogProviderFilter, setCatalogProviderFilter] = useStoredProviderFilter("hm-cat-provider");
  // 목록은 항상 전체를 받아 오고, provider 탭은 화면에서 거른다(탭마다 개수를 보여 주려고).
  useEffect(() => {
    setSelectedKey(null);
    setContent({});
    setError("");
    call("catalog:list", "all").then(setItems).catch((e) => setError(e.message));
    call("plugins:list")
      .then((d) => { setPlugins(d.plugins); setPluginWarnings(d.warnings ?? []); })
      .catch((e) => setError(e.message));
    call("mcp:list", "all").then(setMcps).catch((e) => setError(e.message));
  }, []);

  const changeQuery = (v: string) => {
    setQuery(v);
    localStorage.setItem("hm-cat-q", v);
  };
  const changeKind = (k: KindFilter) => {
    setKind(k);
    localStorage.setItem("hm-cat-kind", k);
  };
  const changeCatalogProvider = (p: ProviderFilter) => {
    setCatalogProviderFilter(p);
    setSelectedKey(null);
  };

  // 항목 선택(펼침 대체). skill/agent/command는 본문을 lazy-fetch.
  async function selectItem(key: string, path?: string) {
    setSelectedKey(key);
    if (path && !content[path]) {
      try {
        const c = await call("catalog:content", path);
        setContent((prev) => ({ ...prev, [path]: c }));
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }

  const q = query.trim().toLowerCase();
  const hit = (...parts: (string | undefined)[]) =>
    q === "" || parts.some((p) => p && p.toLowerCase().includes(q));

  const scopedItems = filterCatalogItemsByProvider(items, catalogProviderFilter);
  const scopedMcps = filterCatalogItemsByProvider(mcps, catalogProviderFilter);
  const scopedPlugins = filterCatalogPluginsByProvider(plugins, catalogProviderFilter);

  const itemRows = (k: CatalogItem["kind"]) =>
    scopedItems.filter((i) => i.kind === k && hit(i.name, i.description));
  const mcpRows = scopedMcps.filter((m) => hit(m.name, m.projectPath));
  const pluginRows = scopedPlugins.filter((p) => hit(p.id));

  const providerCounts: Record<ProviderFilter, number> = {
    all: items.length + mcps.length + plugins.length,
    claude:
      filterCatalogItemsByProvider(items, "claude").length +
      filterCatalogItemsByProvider(mcps, "claude").length +
      filterCatalogPluginsByProvider(plugins, "claude").length,
    codex:
      filterCatalogItemsByProvider(items, "codex").length +
      filterCatalogItemsByProvider(mcps, "codex").length +
      filterCatalogPluginsByProvider(plugins, "codex").length,
  };

  const counts: Record<KindFilter, number> = {
    skill: itemRows("skill").length,
    agent: itemRows("agent").length,
    command: itemRows("command").length,
    instruction: itemRows("instruction").length,
    memory: itemRows("memory").length,
    mcp: mcpRows.length,
    plugin: pluginRows.length,
    all: 0,
  };
  counts.all =
    counts.skill +
    counts.agent +
    counts.command +
    counts.instruction +
    counts.memory +
    counts.mcp +
    counts.plugin;

  const showGroup = (g: Exclude<KindFilter, "all">) => kind === "all" || kind === g;

  function itemGroup(k: CatalogItem["kind"]): ReactNode {
    const rows = itemRows(k);
    if (!showGroup(k) || rows.length === 0) return null;
    const groups =
      catalogProviderFilter === "all" ? groupRowsByProvider(rows) : [{ provider: catalogProviderFilter as ProviderId, rows }];
    return (
      <div key={k}>
        {groups.map((group) => (
          <div key={`${k}:${group.provider}`}>
            <div className="section-label">
              {GROUP_LABEL[k]}{catalogProviderFilter === "all" ? ` · ${providerGroupLabel(group.provider)}` : ""}{" "}
              <span className="count">{group.rows.length}</span>
            </div>
            {group.rows.map((it) => {
              const key = `item:${it.path}`;
              return (
                <button
                  key={it.path}
                  className={`cat-master-item${selectedKey === key ? " active" : ""}`}
                  onClick={() => selectItem(key, it.path)}
                >
                  <div className="cat-mi-head">
                    {it.provider && catalogProviderFilter === "all" && (
                      <span className={`provider-badge ${providerToneClass(it.provider)}`}>{providerLabel(it.provider)}</span>
                    )}
                    <span className={`bdg bdg-${k}`}>{ITEM_BADGE[k]}</span>
                    <span className="cat-mi-name">{it.name}</span>
                    {it.warn && <StatusTag tone="warn">경고</StatusTag>}
                  </div>
                  <div className="cat-mi-meta">
                    <span>{fmtSize(it.size)}</span>
                    <span>{fmtDate(it.mtime)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  const detail = renderDetail(selectedKey, items, mcps, plugins, content);

  return (
    <div className="cat-page">
      <PageHeader
        title="카탈로그"
        meta={`${catalogProviderFilter === "all" ? "모든 provider" : providerGroupLabel(catalogProviderFilter)} · 스킬·에이전트·명령·지침·메모리·MCP·플러그인`}
      />
      {error && <Banner tone="err">{error}</Banner>}
      {pluginWarnings.map((warning) => <Banner tone="warn" key={warning}>{warning}</Banner>)}
      {catalogProviderFilter !== "claude" && <div className="toolbar">
        <button className="btn ghost" disabled={checkingSkills} onClick={() => {
          setCheckingSkills(true);
          setError("");
          setVisibleSkills(null);
          void call("catalog:codex-visible-skills").then(setVisibleSkills).catch((caught: Error) => setError(caught.message)).finally(() => setCheckingSkills(false));
        }}>{checkingSkills ? "Codex 스킬 확인 중…" : "Codex 스킬 인식 진단"}</button>
        {visibleSkills && <details><summary>인식된 스킬 {visibleSkills.skills.length}개</summary><p className="muted">Codex 프롬프트 입력 미리보기 기준 · 폴더: {visibleSkills.cwd}. 다른 프로젝트나 이미 열린 세션의 결과는 다를 수 있습니다.</p><p>{visibleSkills.skills.join(" · ") || "인식된 스킬 없음"}</p></details>}
      </div>}

      <Tabs<ProviderFilter>
        label="provider"
        value={catalogProviderFilter}
        onChange={changeCatalogProvider}
        items={CATALOG_PROVIDER_TABS.map((tab) => ({
          id: tab.key,
          label: (
            <>
              {tab.label} <span className="count">{providerCounts[tab.key]}</span>
            </>
          ),
        }))}
      />

      <div className="cat-split">
        <div className="cat-master-col">
          <div className="cat-toolbar">
            <input
              className="search"
              type="text"
              placeholder="이름·설명 검색…"
              value={query}
              onChange={(e) => changeQuery(e.target.value)}
            />
            <div className="cat-seg">
              {SEGMENTS.map((s) => (
                <button
                  key={s.key}
                  className={`cat-seg-btn${kind === s.key ? " active" : ""}`}
                  onClick={() => changeKind(s.key)}
                >
                  {s.label} <span className="count">{counts[s.key]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="cat-master">
            {itemGroup("skill")}
            {itemGroup("agent")}
            {itemGroup("command")}
            {itemGroup("instruction")}
            {itemGroup("memory")}
            {showGroup("mcp") && mcpRows.length > 0 && (
              <div>
                {(catalogProviderFilter === "all"
                  ? groupRowsByProvider(mcpRows)
                  : [{ provider: catalogProviderFilter as ProviderId, rows: mcpRows }]
                ).map((group) => (
                  <div key={`mcp:${group.provider}`}>
                    <div className="section-label">
                      {GROUP_LABEL.mcp}{catalogProviderFilter === "all" ? ` · ${providerGroupLabel(group.provider)}` : ""}{" "}
                      <span className="count">{group.rows.length}</span>
                    </div>
                    {group.rows.map((m) => {
                      const key = mcpKey(m);
                      return (
                        <button
                          key={key}
                          className={`cat-master-item${selectedKey === key ? " active" : ""}`}
                          onClick={() => selectItem(key)}
                        >
                          <div className="cat-mi-head">
                            {m.provider && catalogProviderFilter === "all" && (
                              <span className={`provider-badge ${providerToneClass(m.provider)}`}>{providerLabel(m.provider)}</span>
                            )}
                            <span className="bdg bdg-mcp">MCP</span>
                            <span className="cat-mi-name">{m.name}</span>
                            <span className="t-tag">{m.transport}</span>
                          </div>
                          <div className="cat-mi-meta">
                            <span>{m.scope === "project" ? `project: ${m.projectPath}` : "user scope"}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
            {showGroup("plugin") && pluginRows.length > 0 && (
              <div>
                <div className="section-label">
                  {GROUP_LABEL.plugin}{" "}
                  <span className="count">{pluginRows.length}</span>
                </div>
                {pluginRows.map((p) => {
                  const key = pluginKey(p);
                  return (
                    <button
                      key={key}
                      className={`cat-master-item${selectedKey === key ? " active" : ""}`}
                      onClick={() => selectItem(key)}
                    >
                      <div className="cat-mi-head">
                        <span className={`provider-badge ${providerToneClass(p.provider ?? "claude")}`}>{providerLabel(p.provider ?? "claude")}</span>
                        <span className="bdg bdg-plugin">PLUGIN</span>
                        <span className="cat-mi-name">{p.id}</span>
                        {p.enabledInSettings === true && <StatusTag tone="ok">켜짐</StatusTag>}
                        {p.enabledInSettings === false && <StatusTag tone="warn">꺼짐</StatusTag>}
                        {p.blocked && <StatusTag tone="warn">차단</StatusTag>}
                      </div>
                      <div className="cat-mi-meta">
                        <span>
                          {p.installs.map((i) => `${i.scope} v${i.version}`).join(", ") || "설치 정보 없음"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            {counts.all === 0 && (
              <EmptyState>
                {items.length + mcps.length + plugins.length === 0 ? "불러오는 중…" : "일치하는 항목이 없습니다."}
              </EmptyState>
            )}
          </div>
        </div>

        <div className="panel cat-detail-panel">{detail}</div>
      </div>
    </div>
  );
}

function renderDetail(
  selectedKey: string | null,
  items: CatalogItem[],
  mcps: McpServer[],
  plugins: PluginInfo[],
  content: Record<string, CatalogContent>,
): ReactNode {
  if (!selectedKey) return <EmptyState>왼쪽에서 항목을 선택하세요.</EmptyState>;
  if (selectedKey.startsWith("item:")) {
    const it = items.find((i) => `item:${i.path}` === selectedKey);
    if (it) return <ItemDetail it={it} data={content[it.path]} />;
  } else if (selectedKey.startsWith("mcp:")) {
    const m = mcps.find((x) => mcpKey(x) === selectedKey);
    if (m) return <McpDetail m={m} />;
  } else if (selectedKey.startsWith("plugin:")) {
    const p = plugins.find((x) => pluginKey(x) === selectedKey);
    if (p) return <PluginDetail p={p} />;
  }
  return <EmptyState>항목을 찾을 수 없습니다.</EmptyState>;
}

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn ghost cat-copy"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1200);
          },
          () => {},
        );
      }}
    >
      {done ? "복사됨" : "복사"}
    </button>
  );
}

function ItemDetail({ it, data }: { it: CatalogItem; data?: CatalogContent }) {
  return (
    <div className="cat-detail">
      <div className="cat-detail-title">
        {it.provider && <span className={`provider-badge ${providerToneClass(it.provider)}`}>{providerGroupLabel(it.provider)}</span>}
        <span className={`bdg bdg-${it.kind}`}>{ITEM_BADGE[it.kind]}</span>
        <span className="cat-detail-name">{it.name}</span>
      </div>
      <div className="cat-path mono">
        {it.path}
        <CopyBtn text={it.path} />
      </div>
      {!data ? (
        <div className="muted cat-detail-loading">불러오는 중…</div>
      ) : (
        <>
          <div className="cat-detail-meta">
            {fmtSize(data.size)} · 수정 {fmtDate(data.mtime)}
            {data.truncated && " · (대형 파일 일부만 표시)"}
          </div>
          {Object.keys(data.frontmatter ?? {}).length > 0 && (
            <div className="fm-table">
              <div className="section-label">Frontmatter</div>
              {Object.keys(data.frontmatter).map((k) => {
                const v = data.frontmatter[k];
                const text = Array.isArray(v)
                  ? v.join(", ")
                  : typeof v === "object" && v !== null
                    ? JSON.stringify(v)
                    : String(v);
                return (
                  <div className="fm-row" key={k}>
                    <span className="fm-k">{k}</span>
                    <span className="fm-v mono">{text}</span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="section-label">본문</div>
          <div
            className="md-body"
            dangerouslySetInnerHTML={{ __html: renderMarkdownSafe(data.raw) }}
          />
        </>
      )}
    </div>
  );
}

function McpDetail({ m }: { m: McpServer }) {
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const secretRow = (k: string, v: string) => (
    <div className="fm-row" key={k}>
      <span className="fm-k">{k}</span>
      <span className="fm-v mono">{reveal[k] ? v : "••••••••••••"}</span>
      <button
        type="button"
        className="btn ghost cat-reveal"
        aria-label={reveal[k] ? `${k} 값 가리기` : `${k} 값 보기`}
        onClick={() => setReveal((p) => ({ ...p, [k]: !p[k] }))}
      >
        {reveal[k] ? "가리기" : "보기"}
      </button>
    </div>
  );
  return (
    <div className="cat-detail">
      <div className="cat-detail-title">
        {m.provider && <span className={`provider-badge ${providerToneClass(m.provider)}`}>{providerGroupLabel(m.provider)}</span>}
        <span className="bdg bdg-mcp">MCP</span>
        <span className="cat-detail-name">{m.name}</span>
        <span className="t-tag">{m.transport}</span>
      </div>
      <div className="cat-path mono">
        {m.provider === "codex" ? "~/.codex/config.toml" : "~/.claude.json"} · {m.scope === "project" ? m.projectPath : "user scope"}
      </div>
      <div className="section-label">연결</div>
      {m.command && (
        <div className="fm-row">
          <span className="fm-k">command</span>
          <span className="fm-v mono">{m.command}</span>
        </div>
      )}
      {m.args && (
        <div className="fm-row">
          <span className="fm-k">args</span>
          <span className="fm-v mono">{m.args.join(" ")}</span>
        </div>
      )}
      {m.url && (
        <div className="fm-row">
          <span className="fm-k">url</span>
          <span className="fm-v mono">{m.url}</span>
        </div>
      )}
      {m.env && Object.keys(m.env).length > 0 && (
        <>
          <div className="section-label">env</div>
          {Object.entries(m.env).map(([k, v]) => secretRow(k, String(v)))}
        </>
      )}
      {m.headers && Object.keys(m.headers).length > 0 && (
        <>
          <div className="section-label">headers</div>
          {Object.entries(m.headers).map(([k, v]) => secretRow(k, String(v)))}
        </>
      )}
    </div>
  );
}

function PluginDetail({ p }: { p: PluginInfo }) {
  return (
    <div className="cat-detail">
      <div className="cat-detail-title">
        <span className="bdg bdg-plugin">PLUGIN</span>
        <span className="cat-detail-name">{p.id}</span>
      </div>
      {p.provider === "codex" && <>
        <p className="muted">Codex CLI의 설치 목록입니다. 활성 상태는 현재 세션의 스킬 인식이나 hook 신뢰를 보장하지 않습니다. 변경 후 새 세션에서 확인하세요.</p>
        <p className="muted">원본을 바꿨는데 스킬이 보이지 않으면 마켓플레이스 소스를 확인하세요. Git 소스는 먼저 마켓플레이스를 갱신한 뒤 아래 명령으로 설치 캐시를 갱신하세요.</p>
        <div className="install-action mono">codex plugin add {p.id}</div>
      </>}
      <div className="section-label">상태</div>
      <div className="fm-row">
        <span className="fm-k">설정 활성</span>
        <span className="fm-v mono">
          {p.enabledInSettings === null ? "프로젝트 레벨" : p.enabledInSettings ? "enabled" : "disabled"}
        </span>
      </div>
      <div className="fm-row">
        <span className="fm-k">차단</span>
        <span className="fm-v mono">{p.blocked ? "blocked" : "no"}</span>
      </div>
      <div className="section-label">설치 ({p.installs.length})</div>
      {p.installs.map((i, idx) => (
        <div className="fm-row" key={idx}>
          <span className="fm-k">{i.scope}</span>
          <span className="fm-v mono">
            {i.projectPath ? `${i.projectPath} · ` : ""}v{i.version}
          </span>
        </div>
      ))}
      {p.installs.length === 0 && <div className="muted">설치 기록 없음</div>}
    </div>
  );
}
