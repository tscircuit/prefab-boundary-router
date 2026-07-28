interface HeapEntry<T> {
  priority: number
  sequence: number
  value: T
}

export class MinHeap<T> {
  private entries: HeapEntry<T>[] = []
  private sequence = 0

  get size() {
    return this.entries.length
  }

  push(priority: number, value: T) {
    const entry = { priority, sequence: this.sequence++, value }
    this.entries.push(entry)
    this.bubbleUp(this.entries.length - 1)
  }

  pop(): T | undefined {
    const first = this.entries[0]
    const last = this.entries.pop()
    if (!first) return undefined
    if (this.entries.length > 0 && last) {
      this.entries[0] = last
      this.sinkDown(0)
    }
    return first.value
  }

  private bubbleUp(index: number) {
    let current = index
    while (current > 0) {
      const parent = (current - 1) >> 1
      if (!this.isLess(current, parent)) break
      this.swap(current, parent)
      current = parent
    }
  }

  private sinkDown(index: number) {
    let current = index
    while (true) {
      const left = current * 2 + 1
      const right = left + 1
      let smallest = current
      if (left < this.entries.length && this.isLess(left, smallest)) {
        smallest = left
      }
      if (right < this.entries.length && this.isLess(right, smallest)) {
        smallest = right
      }
      if (smallest === current) return
      this.swap(current, smallest)
      current = smallest
    }
  }

  private isLess(a: number, b: number) {
    const left = this.entries[a]!
    const right = this.entries[b]!
    return (
      left.priority < right.priority ||
      (left.priority === right.priority && left.sequence < right.sequence)
    )
  }

  private swap(a: number, b: number) {
    const value = this.entries[a]!
    this.entries[a] = this.entries[b]!
    this.entries[b] = value
  }
}
