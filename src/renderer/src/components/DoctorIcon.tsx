import type { DoctorSection } from "@shared/doctor-types";
import { Box, Cable, Code2, FileCog, Monitor, Plug, Sparkles, Wrench } from "lucide-react";
import claudeIcon from "../assets/claude.ico";
import openaiIcon from "../assets/openai.svg";

const SECTION_ICONS = { toolchain: Wrench, claude: Sparkles, codex: Code2, plugins: Plug, skills: Box, mcp: Cable, cua: Monitor, dotfiles: FileCog } satisfies Record<DoctorSection, typeof Wrench>;

export function DoctorIcon({ section }: { section: DoctorSection }) {
  const Icon = SECTION_ICONS[section];
  return <span className="doctor-icon" aria-hidden="true">{section === "claude" ? <img src={claudeIcon} alt="" /> : section === "codex" ? <img className="doctor-openai-icon" src={openaiIcon} alt="" /> : <Icon size={27} />}</span>;
}
