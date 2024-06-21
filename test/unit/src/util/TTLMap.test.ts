import { TTLMap } from '../../../../src/util/TTLMap'

describe('TTLMap', () => {
  jest.useFakeTimers()

  let ttlMap: TTLMap<string>

  beforeEach(() => {
    ttlMap = new TTLMap()
  })

  test('set and get a value', () => {
    ttlMap.set('key1', 'value1', 1000)
    expect(ttlMap.get('key1')).toBe('value1')
  })

  test('get a value after expiry', () => {
    ttlMap.set('key2', 'value2', 1000)
    jest.advanceTimersByTime(1001)
    expect(ttlMap.get('key2')).toBeUndefined()
  })

  test('set a value with expiry callback', () => {
    const onExpiryMock = jest.fn()
    ttlMap.set('key3', 'value3', 1000, onExpiryMock)
    jest.advanceTimersByTime(1001)
    expect(ttlMap.get('key3')).toBeUndefined()
    expect(onExpiryMock).toHaveBeenCalledWith('key3', 'value3')
  })

  test('delete a value before expiry', () => {
    ttlMap.set('key4', 'value4', 1000)
    ttlMap.delete('key4')
    expect(ttlMap.get('key4')).toBeUndefined()
  })

  test('delete a value with expiry callback before expiry', () => {
    const onExpiryMock = jest.fn()
    ttlMap.set('key5', 'value5', 1000, onExpiryMock)
    ttlMap.delete('key5')
    jest.advanceTimersByTime(1001)
    expect(ttlMap.get('key5')).toBeUndefined()
    expect(onExpiryMock).not.toHaveBeenCalled()
  })

  test('set a value without expiry callback', () => {
    ttlMap.set('key6', 'value6', 1000)
    jest.advanceTimersByTime(1001)
    expect(ttlMap.get('key6')).toBeUndefined()
  })

  test('clear timeout on delete', () => {
    jest.spyOn(global, 'clearTimeout')
    ttlMap.set('key7', 'value7', 1000)
    const entry = ttlMap.get('key7')
    expect(entry).toBeDefined()
    ttlMap.delete('key7')
    expect(clearTimeout).toHaveBeenCalled()
  })

  test('get a value before expiry', () => {
    ttlMap.set('key8', 'value8', 1000)
    jest.advanceTimersByTime(500)
    expect(ttlMap.get('key8')).toBe('value8')
  })

  test('check if value is deleted after expiry', () => {
    ttlMap.set('key9', 'value9', 1000)
    jest.advanceTimersByTime(1001)
    expect(ttlMap.get('key9')).toBeUndefined()
  })
})
