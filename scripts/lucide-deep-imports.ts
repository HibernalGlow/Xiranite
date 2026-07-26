import type { TransformImportsOptions } from "@rolldown/plugin-transform-imports"

const LUCIDE_BARREL_IMPORT = "lucide-react"

export const LUCIDE_TRANSFORM_IMPORT_OPTIONS = {
  [LUCIDE_BARREL_IMPORT]: {
    transform: [
      ["(.+?)(\\d+)X(\\d+)Icon", "lucide-react/dist/esm/icons/{{kebabCase memberMatches.[1]}}-{{memberMatches.[2]}}x{{memberMatches.[3]}}.mjs"],
      ["(.+?)(\\d+)X(\\d+)", "lucide-react/dist/esm/icons/{{kebabCase memberMatches.[1]}}-{{memberMatches.[2]}}x{{memberMatches.[3]}}.mjs"],
      ["(.+?)(\\d+)Icon", "lucide-react/dist/esm/icons/{{kebabCase memberMatches.[1]}}-{{memberMatches.[2]}}.mjs"],
      ["(.+?)(\\d+)([A-Z].+)Icon", "lucide-react/dist/esm/icons/{{kebabCase memberMatches.[1]}}-{{memberMatches.[2]}}-{{kebabCase memberMatches.[3]}}.mjs"],
      ["(.+?)(\\d+)([A-Z].+)", "lucide-react/dist/esm/icons/{{kebabCase memberMatches.[1]}}-{{memberMatches.[2]}}-{{kebabCase memberMatches.[3]}}.mjs"],
      ["(.+?)(\\d+)", "lucide-react/dist/esm/icons/{{kebabCase memberMatches.[1]}}-{{memberMatches.[2]}}.mjs"],
      ["(.+)Icon", "lucide-react/dist/esm/icons/{{kebabCase memberMatches.[1]}}.mjs"],
      ["*", "lucide-react/dist/esm/icons/{{kebabCase member}}.mjs"],
    ],
  },
} satisfies TransformImportsOptions
