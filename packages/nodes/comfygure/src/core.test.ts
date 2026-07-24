import { describe, expect, it, vi } from "vitest"
import { compileAnimaInt8Program, compileAnimaInt8RunPlan, DEFAULT_COMFYUI_REQUEST_TIMEOUT_MS, normalizeComfyuiEndpoint, normalizePromptText, preflightComfyuiTarget, resolveBatchSequence, runComfygure } from "./core.js"

describe("Comfygure ANIMA INT8 compiler", () => {
  it("compiles dynamic LoRA choices into static Comfyroll stack nodes", () => {
    const compiled = compileAnimaInt8Program({
      prompts: { positive: "hero, high_detail", negative: "", positivePrefix: "masterpiece" },
      loras: [
        { name: "style-a.safetensors", injectionTerms: "style a" },
        { name: "style-b.safetensors", activationTerms: "hero", injectionTerms: "style b" },
        { name: "style-c.safetensors", enabled: false },
        { name: "style-d.safetensors" },
      ],
    })

    expect(compiled.activeLoras.map((lora) => lora.name)).toEqual(["style-a.safetensors", "style-b.safetensors", "style-d.safetensors"])
    expect(compiled.positivePrompt).toBe("masterpiece, hero, high detail, style a, style b")
    const stacks = Object.values(compiled.graph).filter((node) => node.class_type === "CR LoRA Stack")
    expect(stacks).toHaveLength(1)
    expect(stacks[0]?.inputs).toMatchObject({ switch_1: "On", lora_name_1: "style-a.safetensors", switch_3: "On", lora_name_3: "style-d.safetensors" })
    expect(Object.values(compiled.graph).some((node) => node.class_type === "GlowTriggerLoRAStack")).toBe(false)
    expect(Object.values(compiled.graph).some((node) => node.class_type === "LayerUtility: SaveImagePlus")).toBe(true)
  })

  it("combines the retained prompt cleaners before compiling a fixed graph", () => {
    expect(normalizePromptText("<lora:legacy-style:0.8>, cat_ears:1.2,,\n[portrait] )")).toBe("(cat ears:1.2), [portrait]")
    expect(normalizePromptText("COUPLE MASK(cat_ears, MASK_SIZE(512, 512))\nAND dog_ears")).toBe("COUPLE(cat ears, MASK_SIZE(512, 512)) AND dog ears")
  })

  it("keeps the retained ANIMA execution-node contract aligned with the exported API graph", () => {
    const compiled = compileAnimaInt8Program()

    expect(compiled.graph["1"]).toMatchObject({
      class_type: "OTUNetLoaderW8A8",
      inputs: { weight_dtype: "default", model_type: "anima", on_the_fly_quantization: false, enable_convrot: true, lora_mode: "None" },
    })
    expect(compiled.graph["2"]).toMatchObject({
      class_type: "AnimaTeaCache",
      inputs: { threshold: 0.01, adaptive_mode: true, early_steps_factor: 0.4, late_steps_factor: 1.8, start_percent: 0, end_percent: 1, cache_device: "cuda", model: ["1", 0] },
    })
    expect(Object.values(compiled.graph).find((node) => node.class_type === "FLS_SamplerV4")?.inputs).toMatchObject({
      denoise: 1,
      fovea_strength: 3,
      sharpness: 0.5,
      mask_inertia: 0.85,
    })
    expect(Object.values(compiled.graph).find((node) => node.class_type === "LayerUtility: SaveImagePlus")?.inputs).toMatchObject({
      custom_path: "",
      timestamp: "None",
      meta_data: false,
      blind_watermark: "",
      save_workflow_as_json: true,
      preview: true,
    })
  })

  it("matches any Glow trigger alias and injects a same-name local trigger file before compilation", async () => {
    const readLoraTrigger = vi.fn(async () => "cat ears\nwhiskers")
    const result = await runComfygure({
      action: "compile",
      target: { libraryPath: "D:/ComfyUI" },
      program: {
        prompts: { positive: "portrait with animal ears" },
        loras: [{ name: "anima/cat_ears.safetensors", activationTerms: "cat ears, animal ears" }],
      },
    }, {
      fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
      readLoraTrigger,
    })

    expect(readLoraTrigger).toHaveBeenCalledWith("D:/ComfyUI", "anima/cat_ears.safetensors")
    expect(result.data?.compiled.activeLoras.map((lora) => lora.name)).toEqual(["anima/cat_ears.safetensors"])
    expect(result.data?.compiled.positivePrompt).toBe("portrait with animal ears, cat ears, whiskers")
  })

  it("compiles BatchLoadTexts-style source entries into fixed jobs and frozen incrementing seeds", () => {
    const runPlan = compileAnimaInt8RunPlan({
      prompts: { positivePrefix: "masterpiece" },
      batch: { prompts: ["cat", "dog"], queueCount: 5, allowDuplicates: true },
      parameters: { seed: 41, seedMode: "increment" },
    })

    expect(runPlan.jobs.map((job) => ({ sourceIndex: job.sourceIndex, loopIndex: job.loopIndex, seed: job.seed, prompt: job.compiled.positivePrompt }))).toEqual([
      { sourceIndex: 0, loopIndex: 0, seed: 41, prompt: "masterpiece, cat" },
      { sourceIndex: 1, loopIndex: 0, seed: 42, prompt: "masterpiece, dog" },
      { sourceIndex: 0, loopIndex: 1, seed: 43, prompt: "masterpiece, cat" },
      { sourceIndex: 1, loopIndex: 1, seed: 44, prompt: "masterpiece, dog" },
      { sourceIndex: 0, loopIndex: 2, seed: 45, prompt: "masterpiece, cat" },
    ])
    expect(runPlan.jobs.map((job) => job.compiled.graph["8"]?.inputs.seed)).toEqual([41, 42, 43, 44, 45])
  })

  it("uses a deterministic shuffle while preserving no-duplicate rounds", () => {
    const batch = { prompts: ["a", "b", "c"], maxPrompts: 0, queueCount: 8, shuffle: true, allowDuplicates: false, selectionSeed: 42 } as const
    const first = resolveBatchSequence(batch.prompts.length, batch)
    const second = resolveBatchSequence(batch.prompts.length, batch)

    expect(first).toEqual(second)
    expect(first).toHaveLength(8)
    expect([...first.slice(0, 3)].sort()).toEqual([0, 1, 2])
    expect([...first.slice(3, 6)].sort()).toEqual([0, 1, 2])
  })

  it("preflights exact node classes and resources from object_info without submitting a prompt", async () => {
    const compiled = compileAnimaInt8Program({ loras: [{ name: "folder/style-a.safetensors" }] })
    const info = objectInfoFor(compiled)
    const report = await preflightComfyuiTarget(compiled, {}, {
      fetch: async () => ({ ok: true, status: 200, json: async () => info }),
    })

    expect(report.online).toBe(true)
    expect(report.missingClasses).toEqual([])
    expect(report.missingResources).toEqual([])
  })

  it("fails closed for unavailable custom execution nodes and remote endpoints", async () => {
    const compiled = compileAnimaInt8Program()
    const report = await preflightComfyuiTarget(compiled, {}, {
      fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    })

    expect(report.missingClasses).toContain("FLS_SamplerV4")
    expect(() => normalizeComfyuiEndpoint("http://192.168.1.20:8188")).toThrow("only supports")
  })

  it("submits a fixed graph only through the explicit submit action after preflight", async () => {
    const requests: Array<{ url: string; init?: { method?: string; body?: string } }> = []
    const compiled = compileAnimaInt8Program()
    const result = await runComfygure({ action: "submit" }, {
      fetch: async (url, init) => {
        requests.push({ url, init })
        if (url.endsWith("/object_info")) return { ok: true, status: 200, json: async () => objectInfoFor(compiled) }
        return { ok: true, status: 200, json: async () => ({ prompt_id: "prompt-123", number: 7 }) }
      },
    })

    expect(result).toMatchObject({ success: true, data: { submission: { promptId: "prompt-123", queueNumber: 7 } } })
    expect(requests.map((request) => request.init?.method)).toEqual(["GET", "POST"])
    expect(requests[1]?.url).toBe("http://127.0.0.1:8000/prompt")
    expect(JSON.parse(requests[1]?.init?.body ?? "{}")).toMatchObject({ client_id: "xiranite-comfygure", prompt: compiled.graph })
  })

  it("does not submit when live preflight finds an incompatible execution target", async () => {
    const requests: string[] = []
    const result = await runComfygure({ action: "submit" }, {
      fetch: async (url) => {
        requests.push(url)
        return { ok: true, status: 200, json: async () => ({}) }
      },
    })

    expect(result.success).toBe(false)
    expect(requests).toEqual(["http://127.0.0.1:8000/object_info"])
  })

  it("preflights the union of LoRAs that are activated by different batch jobs", async () => {
    const catPlan = compileAnimaInt8Program({ loras: [{ name: "cat.safetensors", activationTerms: "cat" }], prompts: { positive: "cat" } })
    const requests: string[] = []
    const result = await runComfygure({
      action: "preflight",
      program: {
        batch: { prompts: ["cat", "dog"] },
        loras: [
          { name: "cat.safetensors", activationTerms: "cat" },
          { name: "dog.safetensors", activationTerms: "dog" },
        ],
      },
    }, {
      fetch: async (url) => {
        requests.push(url)
        return { ok: true, status: 200, json: async () => objectInfoFor(catPlan) }
      },
    })

    expect(result.success).toBe(false)
    expect(result.data?.preflight?.missingResources.map((item) => item.resourceName)).toEqual(["dog.safetensors"])
    expect(requests).toEqual(["http://127.0.0.1:8000/object_info"])
  })

  it("submits one immutable graph for each batch job after a single compatibility preflight", async () => {
    const compiled = compileAnimaInt8Program()
    const requests: Array<{ url: string; init?: { method?: string; body?: string } }> = []
    const result = await runComfygure({ action: "submit", program: { batch: { prompts: ["cat", "dog"] } } }, {
      fetch: async (url, init) => {
        requests.push({ url, init })
        if (url.endsWith("/object_info")) return { ok: true, status: 200, json: async () => objectInfoFor(compiled) }
        return { ok: true, status: 200, json: async () => ({ prompt_id: `prompt-${requests.length}`, number: requests.length }) }
      },
    })

    expect(result).toMatchObject({ success: true, data: { submissions: [{ promptId: "prompt-2" }, { promptId: "prompt-3" }] } })
    expect(requests.map((request) => request.init?.method)).toEqual(["GET", "POST", "POST"])
    expect(JSON.parse(requests[1]?.init?.body ?? "{}").prompt["5"].inputs.text).toBe("cat")
    expect(JSON.parse(requests[2]?.init?.body ?? "{}").prompt["5"].inputs.text).toBe("dog")
  })

  it("reads persisted prompt history without re-preflighting or resubmitting", async () => {
    const requests: Array<{ url: string; method?: string }> = []
    const result = await runComfygure({ action: "refresh", promptIds: ["pending", "finished", "failed", "finished"] }, {
      fetch: async (url, init) => {
        requests.push({ url, method: init?.method })
        if (url.endsWith("/pending")) return { ok: true, status: 200, json: async () => ({}) }
        if (url.endsWith("/failed")) return {
          ok: true,
          status: 200,
          json: async () => ({ failed: { status: { status_str: "error", messages: [["execution_error", { exception_message: "out of memory" }]] }, outputs: {} } }),
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ finished: { status: { status_str: "success", completed: true }, outputs: { "9": { images: [{ filename: "ComfyUI_00001_.png", subfolder: "batch/run", type: "output" }] } } } }),
        }
      },
    })

    expect(result.success).toBe(false)
    expect(result.data?.history).toMatchObject([
      { promptId: "pending", state: "pending", images: [] },
      { promptId: "finished", state: "complete", images: [{ url: "http://127.0.0.1:8000/view?filename=ComfyUI_00001_.png&subfolder=batch%2Frun&type=output" }] },
      { promptId: "failed", state: "error", error: "out of memory" },
    ])
    expect(requests).toEqual([
      { url: "http://127.0.0.1:8000/history/pending", method: "GET" },
      { url: "http://127.0.0.1:8000/history/finished", method: "GET" },
      { url: "http://127.0.0.1:8000/history/failed", method: "GET" },
    ])
  })

  it("aborts an unresponsive target instead of leaving preflight pending", async () => {
    vi.useFakeTimers()
    const compiled = compileAnimaInt8Program()
    try {
      const reportPromise = preflightComfyuiTarget(compiled, {}, {
        fetch: async (_url, init) => await new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
        }),
      })
      await vi.advanceTimersByTimeAsync(DEFAULT_COMFYUI_REQUEST_TIMEOUT_MS)
      const report = await reportPromise

      expect(report.online).toBe(false)
      expect(report.warnings).toEqual([`ComfyUI request timed out after ${DEFAULT_COMFYUI_REQUEST_TIMEOUT_MS / 1000} seconds.`])
    } finally {
      vi.useRealTimers()
    }
  })
})

function objectInfoFor(compiled: ReturnType<typeof compileAnimaInt8Program>) {
  const info: Record<string, unknown> = Object.fromEntries(compiled.requiredClasses.map((classType) => [classType, { input: { required: {} } }]))
  ;(info.OTUNetLoaderW8A8 as { input: { required: Record<string, unknown> } }).input.required.unet_name = [[compiled.program.model.unetName]]
  ;(info.CLIPLoader as { input: { required: Record<string, unknown> } }).input.required.clip_name = [[compiled.program.model.clipName]]
  ;(info.VAELoader as { input: { required: Record<string, unknown> } }).input.required.vae_name = [[compiled.program.model.vaeName]]
  if (compiled.activeLoras.length) (info["CR LoRA Stack"] as { input: { required: Record<string, unknown> } }).input.required.lora_name_1 = [compiled.activeLoras.map((lora) => lora.name)]
  return info
}
