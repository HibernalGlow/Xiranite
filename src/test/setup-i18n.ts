/**
 * Vitest 全局 setup — 强制中文环境
 *
 * 测试用例的断言基于中文 UI 文本（如 "扫描路径"、"关键开关"），
 * 但 happy-dom 的 navigator.language 默认 "en-US"，i18n 会初始化为英文。
 * 此文件在测试模块导入前强制切换为中文，匹配测试期望。
 */
import i18n from "@/i18n"

// 直接同步调用——setup 文件在测试模块导入前执行
void i18n.changeLanguage("zh")
