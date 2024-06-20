export interface TTLMapValue<T> {
  value: T
  expiry: number
  timeoutId?: NodeJS.Timeout
}

export type OnExpiryCallback<T> = (key: string, value: T) => void

export class TTLMap<T> {
  private readonly map: { [key: string]: TTLMapValue<T> } = {}

  public set(key: string, value: T, ttl: number, onExpiry?: OnExpiryCallback<T>): void {
    const expiry = Date.now() + ttl
    const timeoutId = setTimeout(this.timeoutCallback, ttl, key, value, onExpiry)
    this.map[key] = { value, expiry, timeoutId }
  }

  private timeoutCallback(key: string, value: T, onExpiry?: OnExpiryCallback<T>): void {
    if (onExpiry) {
      onExpiry(key, value)
    }
    delete this.map[key]
  }

  public get(key: string): T | undefined {
    const value = this.map[key]
    if (value && value.expiry > Date.now()) {
      return value.value
    }
    delete this.map[key]
    return undefined
  }

  public delete(key: string): void {
    const entry = this.map[key]
    if (entry && entry.timeoutId) {
      clearTimeout(entry.timeoutId)
    }
    delete this.map[key]
  }
}
