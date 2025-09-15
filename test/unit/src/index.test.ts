import { v1 as uuid } from 'uuid'
import { getSenderAddress, Sn, logFlags } from '../../../src/index'
import { SnOpts } from '../../../src/types'

// Mock the native module
jest.mock('../../../../shardus-net.node', () => ({
  getSenderAddress: jest.fn(),
  Sn: jest.fn(),
  setLoggingEnabled: jest.fn(),
}))

// Mock uuid
jest.mock('uuid')

// Mock utilities
jest.mock('../../../src/util/Encoding', () => ({
  jsonParse: jest.fn((str, parser) => {
    if (parser) {
      return parser(str)
    }
    return JSON.parse(str)
  }),
  jsonStringify: jest.fn((obj, stringifier) => {
    if (stringifier) {
      return stringifier(obj)
    }
    return JSON.stringify(obj)
  }),
}))

const mockNet = require('../../../../shardus-net.node')

describe('index.ts', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    ;(uuid as jest.Mock).mockReturnValue('test-uuid-123')
    // Reset logFlags to default values
    logFlags.net_verbose = false
    logFlags.net_stats = false
    logFlags.net_rust = false
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('getSenderAddress', () => {
    describe('happy path', () => {
      test('should return sender address for valid raw transaction', () => {
        const mockResult = { address: '0x1234567890abcdef', isValid: true }
        mockNet.getSenderAddress.mockReturnValue(mockResult)

        const result = getSenderAddress('0xabcdef123456')

        expect(mockNet.getSenderAddress).toHaveBeenCalledWith('abcdef123456')
        expect(result).toEqual(mockResult)
      })

      test('should handle raw transaction without 0x prefix', () => {
        const mockResult = { address: '0x1234567890abcdef', isValid: true }
        mockNet.getSenderAddress.mockReturnValue(mockResult)

        const result = getSenderAddress('abcdef123456')

        expect(mockNet.getSenderAddress).toHaveBeenCalledWith('abcdef123456')
        expect(result).toEqual(mockResult)
      })
    })

    describe('edge cases', () => {
      test('should handle empty string', () => {
        const mockResult = { address: null, isValid: false }
        mockNet.getSenderAddress.mockReturnValue(mockResult)

        const result = getSenderAddress('')

        expect(mockNet.getSenderAddress).toHaveBeenCalledWith('')
        expect(result).toEqual(mockResult)
      })

      test('should handle only 0x prefix', () => {
        const mockResult = { address: null, isValid: false }
        mockNet.getSenderAddress.mockReturnValue(mockResult)

        const result = getSenderAddress('0x')

        expect(mockNet.getSenderAddress).toHaveBeenCalledWith('')
        expect(result).toEqual(mockResult)
      })
    })

    describe('negative tests', () => {
      test('should handle native module throwing error', () => {
        mockNet.getSenderAddress.mockImplementation(() => {
          throw new Error('Native module error')
        })

        expect(() => getSenderAddress('0xabc')).toThrow('Native module error')
      })
    })
  })

  describe('Sn', () => {
    let mockSnInstance: any
    let validOpts: SnOpts

    beforeEach(() => {
      mockSnInstance = {
        send: jest.fn(),
        send_with_header: jest.fn(),
        multi_send_with_header: jest.fn(),
        listen: jest.fn(),
        evict_socket: jest.fn(),
        stopListening: jest.fn(),
        stats: jest.fn(),
      }

      mockNet.Sn.mockReturnValue(mockSnInstance)

      validOpts = {
        port: 8080,
        address: '127.0.0.1',
        crypto: {
          hashKey: 'test-hash-key',
          signingSecretKeyHex: 'test-secret-key',
        },
        senderOpts: {
          useLruCache: true,
          lruSize: 1024,
        },
        payloadOpts: {
          payloadSizeLimitInBytes: 1024 * 1024,
          headerSizeLimitInBytes: 1024,
        },
        headerOpts: {
          sendHeaderVersion: 1,
        },
      }
    })

    describe('initialization', () => {
      test('should create Sn instance with all options', () => {
        const sn = Sn(validOpts)

        expect(mockNet.Sn).toHaveBeenCalledWith(
          8080,
          '127.0.0.1',
          true,
          1024,
          'test-hash-key',
          'test-secret-key',
          1024 * 1024,
          1024
        )
        expect(mockNet.setLoggingEnabled).toHaveBeenCalledWith(false)
        expect(sn).toHaveProperty('send')
        expect(sn).toHaveProperty('sendWithHeader')
        expect(sn).toHaveProperty('multiSendWithHeader')
        expect(sn).toHaveProperty('listen')
        expect(sn).toHaveProperty('stopListening')
        expect(sn).toHaveProperty('stats')
        expect(sn).toHaveProperty('evictSocket')
        expect(sn).toHaveProperty('updateHeaderOpts')
        expect(sn).toHaveProperty('setLogFlags')
      })

      test('should use default values when optional fields are not provided', () => {
        const minimalOpts: SnOpts = {
          port: 3000,
          crypto: {
            hashKey: 'key',
            signingSecretKeyHex: 'secret',
          },
        }

        Sn(minimalOpts)

        expect(mockNet.Sn).toHaveBeenCalledWith(
          3000,
          '0.0.0.0', // default address
          false, // default useLruCache
          1028, // default lruSize
          'key',
          'secret',
          2 * 1024 * 1024, // default payload size limit
          2 * 1024 // default header size limit
        )
      })
    })

    describe('send', () => {
      test('should send data without header', async () => {
        mockSnInstance.send.mockImplementation((port, addr, data, cb) => {
          setTimeout(() => cb(null), 10)
        })

        const sn = Sn(validOpts)
        const promise = sn.send(9000, '192.168.1.1', { message: 'hello' })

        jest.advanceTimersByTime(10)
        await promise

        expect(mockSnInstance.send).toHaveBeenCalled()
        const callArgs = mockSnInstance.send.mock.calls[0]
        expect(callArgs[0]).toBe(9000)
        expect(callArgs[1]).toBe('192.168.1.1')
        const sentData = JSON.parse(callArgs[2])
        expect(sentData.data).toEqual({ message: 'hello' })
        expect(sentData.UUID).toBe('test-uuid-123')
        expect(sentData.msgDir).toBe('tell')
      })

      test('should handle send with response callback', async () => {
        mockSnInstance.send.mockImplementation((port, addr, data, cb) => {
          setTimeout(() => cb(null), 10)
        })

        const sn = Sn(validOpts)
        const onResponse = jest.fn()
        const onTimeout = jest.fn()

        const promise = sn.send(9000, '192.168.1.1', { message: 'hello' }, 5000, onResponse, onTimeout)

        jest.advanceTimersByTime(10)
        await promise

        const sentData = JSON.parse(mockSnInstance.send.mock.calls[0][2])
        expect(sentData.msgDir).toBe('ask')
        expect(sentData.timeout).toBe(5000)
      })

      test('should handle send error', async () => {
        mockSnInstance.send.mockImplementation((port, addr, data, cb) => {
          setTimeout(() => cb('Network error'), 10)
        })

        const sn = Sn(validOpts)

        const promise = sn.send(9000, '192.168.1.1', { message: 'hello' })
        jest.advanceTimersByTime(10)

        await expect(promise).rejects.toThrow('failed with error Network error')
      })

      test('should handle timeout', async () => {
        mockSnInstance.send.mockImplementation((port, addr, data, cb) => {
          setTimeout(() => cb(null), 10)
        })

        const sn = Sn(validOpts)
        const onResponse = jest.fn()
        const onTimeout = jest.fn()

        const promise = sn.send(9000, '192.168.1.1', { message: 'hello' }, 1000, onResponse, onTimeout)

        jest.advanceTimersByTime(10)
        await promise

        // Advance time past timeout
        jest.advanceTimersByTime(1001)

        expect(onTimeout).toHaveBeenCalled()
        expect(onResponse).not.toHaveBeenCalled()
      })
    })

    describe('sendWithHeader', () => {
      test('should send data with header', async () => {
        mockSnInstance.send_with_header.mockImplementation((port, addr, ver, hdr, data, cb) => {
          setTimeout(() => cb(null), 10)
        })

        const sn = Sn(validOpts)
        const header = {
          sender_id: 'sender123',
          tracker_id: 'tracker456',
          verification_data: 'verify789',
          compression: 'none' as const,
        }

        const promise = sn.sendWithHeader(9000, '192.168.1.1', { message: 'hello' }, header)

        jest.advanceTimersByTime(10)
        await promise

        expect(mockSnInstance.send_with_header).toHaveBeenCalled()
        const callArgs = mockSnInstance.send_with_header.mock.calls[0]
        expect(callArgs[0]).toBe(9000)
        expect(callArgs[1]).toBe('192.168.1.1')
        expect(callArgs[2]).toBe(1) // header version from headerOpts

        const sentHeader = JSON.parse(callArgs[3])
        expect(sentHeader.sender_id).toBe('sender123')
        expect(sentHeader.uuid).toBe('test-uuid-123')
      })
    })

    describe('multiSendWithHeader', () => {
      test('should send to multiple destinations', async () => {
        mockSnInstance.multi_send_with_header.mockImplementation(
          (ports, addrs, ver, hdr, data, cb, awaitProcessing) => {
            setTimeout(() => cb(null), 10)
          }
        )

        const sn = Sn(validOpts)
        const header = {
          sender_id: 'sender123',
          tracker_id: 'tracker456',
          verification_data: 'verify789',
          compression: 'none' as const,
        }

        const promise = sn.multiSendWithHeader(
          [9000, 9001],
          ['192.168.1.1', '192.168.1.2'],
          { message: 'broadcast' },
          header
        )

        jest.advanceTimersByTime(10)
        await promise

        expect(mockSnInstance.multi_send_with_header).toHaveBeenCalled()
        const callArgs = mockSnInstance.multi_send_with_header.mock.calls[0]
        expect(callArgs[0]).toEqual([9000, 9001])
        expect(callArgs[1]).toEqual(['192.168.1.1', '192.168.1.2'])
        expect(callArgs[6]).toBe(true) // awaitProcessing default
      })

      test('should handle multiSend with awaitProcessing false', async () => {
        mockSnInstance.multi_send_with_header.mockImplementation(
          (ports, addrs, ver, hdr, data, cb, awaitProcessing) => {
            setTimeout(() => cb(null), 10)
          }
        )

        const sn = Sn(validOpts)
        const header = {
          sender_id: 'sender123',
          tracker_id: 'tracker456',
          verification_data: 'verify789',
          compression: 'none' as const,
        }

        const promise = sn.multiSendWithHeader(
          [9000],
          ['192.168.1.1'],
          { message: 'test' },
          header,
          0,
          undefined,
          undefined,
          false
        )

        jest.advanceTimersByTime(10)
        await promise

        const callArgs = mockSnInstance.multi_send_with_header.mock.calls[0]
        expect(callArgs[6]).toBe(false) // awaitProcessing
      })
    })

    describe('listen', () => {
      test('should setup listener and handle incoming messages', async () => {
        let listenerCallback: any
        mockSnInstance.listen.mockImplementation((cb) => {
          listenerCallback = cb
          return Promise.resolve({ server: 'mock-server' })
        })

        const sn = Sn(validOpts)
        const handleData = jest.fn()

        const server = await sn.listen(handleData)

        expect(server).toEqual({ server: 'mock-server' })

        // Simulate incoming message
        const incomingData = JSON.stringify({
          data: { message: 'incoming' },
          UUID: 'incoming-uuid',
          PORT: 8080,
          ADDRESS: '127.0.0.1',
          sendTime: Date.now(),
          timeout: 5000,
          msgDir: 'ask',
        })

        listenerCallback(incomingData, '192.168.1.1', 9000)

        expect(handleData).toHaveBeenCalled()
        const handleDataCall = handleData.mock.calls[0]
        expect(handleDataCall[0]).toEqual({ message: 'incoming' })
        expect(handleDataCall[1]).toEqual({ address: '192.168.1.1', port: 9000 })
        expect(typeof handleDataCall[2]).toBe('function') // respond function
      })

      test('should handle incoming response to sent message', async () => {
        let listenerCallback: any
        mockSnInstance.listen.mockImplementation((cb) => {
          listenerCallback = cb
          return Promise.resolve({ server: 'mock-server' })
        })
        mockSnInstance.send.mockImplementation((port, addr, data, cb) => {
          setTimeout(() => cb(null), 10)
        })

        const sn = Sn(validOpts)
        const handleData = jest.fn()
        await sn.listen(handleData)

        // Send a message expecting response
        const onResponse = jest.fn()
        const promise = sn.send(9000, '192.168.1.1', { message: 'request' }, 5000, onResponse)

        jest.advanceTimersByTime(10)
        await promise

        // Simulate response
        const responseData = JSON.stringify({
          data: { message: 'response' },
          UUID: 'test-uuid-123',
          PORT: 8080,
          ADDRESS: '127.0.0.1',
          msgDir: 'resp',
        })

        listenerCallback(responseData, '192.168.1.1', 9000)

        expect(onResponse).toHaveBeenCalledWith({ message: 'response' }, undefined, undefined)
        expect(handleData).not.toHaveBeenCalled()
      })

      test('should handle message with header and signature', async () => {
        let listenerCallback: any
        mockSnInstance.listen.mockImplementation((cb) => {
          listenerCallback = cb
          return Promise.resolve({ server: 'mock-server' })
        })

        const sn = Sn(validOpts)
        const handleData = jest.fn()

        await sn.listen(handleData)

        const incomingData = JSON.stringify({
          data: { message: 'signed' },
          UUID: 'signed-uuid',
          PORT: 8080,
          ADDRESS: '127.0.0.1',
          msgDir: 'ask',
        })

        const headerData = JSON.stringify({
          sender_id: 'sender123',
          tracker_id: 'tracker456',
        })

        const signData = JSON.stringify({
          signature: 'sig123',
          publicKey: 'pubkey456',
        })

        listenerCallback(incomingData, '192.168.1.1', 9000, 1, headerData, signData)

        expect(handleData).toHaveBeenCalled()
        const handleDataCall = handleData.mock.calls[0]
        expect(handleDataCall[3]).toEqual({
          sender_id: 'sender123',
          tracker_id: 'tracker456',
        })
        expect(handleDataCall[4]).toEqual({
          signature: 'sig123',
          publicKey: 'pubkey456',
        })
      })

      test('should handle listener callback errors', async () => {
        let listenerCallback: any
        mockSnInstance.listen.mockImplementation((cb) => {
          listenerCallback = cb
          return Promise.resolve({ server: 'mock-server' })
        })

        const sn = Sn(validOpts)
        const handleData = jest.fn().mockImplementation(() => {
          throw new Error('Handler error')
        })

        const consoleError = jest.spyOn(console, 'error').mockImplementation()

        await sn.listen(handleData)

        const incomingData = JSON.stringify({
          data: { message: 'test' },
          UUID: 'test-uuid',
          PORT: 8080,
          ADDRESS: '127.0.0.1',
          msgDir: 'ask',
        })

        expect(() => listenerCallback(incomingData, '192.168.1.1', 9000)).not.toThrow()
        expect(consoleError).toHaveBeenCalledWith("Error in shardus-net's listen callback:", expect.any(Error))

        consoleError.mockRestore()
      })
    })

    describe('evictSocket', () => {
      test('should evict socket for given port and address', () => {
        mockSnInstance.evict_socket.mockReturnValue(true)

        const sn = Sn(validOpts)
        const result = sn.evictSocket(9000, '192.168.1.1')

        expect(mockSnInstance.evict_socket).toHaveBeenCalledWith(9000, '192.168.1.1')
        expect(result).toBe(true)
      })
    })

    describe('stopListening', () => {
      test('should stop listening on server', () => {
        const mockServer = { server: 'mock-server' }
        mockSnInstance.stopListening.mockReturnValue(true)

        const sn = Sn(validOpts)
        const result = sn.stopListening(mockServer)

        expect(mockSnInstance.stopListening).toHaveBeenCalledWith(mockServer)
        expect(result).toBe(true)
      })
    })

    describe('stats', () => {
      test('should return network statistics', () => {
        const mockStats = { sent: 100, received: 200 }
        mockSnInstance.stats.mockReturnValue(mockStats)

        const sn = Sn(validOpts)
        const result = sn.stats()

        expect(mockSnInstance.stats).toHaveBeenCalled()
        expect(result).toEqual(mockStats)
      })
    })

    describe('updateHeaderOpts', () => {
      test('should update header options', () => {
        const sn = Sn(validOpts)
        sn.updateHeaderOpts({ sendHeaderVersion: 2 })

        // Test that the new version is used in subsequent sends
        mockSnInstance.send_with_header.mockImplementation((port, addr, ver, hdr, data, cb) => {
          expect(ver).toBe(2)
          setTimeout(() => cb(null), 10)
        })

        sn.sendWithHeader(
          9000,
          '192.168.1.1',
          { message: 'test' },
          {
            sender_id: 'sender',
            tracker_id: 'tracker',
            verification_data: 'verify',
            compression: 'none',
          }
        )

        jest.advanceTimersByTime(10)
      })
    })

    describe('setLogFlags', () => {
      test('should set log flags', () => {
        const sn = Sn(validOpts)

        sn.setLogFlags({
          net_verbose: true,
          net_stats: true,
          net_rust: true,
        })

        expect(logFlags.net_verbose).toBe(true)
        expect(logFlags.net_stats).toBe(true)
        expect(logFlags.net_rust).toBe(true)
        expect(mockNet.setLoggingEnabled).toHaveBeenCalledWith(true)
      })

      test('should handle null log flags', () => {
        const sn = Sn(validOpts)

        expect(() => sn.setLogFlags(null)).not.toThrow()
      })

      test('should set default values for missing flags', () => {
        const sn = Sn(validOpts)

        // Reset flags first to ensure clean state
        logFlags.net_verbose = false
        logFlags.net_stats = undefined as any
        logFlags.net_rust = undefined as any

        sn.setLogFlags({
          net_verbose: true,
        })

        expect(logFlags.net_verbose).toBe(true)
        expect(logFlags.net_stats).toBe(false)
        expect(logFlags.net_rust).toBe(false)
      })
    })

    describe('error handling', () => {
      test('should handle JSON parse errors in listener', async () => {
        let listenerCallback: any
        mockSnInstance.listen.mockImplementation((cb) => {
          listenerCallback = cb
          return Promise.resolve({ server: 'mock-server' })
        })

        const sn = Sn(validOpts)
        const handleData = jest.fn()
        const consoleError = jest.spyOn(console, 'error').mockImplementation()

        await sn.listen(handleData)

        // Send invalid JSON
        listenerCallback('invalid json', '192.168.1.1', 9000)

        expect(consoleError).toHaveBeenCalled()
        expect(handleData).not.toHaveBeenCalled()

        consoleError.mockRestore()
      })

      test('should handle custom stringifier errors', async () => {
        const optsWithCustomStringifier = {
          ...validOpts,
          customStringifier: () => {
            throw new Error('Stringifier error')
          },
        }

        const consoleLog = jest.spyOn(console, 'log').mockImplementation()
        const consoleError = jest.spyOn(console, 'error').mockImplementation()

        const sn = Sn(optsWithCustomStringifier)

        // Send with timeout 0 to avoid timeout handling complexity
        const promise = sn.send(9000, '192.168.1.1', { message: 'test' }, 0)

        // Wait for the promise to resolve/reject
        await expect(promise).rejects.toThrow('failed with error error caught in _sendAug 1')

        expect(consoleLog).toHaveBeenCalledWith(
          '_sendAug - error sending from ts side of shardus-net',
          expect.any(Error)
        )

        consoleLog.mockRestore()
        consoleError.mockRestore()
      })

      test('should handle custom parser errors in listener', async () => {
        let listenerCallback: any
        mockSnInstance.listen.mockImplementation((cb) => {
          listenerCallback = cb
          return Promise.resolve({ server: 'mock-server' })
        })

        const optsWithCustomParser = {
          ...validOpts,
          customJsonParser: () => {
            throw new Error('Parser error')
          },
        }

        const sn = Sn(optsWithCustomParser)
        const handleData = jest.fn()
        const consoleError = jest.spyOn(console, 'error').mockImplementation()

        await sn.listen(handleData)

        // Send valid JSON that will trigger custom parser
        const validJson = JSON.stringify({
          data: { message: 'test' },
          UUID: 'test-uuid',
          PORT: 8080,
          ADDRESS: '127.0.0.1',
          msgDir: 'ask',
        })

        listenerCallback(validJson, '192.168.1.1', 9000)

        expect(consoleError).toHaveBeenCalledWith("Error in shardus-net's listen callback:", expect.any(Error))
        expect(handleData).not.toHaveBeenCalled()

        consoleError.mockRestore()
      })
    })

    describe('timeout handling', () => {
      test('should clean up timed out requests', async () => {
        let listenerCallback: any
        mockSnInstance.listen.mockImplementation((cb) => {
          listenerCallback = cb
          return Promise.resolve({ server: 'mock-server' })
        })
        mockSnInstance.send.mockImplementation((port, addr, data, cb) => {
          setTimeout(() => cb(null), 10)
        })

        const sn = Sn(validOpts)
        await sn.listen(jest.fn())

        const onResponse = jest.fn()
        const onTimeout = jest.fn()

        // Send request with short timeout
        const promise = sn.send(9000, '192.168.1.1', { message: 'test' }, 100, onResponse, onTimeout)

        jest.advanceTimersByTime(10)
        await promise

        // Let it timeout
        jest.advanceTimersByTime(101)

        // Late response arrives
        const responseData = JSON.stringify({
          data: { message: 'late response' },
          UUID: 'test-uuid-123',
          PORT: 8080,
          ADDRESS: '127.0.0.1',
          msgDir: 'resp',
        })

        listenerCallback(responseData, '192.168.1.1', 9000)

        // Response handler should not be called for timed out request
        expect(onResponse).not.toHaveBeenCalled()
        expect(onTimeout).toHaveBeenCalled()
      })
    })

    describe('respond function in listener', () => {
      test('should allow responding to incoming messages', async () => {
        let listenerCallback: any
        mockSnInstance.listen.mockImplementation((cb) => {
          listenerCallback = cb
          return Promise.resolve({ server: 'mock-server' })
        })
        mockSnInstance.send_with_header.mockImplementation((port, addr, ver, hdr, data, cb) => {
          setTimeout(() => cb(null), 10)
        })

        const sn = Sn(validOpts)
        const handleData = jest.fn().mockImplementation((data, remote, respond) => {
          // Respond to the message
          respond({ response: 'acknowledged' })
        })

        await sn.listen(handleData)

        const incomingData = JSON.stringify({
          data: { message: 'request' },
          UUID: 'request-uuid',
          PORT: 9000,
          ADDRESS: '192.168.1.1',
          sendTime: Date.now(),
          timeout: 5000,
          msgDir: 'ask',
        })

        listenerCallback(incomingData, '192.168.1.1', 9000)
        jest.advanceTimersByTime(10)

        expect(mockSnInstance.send_with_header).toHaveBeenCalled()
        const responseCall = mockSnInstance.send_with_header.mock.calls[0]
        const responseData = JSON.parse(responseCall[4])
        expect(responseData.data).toEqual({ response: 'acknowledged' })
        expect(responseData.UUID).toBe('request-uuid')
        expect(responseData.msgDir).toBe('resp')
      })

      test('should not respond if request has timed out', async () => {
        let listenerCallback: any
        mockSnInstance.listen.mockImplementation((cb) => {
          listenerCallback = cb
          return Promise.resolve({ server: 'mock-server' })
        })

        const sn = Sn(validOpts)
        const handleData = jest.fn().mockImplementation((data, remote, respond) => {
          // Try to respond after timeout
          respond({ response: 'too late' })
        })

        await sn.listen(handleData)

        const sendTime = Date.now() - 10000 // 10 seconds ago
        const incomingData = JSON.stringify({
          data: { message: 'request' },
          UUID: 'request-uuid',
          PORT: 9000,
          ADDRESS: '192.168.1.1',
          sendTime: sendTime,
          timeout: 5000, // 5 second timeout
          msgDir: 'ask',
        })

        listenerCallback(incomingData, '192.168.1.1', 9000)

        expect(mockSnInstance.send_with_header).not.toHaveBeenCalled()
      })
    })
  })

  describe('logFlags', () => {
    test('should export logFlags object with default values', () => {
      expect(logFlags).toEqual({
        net_verbose: false,
        net_stats: false,
        net_rust: false,
      })
    })
  })
})
