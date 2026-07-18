let instanceCounter = 0
let laneCounter = 0

export function nextComponentCounter(): number {
  instanceCounter += 1
  return instanceCounter
}

export function nextLaneId(now: number): string {
  laneCounter += 1
  return `lane-${laneCounter}-${now}`
}
