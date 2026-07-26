import { ResourceSchedulerService } from "@xiranite/services"
import { availableParallelism, totalmem } from "node:os"

export function createBackendResourceScheduler(
  env: Record<string, string | undefined> = process.env,
  logicalCpuCount = availableParallelism(),
  physicalMemoryBytes = totalmem(),
): ResourceSchedulerService {
  const cpuWeight = positiveInteger(env.XIRANITE_CPU_WEIGHT, Math.max(1, logicalCpuCount), 1_024)
  const cpuConcurrent = positiveInteger(env.XIRANITE_CPU_MAX_CONCURRENT, Math.min(16, cpuWeight), 64)
  const cpuReservedWeight = nonNegativeInteger(
    env.XIRANITE_CPU_RESERVED_INTERACTIVE_WEIGHT,
    cpuWeight >= 4 ? 2 : cpuWeight >= 2 ? 1 : 0,
    Math.max(0, cpuWeight - 1),
  )
  const cpuReservedSlots = nonNegativeInteger(
    env.XIRANITE_CPU_RESERVED_INTERACTIVE,
    cpuConcurrent > 1 ? 1 : 0,
    Math.max(0, cpuConcurrent - 1),
  )
  const ioWeight = positiveInteger(env.XIRANITE_IO_WEIGHT, 4, 1_024)
  const ioConcurrent = positiveInteger(env.XIRANITE_IO_MAX_CONCURRENT, Math.min(4, ioWeight), 64)
  const physicalMemoryMiB = Math.max(1, Math.floor(physicalMemoryBytes / (1024 * 1024)))
  const memoryMiB = positiveInteger(
    env.XIRANITE_MEMORY_BUDGET_MIB,
    Math.max(256, Math.floor(physicalMemoryMiB * 0.6)),
    1_000_000,
  )
  const reservedInteractiveMemoryMiB = nonNegativeInteger(
    env.XIRANITE_MEMORY_RESERVED_INTERACTIVE_MIB,
    Math.min(512, Math.max(0, memoryMiB - 1)),
    Math.max(0, memoryMiB - 1),
  )

  return new ResourceSchedulerService({
    pools: {
      cpu: {
        maxConcurrent: cpuConcurrent,
        reservedInteractive: cpuReservedSlots,
        maxWeight: cpuWeight,
        reservedInteractiveWeight: cpuReservedWeight,
      },
      io: {
        maxConcurrent: ioConcurrent,
        reservedInteractive: ioConcurrent > 1 ? 1 : 0,
        maxWeight: ioWeight,
        reservedInteractiveWeight: ioWeight > 1 ? 1 : 0,
      },
      gpu: { maxConcurrent: 1, reservedInteractive: 0, maxWeight: 1, reservedInteractiveWeight: 0 },
    },
    memory: { maxMiB: memoryMiB, reservedInteractiveMiB: reservedInteractiveMemoryMiB },
  })
}

function positiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = value === undefined ? fallback : Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback
}

function nonNegativeInteger(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = value === undefined ? fallback : Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= maximum ? parsed : fallback
}
