declare module "subsrt" {
  interface ConvertOptions {
    from?: "srt" | "ass" | "ssa" | "vtt"
    to: "vtt"
  }

  interface SubsrtApi {
    convert(content: string, options: ConvertOptions): string
  }

  const api: SubsrtApi
  export = api
}
