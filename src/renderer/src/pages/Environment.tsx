import Dashboard from "./Dashboard";
import { Panel } from "../components/ui";
import type { PageContext } from "./registry";
export default function Environment({ navigate }: PageContext) {
  return <><Panel head="환경 관리"><p>툴체인·Claude Code·Codex·CUA·dotfiles를 진단하고 필요한 작업만 실행하세요.</p><div className="wb-detail-actions"><button className="btn" onClick={() => navigate("install")}>고급 일괄 설치</button><button className="btn" onClick={() => navigate("capture")}>PC 변경 가져오기</button><button className="btn" onClick={() => navigate("cleanup")}>정리·아카이브</button><button className="btn" onClick={() => navigate("external-api")}>외부 API</button></div></Panel><Dashboard /></>;
}
