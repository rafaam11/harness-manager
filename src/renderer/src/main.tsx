import React from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import App from "./App";
import { applyStoredTheme } from "./theme";
import "./theme-colors.css";
import "./index.css";

// CSP가 인라인 스크립트를 막으므로, 테마는 React가 그리기 전에 여기서 적용한다(깜빡임 방지).
applyStoredTheme();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* OS의 "애니메이션 표시" 설정을 따른다(index.css의 reduced-motion 블록과 같은 기준). */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </React.StrictMode>,
);
