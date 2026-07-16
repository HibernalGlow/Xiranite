import { PriorityResourceScheduler } from "../scheduler/PriorityResourceScheduler.js"

/** Shared process budget for all ffmpeg/ffprobe work in the Reader runtime. */
export const videoProcessSlots = new PriorityResourceScheduler({ maxConcurrent: 1, reservedInteractive: 0 })
