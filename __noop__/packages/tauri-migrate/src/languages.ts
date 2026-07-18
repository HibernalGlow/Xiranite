import rustRegistration from "@ast-grep/lang-rust"
import { Lang, registerDynamicLanguage } from "@ast-grep/napi"

registerDynamicLanguage({ rust: rustRegistration })

export type MigrationLanguage = "javascript" | "rust" | "tsx" | "typescript"

export function toNapiLanguage(language: MigrationLanguage): Lang | "rust" {
  switch (language) {
    case "javascript": return Lang.JavaScript
    case "rust": return "rust"
    case "tsx": return Lang.Tsx
    case "typescript": return Lang.TypeScript
  }
}
