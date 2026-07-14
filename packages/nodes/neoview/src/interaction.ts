import type { InteractionValues, TerminalInteractionDefinition, TerminalInteractionSchema } from "@xiranite/cli-runtime/interaction"
import type { HeadlessReaderSnapshot } from "./core.js"
import { createReaderHeadlessController } from "./platform.js"

export interface NeoviewTuiInput {
  path: string
}

export interface NeoviewTuiResult {
  success: boolean
  message: string
  snapshot?: HeadlessReaderSnapshot
}

export function createNeoviewTuiDefinition(
  language: "zh" | "en" = "zh",
): TerminalInteractionDefinition<NeoviewTuiInput, NeoviewTuiResult> {
  return {
    schema: createNeoviewTuiSchema(language),
    async run(input) {
      const controller = await createReaderHeadlessController()
      try {
        const snapshot = await controller.open({ path: input.path })
        return { success: true, message: `Opened ${snapshot.book.displayName}.`, snapshot }
      } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : String(error) }
      } finally {
        await controller[Symbol.asyncDispose]()
      }
    },
  }
}

function createNeoviewTuiSchema(language: "zh" | "en"): TerminalInteractionSchema<NeoviewTuiInput, NeoviewTuiResult> {
  const zh = language === "zh"
  return {
    id: "neoview",
    title: "NeoView",
    description: zh ? "图像与漫画阅读工作台" : "Image and comic reader workbench",
    initialValues: { path: "" },
    fields: [{
      id: "path",
      label: zh ? "书籍路径" : "Book path",
      kind: "text",
      placeholder: zh ? "图像、目录、CBZ、CBR 或 CB7" : "Image, directory, CBZ, CBR or CB7",
    }],
    toInput: (values: Readonly<InteractionValues>) => ({ path: String(values.path ?? "").trim() }),
    validate: (_values, input) => input.path ? null : zh ? "请输入书籍路径。" : "Enter a book path.",
    preview: (input) => [input.path],
    isDangerous: () => false,
    result: (result) => ({
      success: result.success,
      message: result.message,
      lines: result.snapshot ? [`${result.snapshot.book.pageCount} page(s)`] : [],
    }),
  }
}
