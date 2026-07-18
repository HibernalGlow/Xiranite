export interface ClosableReaderDataStore {
  close(): void | Promise<void>
}

export class LazyReaderDataStoreResource<T extends ClosableReaderDataStore> implements AsyncDisposable {
  readonly #load: () => Promise<T>
  #resource?: Promise<T>
  #loaded?: T
  #closePromise?: Promise<void>
  #disposed = false
  #closed = false

  constructor(load: () => Promise<T>) {
    this.#load = load
  }

  get(): Promise<T> {
    if (this.#closed) return Promise.reject(new Error("Lazy Reader data store is closed."))
    if (this.#resource) return this.#resource
    const pending = this.#load()
    const guarded = pending.then(async (resource) => {
      if (this.#closed) {
        await this.#dispose(resource)
        throw new Error("Lazy Reader data store is closed.")
      }
      this.#loaded = resource
      return resource
    }).catch((error) => {
      if (this.#resource === guarded) this.#resource = undefined
      throw error
    })
    this.#resource = guarded
    return guarded
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise
    this.#closed = true
    this.#closePromise = (async () => {
      const loaded = this.#loaded ?? await this.#resource?.catch(() => undefined)
      if (loaded) await this.#dispose(loaded)
    })()
    return this.#closePromise
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close()
  }

  async #dispose(resource: T): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    if (this.#loaded === resource) this.#loaded = undefined
    await resource.close()
  }
}
