import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG,
  type NeoviewFolderViewPatch,
} from "../../application/config/ReaderRuntimeConfig.js";
import { ReaderHttpController } from "./ReaderHttpController.js";

describe("Reader folder title-wrap HTTP", () => {
  it("[neoview.folder.title-wrap.http] persists a per-view title policy through the reader config endpoint", async () => {
    const updateFolderView = vi.fn(async (patch: NeoviewFolderViewPatch) => ({
      ...DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG,
      titleWrap: {
        ...DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.titleWrap,
        ...patch.folderView.titleWrap,
      },
    }));
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
      updateFolderView,
    });
    try {
      const response = await controller.handle(
        request({
          folderView: {
            titleWrap: { "cover-grid": false, "mosaic-grid": true },
          },
        }),
      );
      expect(response?.status).toBe(200);
      await expect(response!.json()).resolves.toMatchObject({
        folderView: { titleWrap: { "cover-grid": false, "mosaic-grid": true } },
      });
      expect(updateFolderView).toHaveBeenCalledWith(
        {
          folderView: {
            titleWrap: { "cover-grid": false, "mosaic-grid": true },
          },
        },
        { folder: { title_wrap: { cover_grid: false, mosaic_grid: true } } },
      );
    } finally {
      await controller[Symbol.asyncDispose]();
    }
  });
});

function request(body: unknown): Request {
  return new Request("http://127.0.0.1:41000/reader/config", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-xiranite-token": "reader-token",
    },
    body: JSON.stringify(body),
  });
}
