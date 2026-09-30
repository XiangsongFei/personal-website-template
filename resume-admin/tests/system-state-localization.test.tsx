import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { UiLocaleProvider, UI_LOCALE_KEY, useUiLocale } from "../src/uiLocale";

const stateCopy: Array<[string, string]> = [
  ["Loading resume content…", "正在加载简历内容……"],
  ["Reading the current example-cv content.", "正在读取当前简历内容。"],
  ["Unable to load resume content", "无法加载简历内容"],
  ["The production resume could not be loaded. No fixture content has been substituted.", "无法加载当前简历数据，系统未使用示例内容替代。"],
  ["Loading complete resume preview…", "正在加载完整简历预览……"],
  ["The complete resume preview is unavailable because its data could not be loaded.", "无法加载完整简历预览，因为预览数据读取失败。"],
  ["Section not found", "未找到模块"],
  ["Choose a CMS section from the navigation.", "请从导航中选择一个 CMS 模块。"],
  ["Return to Overview", "返回概览"],
  ["Loading section text…", "正在加载板块文案…"],
  ["Unable to load section text.", "无法加载板块文案。"],
  ["Checking access", "正在检查访问权限"],
  ["Please wait while your session and admin access are verified.", "正在验证会话和管理员权限，请稍候。"],
  ["Access denied", "访问被拒绝"],
  ["This account is not authorized to edit this resume.", "此账户无权编辑此简历。"],
  ["Unable to check access", "无法检查访问权限"],
  ["The session or administrator check failed. Please retry.", "会话或管理员检查失败，请重试。"],
  ["Configuration required", "需要配置"],
  ["Admin setup is incomplete. Please contact the administrator.", "管理后台尚未完成配置，暂时无法打开。请联系网站管理员。"],
  ["Retry", "重试"],
  ["Unable to sign out. Please try again.", "退出登录失败，请重试。"],
  ["Welcome back", "欢迎回来"],
  ["Sign in to continue managing your resume.", "登录以继续管理你的简历内容。"],
  ["Enter your email", "请输入邮箱"],
  ["Enter your password", "请输入密码"],
  ["Email", "邮箱"],
  ["Password", "密码"],
  ["Signing in…", "正在登录…"],
  ["Unable to sign in. Check your email and password.", "登录失败，请检查邮箱和密码。"],
  ["Sign in", "登录"],
  ["Sign Out", "退出登录"],
  ["Set the local Supabase URL and publishable key to use the admin app.", "请设置本地 Supabase URL 和 publishable key 以使用管理后台。"],
  ["Loading Overview...", "正在加载概览……"],
  ["Unable to load Overview.", "无法加载概览。"],
  ["Loading Profile…", "正在加载个人资料……"],
  ["Unable to load Profile.", "无法加载个人资料。"],
  ["Loading Education...", "正在加载教育经历……"],
  ["Unable to load Education.", "无法加载教育经历。"],
  ["Loading Introduction...", "正在加载个人简介……"],
  ["Unable to load Introduction.", "无法加载个人简介。"],
  ["Loading Experience...", "正在加载工作经历……"],
  ["Unable to load Experience.", "无法加载工作经历。"],
  ["Loading Projects...", "正在加载项目经历……"],
  ["Unable to load Projects.", "无法加载项目经历。"],
  ["Loading Skills...", "正在加载技能……"],
  ["Unable to load Skills.", "无法加载技能。"],
  ["Loading Awards...", "正在加载荣誉奖项……"],
  ["Unable to load Awards.", "无法加载荣誉奖项。"],
  ["Loading Contact...", "正在加载联系信息……"],
  ["Unable to load Contact.", "无法加载联系信息。"],
  ["Loading Links & Site Text...", "正在加载链接与网站文本……"],
  ["Unable to load Links & Site Text.", "无法加载链接与网站文本。"],
  ["Loading Profile preview…", "正在加载个人资料预览……"],
  ["Profile preview is unavailable because its data could not be loaded.", "个人资料预览不可用，因为无法加载对应数据。"],
  ["Loading Education preview…", "正在加载教育经历预览……"],
  ["Education preview is unavailable because its data could not be loaded.", "教育经历预览不可用，因为无法加载对应数据。"],
  ["Loading Introduction preview…", "正在加载个人简介预览……"],
  ["Introduction preview is unavailable because its data could not be loaded.", "个人简介预览不可用，因为无法加载对应数据。"],
  ["Loading Experience preview…", "正在加载工作经历预览……"],
  ["Experience preview is unavailable because its data could not be loaded.", "工作经历预览不可用，因为无法加载对应数据。"],
  ["Loading Projects preview…", "正在加载项目经历预览……"],
  ["Projects preview is unavailable because its data could not be loaded.", "项目经历预览不可用，因为无法加载对应数据。"],
  ["Loading Skills preview…", "正在加载技能预览……"],
  ["Skills preview is unavailable because its data could not be loaded.", "技能预览不可用，因为无法加载对应数据。"],
];

function TranslationProbe({ texts }: { texts: string[] }) {
  const { t } = useUiLocale();
  return <div>{texts.map((text, index) => <span key={`${index}-${text}`}>{t(text)}</span>)}</div>;
}

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(UI_LOCALE_KEY);
});

describe("Admin system-state localization", () => {
  it("translates all audited system, route-loading, and Preview status copy in Chinese", () => {
    window.localStorage.setItem(UI_LOCALE_KEY, "zh");
    const view = render(<UiLocaleProvider><TranslationProbe texts={stateCopy.map(([source]) => source)} /></UiLocaleProvider>);
    expect(Array.from(view.container.querySelectorAll("span"), node => node.textContent)).toEqual(stateCopy.map(([, translation]) => translation));
  });

  it("keeps the original English copy unchanged", () => {
    const view = render(<UiLocaleProvider><TranslationProbe texts={stateCopy.map(([source]) => source)} /></UiLocaleProvider>);
    expect(Array.from(view.container.querySelectorAll("span"), node => node.textContent)).toEqual(stateCopy.map(([source]) => source));
  });
});
