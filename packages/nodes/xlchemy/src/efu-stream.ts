import { streamEfuFileRecords } from "@xiranite/shared/efu-stream"

/**
 * Stream the Filename column from an Everything File List without retaining
 * the file contents or parsed rows. Windows filenames cannot contain newlines,
 * so each physical EFU line is one complete CSV record.
 */
export async function* streamEfuPaths(path: string): AsyncGenerator<string> {
  for await (const record of streamEfuFileRecords(path)) yield record.filename
}
