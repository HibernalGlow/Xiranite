import type { ReaderSessionDto } from "../adapters/reader-http-client"

export function session(
  pageId: string,
  assetUrl: string,
  index: number,
  activation: Partial<ReaderSessionDto["activationIdentity"]> = {},
): ReaderSessionDto {
  return {
    sessionId: "reader-1",
    activationIdentity: {
      readerSourcePath: "D:/books/demo.cbz",
      activatedEntryPath: "D:/books/demo.cbz",
      traversalRootPath: "D:/books",
      ...activation,
    },
    book: { id: "book-1", displayName: "demo.cbz", pageCount: 2 },
    frame: {
      generation: 0,
      anchorPageIndex: index,
      direction: "left-to-right",
      layout: { pageMode: "single", panorama: false, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: true },
      pages: [{ pageId, pageIndex: index, side: "single" }],
      pageCount: 2,
      atStart: index === 0,
      atEnd: index === 1,
    },
    visiblePages: [{
      id: pageId,
      index,
      name: "001.jpg",
      mediaKind: "image",
      mimeType: "image/jpeg",
      byteLength: 10,
      contentVersion: "v1",
      assetUrl,
    }],
  }
}
