export interface LocalBackendConfig {
  baseUrl: string
  token?: string
}

declare global {
  interface Window {
    __XIRANITE_BACKEND__?: Partial<LocalBackendConfig>
  }
}

export function resolveLocalBackendConfig(): LocalBackendConfig {
  const injected = typeof window !== "undefined" ? window.__XIRANITE_BACKEND__ : undefined
  const baseUrl = injected?.baseUrl ?? import.meta.env.VITE_XIRANITE_BACKEND_URL
  const token = injected?.token ?? import.meta.env.VITE_XIRANITE_BACKEND_TOKEN

  if (!baseUrl) {
    throw new Error("Xiranite local backend is not configured. Set window.__XIRANITE_BACKEND__ or VITE_XIRANITE_BACKEND_URL.")
  }

  return { baseUrl, token }
}
