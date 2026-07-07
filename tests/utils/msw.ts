import { afterAll, afterEach, beforeAll } from "vitest"
import { http, HttpResponse, type RequestHandler } from "msw"
import { setupServer } from "msw/node"

export { http, HttpResponse }

export function setupMswServer(...handlers: RequestHandler[]) {
  const server = setupServer(...handlers)

  beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
  afterEach(() => server.resetHandlers())
  afterAll(() => server.close())

  return server
}
