import * as uuid from 'uuid/v1'
import {
  AppHeader,
  AugmentedData,
  CombinedHeader,
  GetSenderAddressResult,
  ListenerResponder,
  NewAugData,
  RemoteSender,
  ResponseCallback,
  Sign,
  SnOpts,
  TimeoutCallback,
  validateSnOpts,
} from './types'
import { jsonParse, jsonStringify } from './util/Encoding'
import { NewNumberHistogram } from './util/Histogram'
import { logMessageInfo } from './util/Log'
import { TTLMap } from './util/TTLMap'
const net = require('../../shardus-net.node')

const DEFAULT_ADDRESS = '0.0.0.0'

//todo make this a dynamic config or connect to shardus core log levels
const verbose_logs = false

//use these to control logging
export let logFlags = {
  net_verbose: false,
  net_stats: false,
  net_rust: false,
}

const noop = () => {}

export const getSenderAddress = (raw_tx: string): GetSenderAddressResult => {
  //trim the 0x if it is there
  const raw_tx_trimmed = raw_tx.startsWith('0x') ? raw_tx.slice(2) : raw_tx
  const result = net.getSenderAddress(raw_tx_trimmed) as GetSenderAddressResult
  return result
}

export const Sn = (opts: SnOpts) => {
  validateSnOpts(opts)

  const PORT = opts.port
  const ADDRESS = opts.address || DEFAULT_ADDRESS
  const USE_LRU_CACHE = (opts.senderOpts && opts.senderOpts.useLruCache) || false
  const LRU_SIZE = (opts.senderOpts && opts.senderOpts.lruSize) || 1028
  const HASH_KEY = opts.crypto.hashKey
  const SIGNING_SECRET_KEY_HEX = opts.crypto.signingSecretKeyHex

  const HEADER_OPTS = opts.headerOpts || {
    sendHeaderVersion: 0,
  }

  const _net = net.Sn(PORT, ADDRESS, USE_LRU_CACHE, LRU_SIZE, HASH_KEY, SIGNING_SECRET_KEY_HEX)

  net.setLoggingEnabled(false)

  // we're going to keep track of response IDs here
  const responseUUIDMapping: {
    [uuid: string]: {
      callback: (data: unknown, header?: AppHeader, sign?: Sign) => void
      timestamp: number
    }
  } = {}

  const timedOutUUIDMapping = new TTLMap<{
    timedOutAt: number
    requestCreatedAt: number
  }>()

  const histogram = NewNumberHistogram(
    '[stats] Shardus net request times - histogram (seconds)',
    [0, 5, 10, 20, 40, 60]
  )

  const retainTimedOutEntriesForMillis = 1000 * 60

  const _wrappedSendAug = async (
    port: number | number[],
    address: string | string[],
    augData: AugmentedData,
    timeout: number,
    onResponse: ResponseCallback,
    onTimeout: TimeoutCallback,
    optionalHeader?: {
      version: number
      headerData: CombinedHeader
    },
    awaitProcessing: boolean = true
  ) => {
    try {
      const res = await _sendAug(
        port,
        address,
        augData,
        timeout,
        onResponse,
        onTimeout,
        optionalHeader,
        awaitProcessing
      )
      if (!res.success) {
        const errorMsg = `_wrappedSendAug: request id ${augData.UUID}: failed with error ${res.error}`
        console.error(errorMsg)
        throw new Error(errorMsg)
      }
    } catch (err: unknown) {
      // Ensure any kind of error is caught and logged
      if (err instanceof Error) {
        console.error(`Error in _wrappedSendAug: ${err.message}`)
      }
      throw err // Rethrow after logging or handle accordingly
    }
  }

  /**
   * This sends our data the that is wrapped in an augData structure
   * a new function will be added similar to this one to send data with header
   * @param port
   * @param address
   * @param augData
   * @param timeout
   * @param onResponse
   * @param onTimeout
   * @param optionalHeader
   * @returns
   */
  const _sendAug = async (
    port: number | number[],
    address: string | string[],
    augData: AugmentedData,
    timeout: number,
    onResponse: ResponseCallback,
    onTimeout: TimeoutCallback,
    optionalHeader?: {
      version: number
      headerData: CombinedHeader
    },
    awaitProcessing: boolean = true
  ) => {
    const stringifiedData = jsonStringify(augData, opts.customStringifier)
    const stringifiedHeader = optionalHeader
      ? jsonStringify(optionalHeader.headerData, opts.customStringifier)
      : null

    /* prettier-ignore */ if(logFlags.net_verbose) logMessageInfo(augData, stringifiedData)

    return new Promise<{ success: boolean; error?: string }>((resolve, reject) => {
      const sendCallback = (error) => {
        if (error) {
          resolve({ success: false, error })
        } else {
          resolve({ success: true })
        }
      }
      try {
        if (optionalHeader && stringifiedHeader !== null) {
          /* prettier-ignore */ if(logFlags.net_verbose) console.log('sending with header')
          // if it is a multi send operation, from shardus-core, array of ports and addresses shall be sent.
          if (Array.isArray(port) && Array.isArray(address)) {
            if (logFlags.net_verbose) console.log('multi_send_with_header')
            _net.multi_send_with_header(
              port,
              address,
              optionalHeader.version,
              stringifiedHeader,
              stringifiedData,
              sendCallback,
              awaitProcessing
            )
          } else {
            if (logFlags.net_verbose) console.log('send_with_header')
            _net.send_with_header(
              port,
              address,
              optionalHeader.version,
              stringifiedHeader,
              stringifiedData,
              sendCallback
            )
          }
        } else {
          /* prettier-ignore */ if(logFlags.net_verbose) console.log('sending without header')
          _net.send(port, address, stringifiedData, sendCallback)
        }
      } catch (error) {
        console.log('_sendAug - error sending from ts side of shardus-net', error)
        throw error
      }

      // a timeout of 0 means no return message is expected.
      if (timeout !== 0) {
        const timer = setTimeout(() => {
          const mapping = responseUUIDMapping[augData.UUID]
          timedOutUUIDMapping.set(
            augData.UUID,
            {
              timedOutAt: Date.now(),
              requestCreatedAt: mapping !== undefined ? mapping.timestamp : 0,
            },
            retainTimedOutEntriesForMillis,
            (key, value) => {
              /* prettier-ignore */ if(logFlags.net_verbose) console.log(`_sendAug: request id ${key}: expired from timedOutUUIDMapping at ${value.timedOutAt}, request created at ${value.requestCreatedAt}}`)
              /* prettier-ignore */ if(logFlags.net_verbose) histogram.logData((Date.now() - value.requestCreatedAt) / 1000)
            }
          )
          /* prettier-ignore */ if(logFlags.net_verbose) console.log(`_sendAug: request id ${augData.UUID}: timed out after ${Date.now() - mapping.timestamp}ms`)
          /* prettier-ignore */ if(logFlags.net_verbose) console.log(`_sendAug: request id ${augData.UUID}: detailed aug data: ${JSON.stringify(augData)}`)

          //should we clear the request socket here?
          //should be be logging better at this level
          //maybe a counter service could be passed to this library?

          delete responseUUIDMapping[augData.UUID]
          onTimeout()
        }, timeout)

        // this is where we bind the response callback to the UUID
        // later extractUUIDHandleData will call this callback if it
        // finds a UUID match.
        responseUUIDMapping[augData.UUID] = {
          callback: (data: unknown, appHeader?: AppHeader, sign?: Sign) => {
            clearTimeout(timer)
            onResponse(data, appHeader, sign)
          },
          timestamp: Date.now(),
        }
      }
    })
  }

  /**
   * Asynchronously sends data to multiple destinations with additional header information.
   * This function allows for sending data across different ports and addresses with a specified header and timeout settings.
   * It supports both 'ask' and 'tell' message directions based on the response callback provided.
   *
   * @param {number[]} ports - An array of port numbers to which the data will be sent.
   * @param {string[]} addresses - An array of IP addresses corresponding to the ports for data transmission.
   * @param {unknown} data - The data to be sent. The type is unknown, allowing for flexibility in the data sent.
   * @param {AppHeader} header - The application header information to be included with the data.
   * @param [timeout=0] - Optional timeout for the data transmission. Defaults to 0 if not provided.
   * @param {ResponseCallback} [onResponse=noop] - Optional callback function to handle responses. Defaults to a no-operation function if not provided.
   * @param {TimeoutCallback} [onTimeout=noop] - Optional callback function to handle timeout events. Defaults to a no-operation function if not provided.
   * @returns - The result of the `_sendAug` function, which handles the actual data transmission process.
   */
  const multiSendWithHeader = async (
    ports: number[], // Array of port numbers
    addresses: string[], // Array of IP addresses
    data: unknown,
    header: AppHeader,
    timeout = 0,
    onResponse: ResponseCallback = noop,
    onTimeout: TimeoutCallback = noop,
    awaitProcessing: boolean = true
  ) => {
    try {
      const UUID = uuid()

      let msgDir: 'ask' | 'tell' = 'ask'
      if (onResponse === noop) {
        msgDir = 'tell'
      }

      const augData: AugmentedData = NewAugData(data, UUID, PORT, ADDRESS, timeout, msgDir)

      const combinedHeader: CombinedHeader = {
        uuid: UUID,
        sender_id: header.sender_id,
        tracker_id: header.tracker_id,
        verification_data: header.verification_data,
        compression: header.compression,
      }

      return _wrappedSendAug(
        ports,
        addresses,
        augData,
        timeout,
        onResponse,
        onTimeout,
        {
          version: HEADER_OPTS.sendHeaderVersion,
          headerData: combinedHeader,
        },
        awaitProcessing
      )
    } catch (error) {
      console.log('multiSendWithHeader - error sending from ts side of shardus-net', error)
      throw error
    }
  }

  const sendWithHeader = async (
    port: number,
    address: string,
    data: unknown,
    header: AppHeader,
    timeout = 0,
    onResponse: ResponseCallback = noop,
    onTimeout: TimeoutCallback = noop
  ) => {
    const UUID = uuid()

    let msgDir: 'ask' | 'tell' = 'ask'
    if (onResponse === noop) {
      msgDir = 'tell'
    }

    const augData: AugmentedData = NewAugData(data, UUID, PORT, ADDRESS, timeout, msgDir)

    const combinedHeader: CombinedHeader = {
      uuid: UUID,
      sender_id: header.sender_id,
      tracker_id: header.tracker_id,
      verification_data: header.verification_data,
      compression: header.compression,
    }

    return _wrappedSendAug(port, address, augData, timeout, onResponse, onTimeout, {
      version: HEADER_OPTS.sendHeaderVersion,
      headerData: combinedHeader,
    })
  }

  const send = async (
    port: number,
    address: string,
    data: unknown,
    timeout = 0,
    onResponse: ResponseCallback = noop,
    onTimeout: TimeoutCallback = noop
  ) => {
    const UUID = uuid()

    let msgDir: 'ask' | 'tell' = 'ask'
    if (onResponse === noop) {
      msgDir = 'tell'
    }

    const augData: AugmentedData = NewAugData(data, UUID, PORT, ADDRESS, timeout, msgDir)

    return _wrappedSendAug(port, address, augData, timeout, onResponse, onTimeout)
  }

  const listen = async (
    handleData: (
      data: unknown,
      remote: RemoteSender,
      respond: ListenerResponder,
      header?: AppHeader,
      sign?: Sign
    ) => void
  ) => {
    // This is a wrapped form of the 'handleData' callback the user supplied.
    // Its job is to determine if the incoming data is a response to a request
    // the user sent. It does this by referencing the UUID map object.
    const extractUUIDHandleData = (
      augDataStr: string,
      remote: RemoteSender,
      header?: AppHeader,
      sign?: Sign
    ) => {
      // [TODO] Secure this with validation
      let augData: AugmentedData = jsonParse(augDataStr)

      //here we will log the received message.  note we exploit an aspect of augData
      //that the data part is the first value and will be close enough to the start ot the string
      //to save us from an expensive re-stringify just to get log data of the message
      /* prettier-ignore */ if(logFlags.net_verbose) logMessageInfo(augData, augDataStr, false, Date.now())

      const { PORT, UUID, data } = augData
      const address = remote.address

      const receivedTime = Date.now()
      // This is the return send function. A user will call this if they want
      // to "reply" or "respond" to an incoming message.
      const respond: ListenerResponder = (data?: unknown, header?: AppHeader) => {
        //we can do some timestamp work here for better logging.
        const replyTime = Date.now()
        if (replyTime > augData.sendTime + augData.timeout) {
          /* prettier-ignore */ if(logFlags.net_verbose) console.log(`listen: extractUUIDHandleData: request id ${UUID}: reply time ${replyTime} is greater than timeout ${augData.sendTime + augData.timeout}. ignoring respond call`)
          return
        }
        const sendData = {
          data,
          UUID,
          PORT,
          ADDRESS: undefined,
          sendTime: augData.sendTime,
          receivedTime,
          replyTime,
          replyReceivedTime: 0,
          msgDir: 'resp',
        }

        const combinedHeader: CombinedHeader = {
          uuid: UUID,
        }
        if (header) {
          combinedHeader.sender_id = header.sender_id
          combinedHeader.tracker_id = header.tracker_id
          combinedHeader.verification_data = header.verification_data
          combinedHeader.compression = header.compression
        }

        //@ts-ignore TODO: FIX THISSSSSS (Remove the ignore flag and make typescript not complain about address being possibly undefined)
        // @TODO: This error should be properly propagated and logged.
        return _wrappedSendAug(PORT, address, sendData, 0, noop, noop, {
          version: HEADER_OPTS.sendHeaderVersion,
          headerData: combinedHeader,
        }).catch(console.error)
      }

      // If we are expecting a response, go through the respond mechanism.
      // Otherwise, it's a normal incoming message.
      if (responseUUIDMapping[UUID]) {
        /* prettier-ignore */ if(logFlags.net_verbose) console.log(`listen: extractUUIDHandleData: request id ${UUID}: incoming message found in responseUUIDMapping`)
        /* prettier-ignore */ if(logFlags.net_verbose) console.log(`listen: extractUUIDHandleData: request id ${UUID}: actual time taken for operation ${Date.now() - responseUUIDMapping[UUID].timestamp}ms`)
        /* prettier-ignore */ if(logFlags.net_stats) histogram.logData((Date.now() - responseUUIDMapping[UUID].timestamp) / 1000)

        const handle = responseUUIDMapping[UUID].callback
        // Clear the respond mechanism.
        delete responseUUIDMapping[UUID]
        return handle(data, header, sign)
      } else {
        // check if the UUID is in the timedOutUUIDMapping
        const entry = timedOutUUIDMapping.get(UUID)
        if (entry != undefined) {
          /* prettier-ignore */ if(logFlags.net_verbose) console.log(`listen: extractUUIDHandleData: request id ${UUID}: incoming message was found in timedOutUUIDMapping, timed out at ${entry.timedOutAt}, request created at ${entry.requestCreatedAt}, response received at ${Date.now()}`)
          /* prettier-ignore */ if(logFlags.net_verbose) console.log(`listen: extractUUIDHandleData: request id ${UUID}: actual time taken for operation ${Date.now() - entry.requestCreatedAt}ms`)
          /* prettier-ignore */ if(logFlags.net_stats) histogram.logData((Date.now() - entry.requestCreatedAt) / 1000)
          timedOutUUIDMapping.delete(UUID)
        }

        return handleData(data, remote, respond, header, sign)
      }
    }

    // OLD comment from initial implementation:
    // TODO these should be spun up in parallel, but that convolutes code
    // and doesn't save hardly any startup time, so skipping for now.
    // const server = await _net.listen(PORT, ADDRESS, extractUUIDHandleData)
    const server = await _net.listen((data, remoteIp, remotePort, headerVersion?, headerData?, signData?) => {
      try {
        if (headerVersion && headerData && signData) {
          /* prettier-ignore */ if (logFlags.net_verbose) console.log(`received with header version: ${headerVersion}`)
          const header: AppHeader = JSON.parse(headerData)
          /* prettier-ignore */ if (logFlags.net_verbose) console.log(`received with header: ${JSON.stringify(header)}`)
          /* prettier-ignore */ if (logFlags.net_verbose) console.log(`received with sign: ${signData}`)
          const sign: Sign = JSON.parse(signData)
          extractUUIDHandleData(
            data,
            {
              address: remoteIp,
              port: remotePort,
            },
            header,
            sign
          )
          return
        }

        extractUUIDHandleData(data, {
          address: remoteIp,
          port: remotePort,
        })
      } catch (e) {
        console.error("Error in shardus-net's listen callback:", e)
      }
    })

    return server
  }

  const evictSocket = (port: number, address: string) => {
    return _net.evict_socket(port, address)
  }

  const stopListening = (server: any) => {
    return _net.stopListening(server)
  }

  const updateHeaderOpts = (opts: { sendHeaderVersion: number }) => {
    HEADER_OPTS.sendHeaderVersion = opts.sendHeaderVersion
  }

  const stats = () => _net.stats()

  /**
   * This allows shardus core to set log flags for shardus net
   * If you use any additional flags they need to be added here
   * to guarantee they are set
   * @param setLogFlags
   */
  //@ts-ignore
  const setLogFlags = (setLogFlags: any) => {
    if (setLogFlags == null) {
      return
    }

    if (logFlags == null) {
      logFlags = {
        net_verbose: false,
        net_stats: false,
        net_rust: false,
      }
    }

    //loop through and set flags
    for (const [key, value] of Object.entries(setLogFlags)) {
      logFlags[key] = value
    }

    //make sure values are set if missing
    logFlags.net_stats ??= false
    logFlags.net_verbose ??= false
    logFlags.net_rust ??= false

    net.setLoggingEnabled(logFlags.net_rust)
  }

  const returnVal = {
    send,
    sendWithHeader,
    multiSendWithHeader,
    listen,
    stopListening,
    stats,
    evictSocket,
    updateHeaderOpts,
    setLogFlags,
  }

  return returnVal
}
