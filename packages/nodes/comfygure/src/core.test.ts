import { describe, expect, it, vi } from "vitest"
import { compileAnimaInt8Program, compileAnimaInt8RunPlan, compileComfygureTemplate, confirmComfygureTemplateBindings, compressComfygureText, createComfygureProfile, decompressComfygureText, DEFAULT_COMFYUI_REQUEST_TIMEOUT_MS, exportComfygureCanvas, importComfyuiWorkflow, normalizeComfyuiEndpoint, normalizeComfygureProfile, normalizePromptText, preflightComfyuiTarget, resolveBatchSequence, resolveComfygureProfile, runComfygure } from "./core.js"

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

  it("round-trips large batch source text through compact node state", () => {
    const source = Array.from({ length: 1_000 }, (_, index) => `masterpiece, portrait ${index}, studio lighting, detailed eyes`).join("\n")
    const compressed = compressComfygureText(source)

    expect(compressed?.format).toBe("deflate-base64/v1")
    expect(compressed?.lineCount).toBe(1_000)
    expect(compressed?.data.length).toBeLessThan(source.length)
    expect(decompressComfygureText(compressed)).toBe(source)
    expect(decompressComfygureText({ format: "deflate-base64/v1", data: "not-base64", lineCount: 1, uncompressedLength: 1 })).toBe("")
  })

  it("freezes a versioned generation profile without prompts or batch content", () => {
    const first = createComfygureProfile({
      prompts: { positive: "project-only" },
      batch: { prompts: ["project batch"] },
      model: { unetName: "profile-model.safetensors" },
      parameters: { width: 1536, height: 896, steps: 33 },
      output: { filenamePrefix: "profile-output" },
    }, "ANIMA Portrait", { now: new Date("2026-07-24T00:00:00.000Z") })
    const revised = createComfygureProfile(first.program, "ANIMA Portrait v2", { previous: first, now: new Date("2026-07-24T01:00:00.000Z") })
    const resolved = resolveComfygureProfile(first, { prompts: { positive: "project prompt" }, parameters: { steps: 40 } })

    expect(first).toMatchObject({ id: "anima-portrait", revision: 1, createdAt: "2026-07-24T00:00:00.000Z", program: { model: { unetName: "profile-model.safetensors" }, parameters: { width: 1536, height: 896, steps: 33 } } })
    expect(first.program).not.toHaveProperty("prompts")
    expect(first.program).not.toHaveProperty("batch")
    expect(revised).toMatchObject({ id: "anima-portrait", revision: 2, createdAt: first.createdAt, updatedAt: "2026-07-24T01:00:00.000Z" })
    expect(resolved).toMatchObject({ prompts: { positive: "project prompt" }, parameters: { width: 1536, height: 896, steps: 40 }, output: { filenamePrefix: "profile-output" } })
    expect(normalizeComfygureProfile(JSON.parse(JSON.stringify(first)))).toEqual(first)
  })

  it("uses the profile store only for explicit profile actions", async () => {
    const saved: unknown[] = []
    const profiles = [{ id: "anima-portrait", name: "ANIMA Portrait", revision: 1, updatedAt: "2026-07-24T00:00:00.000Z" }]
    const runtime = {
      fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
      now: () => new Date("2026-07-24T00:00:00.000Z"),
      profileStore: {
        list: vi.fn(async () => profiles),
        read: vi.fn(async () => undefined),
        save: vi.fn(async (profile) => { saved.push(profile); return profile }),
      },
    }

    const listed = await runComfygure({ action: "profiles" }, runtime)
    const created = await runComfygure({ action: "saveProfile", profileName: "ANIMA Portrait" }, runtime)

    expect(listed).toMatchObject({ success: true, data: { profiles } })
    expect(created).toMatchObject({ success: true, data: { profile: { id: "anima-portrait", revision: 1 } } })
    expect(saved).toHaveLength(1)
  })

  it("repairs malformed multiline API JSON, preserves its source, and applies confirmed template bindings", () => {
    const imported = importComfyuiWorkflow(`{
      "1": { "class_type": "CLIPTextEncode", "inputs": { "text": "old
prompt", "clip": ["2", 0] }, "_meta": { "title": "Positive prompt" } },
      "2": { "class_type": "CLIPLoader", "inputs": { "clip_name": "old-clip.safetensors" } },
      "3": { "class_type": "CLIPTextEncode", "inputs": { "text": "old negative", "clip": ["2", 0] }, "_meta": { "title": "Negative prompt" } },
      "4": { "class_type": "AnimaLatentImage", "inputs": { "width": 512, "height": 512, "batch_size": 1 } },
      "5": { "class_type": "FLS_SamplerV4", "inputs": { "seed": 1, "steps": 20, "cfg": 4, "sampler_name": "euler", "scheduler": "normal", "denoise": 1, "positive": ["1", 0], "negative": ["3", 0], "latent_image": ["4", 0] } },
      "6": { "class_type": "LayerUtility: SaveImagePlus", "inputs": { "filename_prefix": "old", "format": "png", "quality": 90, "preview": false, "images": ["7", 0] } },
      "7": { "class_type": "VAEDecode", "inputs": { "samples": ["5", 0] } }
    }`)

    expect(imported.repairedSource).toBe(true)
    expect(imported.template?.originalSource.uncompressedLength).toBeGreaterThan(100)
    expect(imported.template?.bindingManifest.confirmed).toBe(false)
    const compiled = compileComfygureTemplate(confirmComfygureTemplateBindings(imported.template!), {
      prompts: { positivePrefix: "masterpiece", positive: "cat_ears", negative: "bad anatomy" },
      model: { clipName: "new-clip.safetensors" },
      parameters: { width: 1280, height: 768, batchSize: 2, seed: 42, steps: 30, cfg: 5, samplerName: "euler_ancestral", scheduler: "beta57" },
      output: { filenamePrefix: "run/demo", quality: 100, preview: true },
    })

    expect(compiled.graph["1"]?.inputs.text).toBe("masterpiece, cat ears")
    expect(compiled.graph["3"]?.inputs.text).toBe("bad anatomy")
    expect(compiled.graph["2"]?.inputs.clip_name).toBe("new-clip.safetensors")
    expect(compiled.graph["4"]?.inputs).toMatchObject({ width: 1280, height: 768, batch_size: 2 })
    expect(compiled.graph["5"]?.inputs).toMatchObject({ seed: 42, steps: 30, cfg: 5, sampler_name: "euler_ancestral", scheduler: "beta57" })
    expect(compiled.graph["6"]?.inputs).toMatchObject({ filename_prefix: "run/demo", quality: 100, preview: true })
    expect(compiled.requiredResources).toContainEqual({ classType: "CLIPLoader", inputName: "clip_name", resourceName: "new-clip.safetensors", kind: "clip" })
  })

  it("uses object_info widget order and resolves reroutes when importing a UI workflow", () => {
    const imported = importComfyuiWorkflow(JSON.stringify({
      nodes: [
        { id: 10, type: "CLIPLoader", widgets_values: ["clip.safetensors"], inputs: [] },
        { id: 11, type: "Reroute", inputs: [{ name: "", link: 1 }] },
        { id: 12, type: "CLIPTextEncode", title: "Positive", widgets_values: ["a cat"], inputs: [{ name: "clip", link: 2 }] },
      ],
      links: [[1, 10, 0, 11, 0, "CLIP"], [2, 11, 0, 12, 0, "CLIP"]],
    }), {
      objectInfo: {
        CLIPLoader: { input: { required: { clip_name: [["clip.safetensors"]] } } },
        CLIPTextEncode: { input: { required: { text: ["STRING"], clip: ["CLIP"] } } },
      },
    })

    expect(imported.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([])
    expect(imported.template?.sourceFormat).toBe("ui")
    expect(imported.template?.graph["10"]).toMatchObject({ class_type: "CLIPLoader", inputs: { clip_name: "clip.safetensors" } })
    expect(imported.template?.graph["12"]).toMatchObject({ class_type: "CLIPTextEncode", inputs: { text: "a cat", clip: ["10", 0] } })
  })

  it("materializes Glow dynamic outputs and Trigger LoRA stacks before retaining a saved template graph", () => {
    const imported = importComfyuiWorkflow(JSON.stringify({
      "1": { class_type: "CLIPLoader", inputs: { clip_name: "clip.safetensors" } },
      "2": { class_type: "CLIPTextEncode", inputs: { text: "old", clip: ["1", 0] }, _meta: { title: "Positive" } },
      "3": { class_type: "CLIPTextEncode", inputs: { text: "old", clip: ["1", 0] }, _meta: { title: "Negative" } },
      "4": { class_type: "AnimaLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
      "5": { class_type: "OTUNetLoaderW8A8", inputs: { unet_name: "model.safetensors" } },
      "6": { class_type: "GlowTriggerLoRAStack", inputs: { lora_count: 1, enable_1: true, lora_name_1: "cat.safetensors", model_weight_1: 1.2, clip_weight_1: 0.8, trigger_1: "cat", output_trigger_1: "cat style" } },
      "7": { class_type: "CR Apply LoRA Stack", inputs: { model: ["5", 0], clip: ["1", 0], lora_stack: ["6", 0] } },
      "8": { class_type: "FLS_SamplerV4", inputs: { model: ["7", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0], sharpness: ["11", 1] } },
      "9": { class_type: "VAEDecode", inputs: { samples: ["8", 0] } },
      "10": { class_type: "SaveImage", inputs: { images: ["9", 0], filename_prefix: "old" } },
      "11": { class_type: "GlowDynamicTypedOutputs", inputs: { output_count: 1, index: 1, type_1: "FLOAT", default_value_1: "1.5", bypass_1: false } },
    }))

    const compiled = compileComfygureTemplate(confirmComfygureTemplateBindings(imported.template!), {
      prompts: { positive: "cat", negative: "bad" },
      loras: [{ name: "cat.safetensors", activationTerms: "cat", injectionTerms: "cat style", modelStrength: 1.2, clipStrength: 0.8 }],
    })

    expect(Object.values(compiled.graph).some((node) => node.class_type === "GlowDynamicTypedOutputs" || node.class_type === "GlowTriggerLoRAStack")).toBe(false)
    expect(Object.values(compiled.graph).find((node) => node.class_type === "FLS_SamplerV4")?.inputs.sharpness).toBe(1.5)
    expect(Object.values(compiled.graph).find((node) => node.class_type === "CR LoRA Stack")?.inputs).toMatchObject({ switch_1: "On", lora_name_1: "cat.safetensors", model_weight_1: 1.2, clip_weight_1: 0.8 })
    expect(compiled.positivePrompt).toBe("cat, cat style")
  })

  it("keeps unresolved dynamic editor nodes out of prompt submission", async () => {
    const imported = importComfyuiWorkflow(JSON.stringify({
      "1": { class_type: "BatchLoadTexts", inputs: { text_list: "cat" } },
    }))
    expect(imported.diagnostics).toContainEqual(expect.objectContaining({ severity: "warning", code: "compile-time-node", nodeId: "1" }))
    const result = await runComfygure({ action: "submit", template: confirmComfygureTemplateBindings(imported.template!) }, {
      fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    })
    expect(result.success).toBe(false)
    expect(result.message).toContain("dynamic editor")
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

  it("exports a deterministic typed canvas with stable links and widgets", () => {
    const graph = canvasGraph()
    const first = exportComfygureCanvas(graph, { objectInfo: canvasObjectInfo() })
    const second = exportComfygureCanvas(graph, { objectInfo: canvasObjectInfo() })

    expect(first).toEqual(second)
    expect(first.nodes.map((node) => node.id)).toEqual([1, 2, 3])
    expect(first.links).toEqual([
      [1, 1, 0, 2, 0, "MODEL"],
      [2, 2, 0, 3, 0, "IMAGE"],
    ])
    expect(first.nodes[0]).toMatchObject({ type: "ModelLoader", outputs: [{ name: "MODEL", type: "MODEL", links: [1] }], widgets_values: ["model.safetensors"] })
    expect(first.nodes[1]).toMatchObject({ type: "PromptImage", inputs: [{ name: "model", type: "MODEL", link: 1 }, { name: "text", type: "STRING", link: null }], widgets_values: ["cat"] })
    expect(first.extra.comfygure).toEqual(expect.objectContaining({ objectInfoUsed: true, diagnostics: [] }))
  })

  it("lays out canvas nodes and groups without overlap", () => {
    const canvas = exportComfygureCanvas(canvasGraph(), { objectInfo: canvasObjectInfo() })

    for (const [index, node] of canvas.nodes.entries()) {
      for (const other of canvas.nodes.slice(index + 1)) expect(canvasRectanglesOverlap(node.pos, node.size, other.pos, other.size)).toBe(false)
    }
    for (const [index, group] of canvas.groups.entries()) {
      for (const other of canvas.groups.slice(index + 1)) expect(canvasRectanglesOverlap([group.bounding[0], group.bounding[1]], [group.bounding[2], group.bounding[3]], [other.bounding[0], other.bounding[1]], [other.bounding[2], other.bounding[3]])).toBe(false)
      const contained = canvas.nodes.filter((node) => node.pos[0] >= group.bounding[0] && node.pos[0] + node.size[0] <= group.bounding[0] + group.bounding[2] && node.pos[1] >= group.bounding[1] && node.pos[1] + node.size[1] <= group.bounding[1] + group.bounding[3])
      expect(contained.length).toBeGreaterThan(0)
    }
  })

  it("keeps exported canvas links internally consistent", () => {
    const canvas = exportComfygureCanvas(canvasGraph(), { objectInfo: canvasObjectInfo() })
    const nodes = new Map(canvas.nodes.map((node) => [node.id, node]))

    for (const [linkId, originId, originSlot, targetId, targetSlot] of canvas.links) {
      expect(nodes.get(originId)?.outputs[originSlot]?.links).toContain(linkId)
      expect(nodes.get(targetId)?.inputs[targetSlot]?.link).toBe(linkId)
    }
  })

  it("records explicit fallbacks instead of emitting dangling canvas links", () => {
    const graph = {
      "1": { class_type: "UnknownNode", inputs: { source: ["missing", 0], value: 1 } },
    }
    const canvas = exportComfygureCanvas(graph)

    expect(canvas.links).toEqual([])
    expect(canvas.nodes[0]?.inputs.find((input) => input.name === "source")?.link).toBeNull()
    expect(canvas.extra.comfygure.objectInfoUsed).toBe(false)
    expect(canvas.extra.comfygure.diagnostics.join(" ")).toContain("missing node")
  })

  it("exports a canvas through the runner using object_info only", async () => {
    const requests: Array<{ url: string; method?: string }> = []
    const compiled = compileAnimaInt8Program()
    const result = await runComfygure({ action: "canvas" }, {
      fetch: async (url, init) => {
        requests.push({ url, method: init?.method })
        return { ok: true, status: 200, json: async () => objectInfoFor(compiled) }
      },
    })

    expect(result).toMatchObject({ success: true, data: { canvas: { version: 0.4, nodes: expect.any(Array) } } })
    expect(requests).toEqual([{ url: "http://127.0.0.1:8000/object_info", method: "GET" }])
    expect(result.data?.canvas?.links.every(([linkId, originId, originSlot, targetId, targetSlot]) => result.data?.canvas?.nodes.find((node) => node.id === originId)?.outputs[originSlot]?.links?.includes(linkId) && result.data?.canvas?.nodes.find((node) => node.id === targetId)?.inputs[targetSlot]?.link === linkId)).toBe(true)
  })

  it("delegates local preflight and submission through the target adapter contract", async () => {
    const compiled = compileAnimaInt8Program()
    const targetAdapter = {
      readObjectInfo: vi.fn(async () => objectInfoFor(compiled)),
      submitPrompt: vi.fn(async () => ({ endpoint: "http://127.0.0.1:8000", promptId: "adapter-prompt", clientId: "xiranite-comfygure" })),
      readPromptHistory: vi.fn(async () => ({ endpoint: "http://127.0.0.1:8000", promptId: "adapter-prompt", state: "complete" as const, images: [] })),
    }
    const result = await runComfygure({ action: "submit" }, {
      fetch: async () => { throw new Error("raw transport must not be used when an adapter is present") },
      targetAdapter,
    })

    expect(result).toMatchObject({ success: true, data: { submission: { promptId: "adapter-prompt" } } })
    expect(targetAdapter.readObjectInfo).toHaveBeenCalledTimes(1)
    expect(targetAdapter.submitPrompt).toHaveBeenCalledWith(expect.objectContaining({ graph: compiled.graph }), {})
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

function canvasGraph() {
  return {
    "10": { class_type: "ModelLoader", inputs: { model_name: "model.safetensors" } },
    "20": { class_type: "PromptImage", inputs: { model: ["10", 0], text: "cat" }, _meta: { title: "Positive prompt" } },
    "30": { class_type: "SaveImage", inputs: { images: ["20", 0], filename_prefix: "canvas/check" } },
  }
}

function canvasObjectInfo() {
  return {
    ModelLoader: { input: { required: { model_name: [["model.safetensors"]] } }, output: ["MODEL"], output_name: ["MODEL"] },
    PromptImage: { input: { required: { model: ["MODEL"], text: ["STRING", { default: "" }] } }, output: ["IMAGE"], output_name: ["IMAGE"] },
    SaveImage: { input: { required: { images: ["IMAGE"], filename_prefix: ["STRING", { default: "ComfyUI" }] } }, output: [] },
  }
}

function canvasRectanglesOverlap(left: readonly [number, number], leftSize: readonly [number, number], right: readonly [number, number], rightSize: readonly [number, number]): boolean {
  return left[0] < right[0] + rightSize[0] && left[0] + leftSize[0] > right[0] && left[1] < right[1] + rightSize[1] && left[1] + leftSize[1] > right[1]
}
