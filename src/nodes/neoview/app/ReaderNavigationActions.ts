export interface ReaderNavigationActionsOptions {
  currentAnchorPage(): number | undefined
  isAtBoundary(action: "next" | "previous"): boolean
  tailOverflow(): "stay-on-last-page" | "next-book"
  isNavigationPending(): boolean
  isBusy(): boolean
  switchAdjacentBook(action: "next" | "previous"): Promise<boolean>
  boundaryToastEnabled(): boolean
  showBoundaryToast(action: "next" | "previous"): void
  updateNavigation(action: "next" | "previous", slideshowAction: boolean, presentEachPage: boolean): Promise<boolean>
  goToPage(pageIndex: number, slideshowAction: boolean, presentEachPage: boolean): Promise<boolean>
  resetSlideshow(): void
}

export function createReaderNavigationActions(options: ReaderNavigationActionsOptions) {
  return {
    async navigate(action: "next" | "previous", slideshowAction = false, presentEachPage = false): Promise<boolean> {
      if (options.isAtBoundary(action) && options.tailOverflow() === "next-book") {
        if (options.isNavigationPending() || options.isBusy()) return false
        if (await options.switchAdjacentBook(action)) {
          if (!slideshowAction) options.resetSlideshow()
          return true
        }
      }
      if (options.isAtBoundary(action) && !slideshowAction && options.boundaryToastEnabled()) options.showBoundaryToast(action)
      const updated = await options.updateNavigation(action, slideshowAction, presentEachPage)
      if (updated && !slideshowAction) options.resetSlideshow()
      return updated
    },
    async goTo(pageIndex: number, slideshowAction = false, presentEachPage = false): Promise<boolean> {
      if (pageIndex === options.currentAnchorPage()) return false
      const updated = await options.goToPage(pageIndex, slideshowAction, presentEachPage)
      if (updated && !slideshowAction) options.resetSlideshow()
      return updated
    },
  }
}
